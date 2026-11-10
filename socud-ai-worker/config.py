"""Worker settings (pydantic-settings). Values come from environment variables or a local .env file."""

import ipaddress
import platform
from typing import Literal, Optional

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_QUERY_INSTRUCTION = (
    "Given a search query, retrieve relevant passages from a knowledge base that answer the query"
)


# Default checkpoint per backend. Both are Qwen3-Embedding-4B, so they produce vectors of the same space
# (the MLX one is a 4-bit quantisation of the torch one).
DEFAULT_MODELS = {
    "mlx": "mlx-community/Qwen3-Embedding-4B-4bit-DWQ",  # ~2.3 GB
    "torch": "Qwen/Qwen3-Embedding-4B",  # ~8 GB in bf16
    "openai": "text-embedding-qwen3-embedding-4b",  # model id as listed by the remote server (LM Studio name)
}
# Default activation budget per backend (padded tokens per forward pass). The torch default is lower because a
# 12 GB GPU holds the ~8 GB of bf16 weights plus the activations.
DEFAULT_TOKEN_BUDGETS = {"mlx": 16384, "torch": 8192, "openai": 8192}  # openai: unused (the server batches)


def is_loopback_host(host: str) -> bool:
    """True for localhost and loopback IPs (127.0.0.0/8, ::1); anything else (0.0.0.0, a LAN IP) is remote."""
    if host.strip().lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip().strip("[]")).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())

    # Inference backend. "mlx": Apple Silicon (Metal). "torch": PyTorch + transformers on CUDA (NVIDIA GPU), MPS or
    # CPU, which is what lets the worker run on another machine, e.g. a PC with an RTX 4070. "auto" = mlx on an
    # Apple Silicon Mac, torch everywhere else. Resolved to "mlx" or "torch" at startup.
    # "openai": no local model; texts go to an OpenAI-compatible /v1/embeddings server on other hardware (LM Studio,
    # vLLM, Ollama, llama.cpp server, text-embeddings-inference ...) serving Qwen3-Embedding-4B; see REMOTE_URL.
    backend: Literal["auto", "mlx", "torch", "openai"] = "auto"
    # openai backend: base URL of the server including /v1, e.g. http://192.168.1.50:1234/v1 (MODEL_NAME is the model
    # id sent in the request). Optional bearer key and per-request timeout in seconds.
    remote_url: Optional[str] = None
    remote_api_key: Optional[str] = None
    remote_timeout: float = 120.0
    # openai backend: /embed requests forwarded to the server at the same time. 2 hides the per-request gaps of a GPU
    # server (measured on an RTX 4070: 8.3 -> 11 texts/s); more only queues on the GPU and adds latency.
    remote_concurrency: int = Field(default=2, ge=1, le=16)
    # Device of the torch backend: "auto" = cuda if available, else mps, else cpu. Ignored by mlx.
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"
    # Model checkpoint. Unset = the default of the backend (see DEFAULT_MODELS). Downloaded from Hugging Face on
    # first start. Resolved to a str at startup.
    model_name: Optional[str] = None
    # Output dimension after Matryoshka (MRL) truncation. Must match the backend's vector(1024) column.
    embedding_dim: int = 1024
    # Texts longer than this many tokens are truncated (the EOS token is always kept), never rejected.
    max_tokens: int = 8192
    # Instruction placed in front of *queries* only ("Instruct: {task}\nQuery:{text}"). Documents get none.
    query_instruction: str = DEFAULT_QUERY_INSTRUCTION

    # Compute dtype. Unset = float16 for mlx (~15-20% faster than the checkpoint's bfloat16 on M1/M2, which has no
    # native bf16; embeddings changed by cosine >= 0.9998 in testing), bfloat16 for torch on CUDA (native on Ada/
    # Ampere GPUs, the checkpoint's own dtype), float16 on mps, float32 on cpu.
    dtype: Optional[Literal["float16", "bfloat16", "float32"]] = None

    # API limits
    max_batch_size: int = 32
    max_text_length: int = 32000

    # Inference batching: a forward pass holds at most `inference_batch_size` texts and at most
    # `inference_token_budget` padded tokens (batch * longest sequence), whichever is reached first.
    # `inference_token_budget` unset = the default of the backend (see DEFAULT_TOKEN_BUDGETS).
    inference_batch_size: int = 8
    inference_token_budget: Optional[int] = None

    # Loopback by default. To serve another machine (a remote GPU worker) bind 0.0.0.0 or a LAN IP; the worker then
    # refuses to start without WORKER_TOKEN.
    host: str = "127.0.0.1"
    port: int = 8000
    # Shared secret for POST /embed (header X-Worker-Token). Empty/unset = no token required, which is only
    # allowed while the worker listens on loopback.
    worker_token: Optional[str] = None

    @model_validator(mode="after")
    def _resolve_defaults(self) -> "Settings":
        if self.backend == "auto":
            self.backend = "mlx" if platform.system() == "Darwin" and platform.machine() == "arm64" else "torch"
        if self.backend == "openai" and not self.remote_url:
            raise ValueError("BACKEND=openai requires REMOTE_URL, e.g. http://192.168.1.50:1234/v1")
        if not self.model_name:
            self.model_name = DEFAULT_MODELS[self.backend]
        if self.inference_token_budget is None:
            self.inference_token_budget = DEFAULT_TOKEN_BUDGETS[self.backend]
        if not self.worker_token and not is_loopback_host(self.host):
            raise ValueError(
                f"HOST={self.host} makes the worker reachable from the network, which requires WORKER_TOKEN "
                "(the same value as AI_WORKER_TOKEN in the backend). Generate one: openssl rand -hex 32"
            )
        return self
