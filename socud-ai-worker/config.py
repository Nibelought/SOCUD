"""Worker settings (pydantic-settings). Values come from environment variables or a local .env file."""

from typing import Literal, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_QUERY_INSTRUCTION = (
    "Given a search query, retrieve relevant passages from a knowledge base that answer the query"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())

    # MLX checkpoint (Qwen3-Embedding-4B, 4-bit DWQ). Downloaded from Hugging Face on first start (~2.3 GB).
    model_name: str = "mlx-community/Qwen3-Embedding-4B-4bit-DWQ"
    # Output dimension after Matryoshka (MRL) truncation. Must match the backend's vector(1024) column.
    embedding_dim: int = 1024
    # Texts longer than this many tokens are truncated (the EOS token is always kept), never rejected.
    max_tokens: int = 8192
    # Instruction placed in front of *queries* only ("Instruct: {task}\nQuery:{text}"). Documents get none.
    query_instruction: str = DEFAULT_QUERY_INSTRUCTION

    # Compute dtype. float16 is ~15-20% faster than the checkpoint's bfloat16 on M1/M2 (no native bf16) and
    # changed embeddings by cosine >= 0.9998 in testing. Use "bfloat16" to keep the checkpoint dtype.
    dtype: Literal["float16", "bfloat16"] = "float16"

    # API limits
    max_batch_size: int = 32
    max_text_length: int = 32000

    # Inference batching: a forward pass holds at most `inference_batch_size` texts and at most
    # `inference_token_budget` padded tokens (batch * longest sequence), whichever is reached first.
    inference_batch_size: int = 8
    inference_token_budget: int = 16384

    # Loopback by default: the worker has no user authentication of its own.
    host: str = "127.0.0.1"
    port: int = 8000
    # Shared secret for POST /embed (header X-Worker-Token). Empty/unset = no token required.
    worker_token: Optional[str] = None
