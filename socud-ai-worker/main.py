"""SOCUD AI worker: HTTP API around the Qwen3 embedding model.

Runs natively on Apple Silicon (MLX) or on any machine with PyTorch, e.g. a PC with an NVIDIA GPU (CUDA)."""

import asyncio
import logging
import secrets
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Callable, Optional, Protocol

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from config import Settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("socud.worker")


class Embedder(Protocol):
    """What the API needs from the model layer; tests substitute a stub."""

    model_name: str
    dim: int
    device: str

    def load(self) -> None: ...

    def embed(self, texts: list[str], is_query: bool = False) -> np.ndarray: ...


def default_embedder_factory(settings: Settings) -> Embedder:
    # Imported lazily: each backend needs its own heavy dependency (mlx on Apple Silicon, torch elsewhere).
    if settings.backend == "mlx":
        from mlx_embedder import MlxEmbedder

        return MlxEmbedder(settings)
    if settings.backend == "openai":
        from remote_embedder import RemoteEmbedder

        return RemoteEmbedder(settings)
    try:
        from torch_embedder import TorchEmbedder

        return TorchEmbedder(settings)
    except ModuleNotFoundError as e:
        if e.name and e.name.split(".")[0] in {"torch", "transformers"}:
            raise RuntimeError(
                f"BACKEND=torch needs {e.name}: install the PyTorch dependencies with requirements-cuda.txt "
                "(see README, \"Running the worker on another machine\")"
            ) from e
        raise


def make_embed_request(settings: Settings) -> type[BaseModel]:
    class EmbedRequest(BaseModel):
        texts: list[str] = Field(..., min_length=1, max_length=settings.max_batch_size)
        is_query: bool = False

        @field_validator("texts")
        @classmethod
        def check_length(cls, v: list[str]) -> list[str]:
            for text in v:
                if len(text) > settings.max_text_length:
                    raise ValueError(f"Text exceeds the limit of {settings.max_text_length} characters")
            return v

    return EmbedRequest


def create_app(
    settings: Optional[Settings] = None,
    embedder_factory: Callable[[Settings], Embedder] = default_embedder_factory,
) -> FastAPI:
    settings = settings or Settings()
    embedder = embedder_factory(settings)
    EmbedRequest = make_embed_request(settings)
    # One dedicated thread runs every local model call (loading and inference): MLX streams are per-thread, and a single
    # worker also serialises access to the model (the embedder additionally holds a lock).
    # A remote server can take several requests at once (RemoteEmbedder.concurrency); local models cannot.
    executor = ThreadPoolExecutor(max_workers=getattr(embedder, "concurrency", 1), thread_name_prefix="embed")
    state = {"status": "loading", "error": None}

    async def load_model() -> None:
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(executor, embedder.load)
            state["status"] = "ok"
        except Exception as e:  # keep serving /health so the failure is visible
            state["status"] = "error"
            state["error"] = f"{type(e).__name__}: {e}"
            logger.exception("Model failed to load")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Load in the background so the port opens immediately and /health reports "loading" (503).
        task = asyncio.create_task(load_model())
        try:
            yield
        finally:
            task.cancel()
            executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="SOCUD embedding worker", version="3.0.0", lifespan=lifespan)

    def require_worker_token(x_worker_token: Optional[str] = Header(default=None)) -> None:
        """If WORKER_TOKEN is set, /embed requires a matching X-Worker-Token header."""
        expected = settings.worker_token
        if not expected:
            return
        provided = x_worker_token or ""
        # Constant-time comparison on bytes (allows non-ASCII values)
        if not secrets.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
            raise HTTPException(status_code=401, detail="Invalid or missing worker token")

    @app.get("/health")
    async def health():
        body = {
            "status": state["status"],
            "model": embedder.model_name,
            "dim": embedder.dim,
            "device": embedder.device,
        }
        if state["status"] == "error":
            body["error"] = state["error"]
        return JSONResponse(body, status_code=200 if state["status"] == "ok" else 503)

    @app.post("/embed", dependencies=[Depends(require_worker_token)])
    async def embed(req: EmbedRequest):  # type: ignore[valid-type]
        if state["status"] != "ok":
            raise HTTPException(status_code=503, detail=f"Model is not ready ({state['status']})")
        try:
            loop = asyncio.get_running_loop()
            vectors = await loop.run_in_executor(executor, embedder.embed, req.texts, req.is_query)
        except Exception as e:
            logger.exception("Inference failed")
            raise HTTPException(status_code=500, detail="Internal Server Error") from e
        return {"embeddings": vectors.tolist(), "model": embedder.model_name, "dim": embedder.dim}

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    _settings = Settings()
    uvicorn.run(app, host=_settings.host, port=_settings.port)
