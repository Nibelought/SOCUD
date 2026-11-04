import re
import torch
import logging
import asyncio
from functools import partial
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings
from typing import List
from sentence_transformers import SentenceTransformer

# --- Конфигурация ---
class Settings(BaseSettings):
    model_name: str = "intfloat/multilingual-e5-base"
    max_batch_size: int = 32
    max_text_length: int = 15000
    inference_batch_size: int = 16

    class Config:
        env_file = ".env"

settings = Settings()

# --- Логирование ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Knowledge Base Vectorizer API", version="2.1.0")

# --- Инициализация ML-ресурсов ---
def get_device() -> str:
    """Определение доступного аппаратного ускорителя."""
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    return "cpu"

device = get_device()
logger.info(f"Инициализация модели '{settings.model_name}' на устройстве: {device}")

try:
    model = SentenceTransformer(settings.model_name, device=device)
    # Оптимизация VRAM (FP16) только для CUDA
    if device == "cuda":
        model.half()
except Exception as e:
    logger.error(f"Критическая ошибка загрузки модели: {e}")
    raise

# --- Схемы данных (Pydantic V2) ---
class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=settings.max_batch_size)
    is_query: bool = False

    @field_validator('texts')
    @classmethod
    def check_length(cls, v):
        for text in v:
            if len(text) > settings.max_text_length:
                raise ValueError(f"Текст превышает лимит {settings.max_text_length} символов")
        return v

# --- Препроцессинг ---
def clean_content(text: str) -> str:
    """Удаление синтаксического шума Markdown/LaTeX перед инференсом."""
    text = re.sub(r'```[\s\S]*? ```', ' [code] ', text)
    text = re.sub(r'\$\$[\s\S]*?\$\$', ' [formula] ', text)
    text = re.sub(r'\$.*?\$', ' [formula] ', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'!\[[^\]]*\]\([^\)]+\)', '', text)
    text = re.sub(r'[*_#>-]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    print(text)
    return text

# --- Роуты API ---
@app.get("/health")
async def health_check():
    """Эндпоинт для оркестраторов (Docker/K8s)."""
    return {"status": "ok", "device": device, "model": settings.model_name}

@app.post("/embed")
async def get_embeddings(req: EmbedRequest):
    try:
        prefix = "query: " if req.is_query else "passage: "
        processed = [prefix + clean_content(t) for t in req.texts]

        # Делегирование тяжелой задачи в пул потоков во избежание блокировки Event Loop
        loop = asyncio.get_running_loop()
        func = partial(
            model.encode,
            processed,
            normalize_embeddings=True,
            batch_size=settings.inference_batch_size,
            convert_to_numpy=True
        )

        embeddings_array = await loop.run_in_executor(None, func)

        return {"embeddings": embeddings_array.tolist(), "device": device}

    except Exception as e:
        logger.error(f"Ошибка инференса: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)