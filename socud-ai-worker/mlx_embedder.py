"""MLX implementation of the embedder (Apple Silicon only). Imports mlx lazily so the package stays importable in CI.

Why mlx-lm and not mlx-embeddings: the checkpoint is an mlx-lm conversion of a Qwen3 decoder (`model.layers.*`,
tied embeddings, no lm_head weights). mlx-lm loads it as-is, is small, and exposes the decoder stack
(`model.model`), which lets us return the hidden states after the final RMSNorm without the (vocab x seq) lm_head
projection. `Qwen3Model.__call__` only builds a plain causal mask, so we run the layer loop ourselves with a
padding-aware mask. mlx-embeddings 0.1.0 re-implements Qwen3 separately (own RoPE, no rope_scaling handling),
pulls in mlx-vlm/mlx-audio/opencv, and its last_token_pool guesses the padding side from the mask.
"""

import logging
import threading
import time
from typing import Sequence

import numpy as np

from config import Settings
from embedder import (
    build_attention_mask,
    last_token_pool,
    mrl_truncate,
    pad_left,
    plan_batches,
    prepare_text,
    truncate_with_eos,
)

logger = logging.getLogger(__name__)

EOS_TOKEN = "<|endoftext|>"  # appended by the official Qwen3-Embedding tokenizer; also its pad token


class MlxEmbedder:
    device = "mlx"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.model_name
        self.dim = settings.embedding_dim
        self._lock = threading.Lock()  # MLX is not safe to call concurrently
        self._model = None
        self._tokenizer = None
        self._eos_id = 0
        self._pad_id = 0

    def load(self) -> None:
        import mlx.core as mx
        from mlx_lm import load as mlx_load

        started = time.perf_counter()
        logger.info("Loading %s", self.model_name)
        with self._lock:
            model, tokenizer = mlx_load(self.model_name)
            inner = getattr(model, "model", None)
            if inner is None or not hasattr(inner, "layers") or not hasattr(inner, "norm"):
                raise RuntimeError(f"{self.model_name} is not a decoder-only mlx-lm model with .model.layers/.norm")
            hidden_size = getattr(getattr(model, "args", None), "hidden_size", None)
            if hidden_size is not None and self.dim > hidden_size:
                raise RuntimeError(f"EMBEDDING_DIM={self.dim} exceeds the model hidden size {hidden_size}")
            eos_id = tokenizer.convert_tokens_to_ids(EOS_TOKEN)
            if eos_id is None or eos_id == getattr(tokenizer, "unk_token_id", None):
                raise RuntimeError(f"Tokenizer has no {EOS_TOKEN} token")
            dtype = self.settings.dtype or "float16"
            if dtype != "bfloat16":
                model.set_dtype(getattr(mx, dtype))
            self._model, self._tokenizer = model, tokenizer
            self._eos_id = int(eos_id)
            self._pad_id = int(tokenizer.pad_token_id if tokenizer.pad_token_id is not None else eos_id)
            mx.eval(model.parameters())
        # Warm-up: compiles Metal kernels so the first real request is not slow, and fails fast on a bad model.
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
        import mlx.core as mx

        input_ids, attention_mask = pad_left(sequences, self._pad_id)
        allowed = build_attention_mask(attention_mask)
        mask = "causal" if allowed is None else mx.array(allowed)

        inner = self._model.model
        h = inner.embed_tokens(mx.array(input_ids))
        for layer in inner.layers:
            h = layer(h, mask, None)
        h = inner.norm(h)  # final hidden state, i.e. what lm_head would consume
        pooled = last_token_pool(h, attention_mask).astype(mx.float32)
        mx.eval(pooled)
        return np.array(pooled)

    def embed(self, texts: Sequence[str], is_query: bool = False) -> np.ndarray:
        """Embed texts into an (N, EMBEDDING_DIM) float32 array of unit vectors, in input order."""
        import mlx.core as mx

        with self._lock:
            sequences = self._tokenize(texts, is_query)
            batches = plan_batches(
                [len(s) for s in sequences], self.settings.inference_batch_size, self.settings.inference_token_budget
            )
            result = np.zeros((len(sequences), self.dim), dtype=np.float32)
            for batch in batches:
                vectors = self._forward([sequences[i] for i in batch])
                if not np.isfinite(vectors).all():
                    dtype = self.settings.dtype or "float16"
                    raise RuntimeError(f"Non-finite embedding (dtype={dtype}); try DTYPE=bfloat16")
                result[batch] = mrl_truncate(vectors, self.dim)
            mx.clear_cache()  # return the activation buffer cache to the OS between requests
            return result
