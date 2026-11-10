"""Embedder that runs the model on other hardware: an OpenAI-compatible `POST {REMOTE_URL}/embeddings` server
(LM Studio, vLLM, Ollama, llama.cpp server, text-embeddings-inference ...) serving Qwen3-Embedding-4B.

The worker keeps everything that defines the vector space itself: markdown cleaning, the query instruction (queries
only), Matryoshka truncation to EMBEDDING_DIM and L2 renormalisation, so the backend sees the same API and the same
kind of vectors whatever runs the model. The server is expected to pool like Qwen3-Embedding (last token) and to
append the end-of-text token; `scripts/compare_workers.py` and `scripts/smoke_test.py` check that.
Standard library HTTP only; no model, no torch, no mlx.
"""

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Sequence

import numpy as np

from config import Settings
from embedder import mrl_truncate, prepare_text

logger = logging.getLogger(__name__)


class RemoteEmbedder:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.model_name
        self.dim = settings.embedding_dim
        self.concurrency = settings.remote_concurrency  # thread-safe: the API may call embed() from several threads
        self.url = settings.remote_url.rstrip("/") + "/embeddings"
        self.device = f"remote:{urllib.parse.urlparse(self.url).netloc}"

    def load(self) -> None:
        """Probe the server. An unreachable server only warns (the PC may be switched on later); a vector that cannot
        be cut to EMBEDDING_DIM is a configuration error and fails the start."""
        try:
            self.embed(["warm-up"], is_query=False)
        except _ServerError as e:
            logger.warning("Remote embedding server not usable yet (%s); will retry on each request", e)
            return
        logger.info("Remote embedding server %s ready (model %s)", self.url, self.model_name)

    def _post(self, texts: list[str]) -> list[list[float]]:
        headers = {"Content-Type": "application/json"}
        if self.settings.remote_api_key:
            headers["Authorization"] = f"Bearer {self.settings.remote_api_key}"
        req = urllib.request.Request(
            self.url, data=json.dumps({"model": self.model_name, "input": texts}).encode(), headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=self.settings.remote_timeout) as res:
                body = json.load(res)
        except urllib.error.HTTPError as e:
            detail = e.read(300).decode("utf-8", "replace")
            raise _ServerError(f"{self.url} responded {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            raise _ServerError(f"{self.url} unreachable or invalid: {e}") from e
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or len(data) != len(texts):
            raise _ServerError(
                f"{self.url} returned {len(data) if isinstance(data, list) else 'no'} embeddings for {len(texts)} texts"
            )
        data = sorted(data, key=lambda item: item.get("index", 0))
        return [item["embedding"] for item in data]

    def embed(self, texts: Sequence[str], is_query: bool = False) -> np.ndarray:
        """Embed texts into an (N, EMBEDDING_DIM) float32 array of unit vectors, in input order."""
        prepared = [prepare_text(t, is_query, self.settings.query_instruction) for t in texts]
        vectors = np.asarray(self._post(prepared), dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[1] < self.dim:
            raise ValueError(
                f"Server returned vectors of shape {vectors.shape}; EMBEDDING_DIM={self.dim} needs at least that many "
                "components (Qwen3-Embedding-4B has 2560)"
            )
        if not np.isfinite(vectors).all():
            raise _ServerError("Server returned non-finite values")
        return mrl_truncate(vectors, self.dim)


class _ServerError(RuntimeError):
    """The remote server failed (network, HTTP error, bad response). Surfaces as HTTP 500 from /embed, which the
    backend retries."""
