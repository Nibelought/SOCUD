"""PyTorch implementation of the embedder: runs on an NVIDIA GPU (CUDA), Apple GPU (MPS) or CPU.

This is what lets the worker live on another machine (e.g. a PC with an RTX 4070) while the backend keeps talking to
the same `POST /embed`. It loads the original `Qwen/Qwen3-Embedding-4B` through `transformers.AutoModel` and reuses
the helpers of `embedder.py` for everything around the model (cleaning, query instruction, EOS handling, left
padding, last-token pooling, Matryoshka truncation, batching), so vectors come from the same pipeline as on MLX.
Imports torch/transformers lazily so the package stays importable in CI.
"""

import logging
import threading
import time
from typing import Sequence

import numpy as np

from config import Settings
from embedder import (
    last_token_pool,
    mrl_truncate,
    pad_left,
    plan_batches,
    prepare_text,
    truncate_with_eos,
)

logger = logging.getLogger(__name__)

EOS_TOKEN = "<|endoftext|>"  # appended by the official Qwen3-Embedding tokenizer; also its pad token


def resolve_device(requested: str, torch) -> str:
    """Pick the torch device. An explicit request that cannot be met is an error (a 4B model on the CPU by
    accident would be unusably slow); "auto" prefers cuda, then mps, then cpu."""
    has_cuda = torch.cuda.is_available()
    has_mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if requested == "cuda" and not has_cuda:
        raise RuntimeError(
            "DEVICE=cuda but torch.cuda.is_available() is False. Install a CUDA build of torch "
            "(see requirements-cuda.txt) and an NVIDIA driver, or set DEVICE=cpu."
        )
    if requested == "mps" and not has_mps:
        raise RuntimeError("DEVICE=mps but the MPS backend is not available")
    if requested != "auto":
        return requested
    if has_cuda:
        return "cuda"
    if has_mps:
        return "mps"
    logger.warning("No GPU found: running a 4B model on the CPU will be very slow")
    return "cpu"


def resolve_dtype(requested: str | None, device: str) -> str:
    """Default compute dtype per device: bf16 on CUDA (native on Ampere/Ada, the checkpoint's own dtype), fp16 on
    MPS, fp32 on CPU (bf16/fp16 matmuls are slow or unsupported there)."""
    if requested:
        return requested
    return {"cuda": "bfloat16", "mps": "float16"}.get(device, "float32")


class TorchEmbedder:
    def __init__(self, settings: Settings):
        import torch  # imported here so a missing/incorrect install fails at startup with a clear error

        self._torch = torch
        self.settings = settings
        self.model_name = settings.model_name
        self.dim = settings.embedding_dim
        self.device = resolve_device(settings.device, torch)
        self.dtype = resolve_dtype(settings.dtype, self.device)
        self._lock = threading.Lock()  # one forward pass at a time; also serialises load vs. embed
        self._model = None
        self._tokenizer = None
        self._eos_id = 0
        self._pad_id = 0

    def load(self) -> None:
        from transformers import AutoModel, AutoTokenizer

        torch = self._torch
        started = time.perf_counter()
        logger.info("Loading %s on %s (%s)", self.model_name, self.device, self.dtype)
        with self._lock:
            tokenizer = AutoTokenizer.from_pretrained(self.model_name, padding_side="left")
            model = AutoModel.from_pretrained(self.model_name, dtype=getattr(torch, self.dtype))
            model = model.to(self.device).eval()
            hidden_size = getattr(model.config, "hidden_size", None)
            if hidden_size is not None and self.dim > hidden_size:
                raise RuntimeError(f"EMBEDDING_DIM={self.dim} exceeds the model hidden size {hidden_size}")
            eos_id = tokenizer.convert_tokens_to_ids(EOS_TOKEN)
            if eos_id is None or eos_id == getattr(tokenizer, "unk_token_id", None):
                raise RuntimeError(f"Tokenizer has no {EOS_TOKEN} token")
            self._model, self._tokenizer = model, tokenizer
            self._eos_id = int(eos_id)
            self._pad_id = int(tokenizer.pad_token_id if tokenizer.pad_token_id is not None else eos_id)
        if self.device == "cuda":
            logger.info("GPU: %s", torch.cuda.get_device_name(torch.device("cuda")))
        # Warm-up: initialises CUDA kernels/cuBLAS so the first real request is not slow, and fails fast.
        self.embed(["warm-up"], is_query=False)
        logger.info("Model ready in %.1fs", time.perf_counter() - started)

    # -- inference ---------------------------------------------------------------------------------------------
    def _tokenize(self, texts: Sequence[str], is_query: bool) -> list[list[int]]:
        prepared = [prepare_text(t, is_query, self.settings.query_instruction) for t in texts]
        return [
            truncate_with_eos(
                self._tokenizer.encode(p, add_special_tokens=False), self.settings.max_tokens, self._eos_id
            )
            for p in prepared
        ]

    def _forward(self, sequences: list[list[int]]) -> np.ndarray:
        torch = self._torch
        input_ids, attention_mask = pad_left(sequences, self._pad_id)
        ids = torch.from_numpy(input_ids).to(device=self.device, dtype=torch.long)
        mask = torch.from_numpy(attention_mask).to(device=self.device, dtype=torch.long)
        # Positions count real tokens only, so a left-padded row gets exactly the positions it would have alone.
        positions = (mask.cumsum(dim=-1) - 1).clamp(min=0)
        with torch.inference_mode():
            out = self._model(input_ids=ids, attention_mask=mask, position_ids=positions, use_cache=False)
            pooled = last_token_pool(out.last_hidden_state, attention_mask)
            return pooled.float().cpu().numpy()

    def _forward_adaptive(self, sequences: list[list[int]]) -> np.ndarray:
        """Forward pass that survives running out of GPU memory by splitting the batch in two."""
        try:
            return self._forward(sequences)
        except self._torch.OutOfMemoryError:
            if len(sequences) == 1:
                raise
            logger.warning("Out of memory with a batch of %d: splitting it", len(sequences))
            self._empty_cache()
            half = len(sequences) // 2
            return np.concatenate([self._forward_adaptive(sequences[:half]), self._forward_adaptive(sequences[half:])])

    def _empty_cache(self) -> None:
        torch = self._torch
        if self.device == "cuda":
            torch.cuda.empty_cache()
        elif self.device == "mps":
            torch.mps.empty_cache()

    def embed(self, texts: Sequence[str], is_query: bool = False) -> np.ndarray:
        """Embed texts into an (N, EMBEDDING_DIM) float32 array of unit vectors, in input order."""
        with self._lock:
            sequences = self._tokenize(texts, is_query)
            batches = plan_batches(
                [len(s) for s in sequences], self.settings.inference_batch_size, self.settings.inference_token_budget
            )
            result = np.zeros((len(sequences), self.dim), dtype=np.float32)
            for batch in batches:
                vectors = self._forward_adaptive([sequences[i] for i in batch])
                if not np.isfinite(vectors).all():
                    raise RuntimeError(f"Non-finite embedding (dtype={self.dtype}); try DTYPE=float32")
                result[batch] = mrl_truncate(vectors, self.dim)
            self._empty_cache()  # hand the activation cache back between requests (GPU shared with other apps)
            return result
