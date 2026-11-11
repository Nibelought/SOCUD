# syntax=docker/dockerfile:1
#
# AI worker for Linux containers: the PyTorch backend (BACKEND=torch), on the CPU by default.
# NOT for macOS hosts: Apple's MLX/Metal is unavailable inside Docker, so the default MLX worker keeps running natively
# on the Mac (README "AI worker"). Use this image on a Linux machine, for CI-like setups or, with TORCH_VARIANT=cuda,
# on an NVIDIA GPU host (needs the NVIDIA container toolkit and a `gpus` / device reservation; see README).
#
#   docker build -t socud-ai-worker socud-ai-worker                       # CPU wheels (image ~1.2 GB)
#   docker build --build-arg TORCH_VARIANT=cu132 -t socud-ai-worker:cuda socud-ai-worker   # CUDA wheels (several GB)
# The torch version pinned in requirements-cuda.txt must exist on the chosen index (2.15.0: cpu, cu132, cu134; an older
# NVIDIA driver needs an older CUDA variant AND a lower pin, then regenerate constraints.txt, README "Updating the Python pins").
#
# The model (Qwen/Qwen3-Embedding-4B, ~8 GB) is NOT part of the image: it downloads into $HF_HOME (the /data/hf volume)
# on first start. Mount a volume there so it survives restarts.

ARG PYTHON_VERSION=3.12

# ---- build: virtualenv with the pinned dependencies -------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS build
# Folder name of https://download.pytorch.org/whl/<variant>: cpu (default), cu132 ...
ARG TORCH_VARIANT=cpu
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements-cuda.txt constraints.txt ./
# torch first, from the PyTorch index (PyPI's Linux wheel drags in the multi-GB CUDA libraries even for the CPU).
# PyPI stays an extra index for torch's own dependencies; the exact pin comes from requirements-cuda.txt.
RUN pip install -c constraints.txt --index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" \
        --extra-index-url https://pypi.org/simple "$(grep -E '^torch==' requirements-cuda.txt)" \
    && pip install -c constraints.txt -r requirements-cuda.txt

# ---- runtime ----------------------------------------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime
RUN useradd --system --uid 10001 --create-home --home-dir /home/worker worker \
    && mkdir -p /data/hf && chown -R worker:worker /data
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY config.py main.py embedder.py torch_embedder.py remote_embedder.py mlx_embedder.py ./

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/data/hf \
    BACKEND=torch \
    PORT=8000
# Inside the container the worker must listen on all interfaces so that other containers can reach it. The worker then
# REFUSES TO START without WORKER_TOKEN (config.py), which is what keeps it safe: publish no port on the host, and keep
# it on a private network (docker-compose.yml: `ai-worker`, profile `worker`).
ENV HOST=0.0.0.0

USER worker
VOLUME ["/data/hf"]
EXPOSE 8000

# 200 only once the model is loaded (503 while loading or after a load error), so the first start, which downloads
# the model, needs a long start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=5 \
    CMD ["python", "-c", "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"]

CMD ["python", "main.py"]
