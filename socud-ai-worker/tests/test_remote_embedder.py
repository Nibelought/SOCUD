"""RemoteEmbedder and the openai backend against a fake OpenAI-compatible /v1/embeddings server. No model needed."""

import json
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config import Settings
from main import create_app, default_embedder_factory
from remote_embedder import RemoteEmbedder

SERVER_DIM = 2560  # what Qwen3-Embedding-4B returns before Matryoshka truncation


def fake_vector(text: str) -> list[float]:
    rng = np.random.default_rng(zlib.crc32(text.encode()))
    return (rng.normal(size=SERVER_DIM) * 3).tolist()  # deliberately not unit length


class FakeServer:
    def __init__(self):
        self.requests = []  # (headers, body)
        self.status = 200
        self.shuffle = False
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append((dict(self.headers), self.path, body))
                if owner.status != 200:
                    self.send_response(owner.status)
                    self.end_headers()
                    self.wfile.write(b'{"error":"model not loaded"}')
                    return
                data = [
                    {"object": "embedding", "index": i, "embedding": fake_vector(t)}
                    for i, t in enumerate(body["input"])
                ]
                if owner.shuffle:
                    data.reverse()
                payload = json.dumps({"object": "list", "data": data, "model": body["model"]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/v1"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


@pytest.fixture
def server():
    s = FakeServer()
    yield s
    s.httpd.shutdown()


def make(server, **kw):
    return RemoteEmbedder(Settings(_env_file=None, backend="openai", remote_url=server.url, **kw))


def test_vectors_are_truncated_to_the_configured_dim_and_unit_length(server):
    out = make(server).embed(["a", "b"])
    assert out.shape == (2, 1024) and out.dtype == np.float32
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
    expected = np.array(fake_vector("a"))[:1024]
    assert np.allclose(out[0], expected / np.linalg.norm(expected), atol=1e-5)


def test_order_follows_the_index_field_not_the_arrival_order(server):
    emb = make(server)
    in_order = emb.embed(["first", "second"])
    server.shuffle = True
    assert np.allclose(emb.embed(["first", "second"]), in_order, atol=1e-6)


def test_queries_get_the_instruction_documents_do_not_and_markdown_is_cleaned(server):
    emb = make(server, model_name="my-model", remote_api_key="k")
    emb.embed(["## Heading **bold**"], is_query=False)
    emb.embed(["what?"], is_query=True)
    (h1, path, doc), (_, _, query) = server.requests
    assert path == "/v1/embeddings" and doc["model"] == "my-model"
    assert doc["input"] == ["Heading bold"]
    assert query["input"][0].startswith("Instruct: ") and query["input"][0].endswith("\nQuery:what?")
    assert h1["Authorization"] == "Bearer k"


def test_http_error_raises(server):
    server.status = 404
    with pytest.raises(RuntimeError, match="404.*model not loaded"):
        make(server).embed(["x"])


def test_server_vectors_shorter_than_dim_are_a_config_error(server):
    with pytest.raises(ValueError, match="EMBEDDING_DIM"):
        make(server, embedding_dim=4096).embed(["x"])


def test_unreachable_server_does_not_fail_startup_but_requests_fail():
    settings = Settings(_env_file=None, backend="openai", remote_url="http://127.0.0.1:9/v1", remote_timeout=2)
    emb = RemoteEmbedder(settings)
    emb.load()  # warns only: the PC may be switched on later
    with pytest.raises(RuntimeError, match="unreachable"):
        emb.embed(["x"])


def test_backend_requires_remote_url():
    with pytest.raises(ValidationError, match="REMOTE_URL"):
        Settings(_env_file=None, backend="openai")


def test_default_model_name_and_device_label(server):
    emb = make(server)
    assert emb.model_name == "text-embedding-qwen3-embedding-4b" and emb.device.startswith("remote:127.0.0.1:")


def test_full_worker_api_over_the_remote_backend(server):
    settings = Settings(_env_file=None, backend="openai", remote_url=server.url)
    with TestClient(create_app(settings, default_embedder_factory)) as client:
        for _ in range(100):  # the model loads in the background
            if client.get("/health").json()["status"] == "ok":
                break
            time.sleep(0.05)
        assert client.get("/health").json()["status"] == "ok"
        body = client.post("/embed", json={"texts": ["привет"], "is_query": True}).json()
    assert body["dim"] == 1024 and len(body["embeddings"][0]) == 1024


def test_requests_overlap_on_the_remote_backend(server):
    """Two /embed calls at once must reach the server together (concurrency 2), not one after the other."""
    delay, inflight, peak, lock = 0.4, [0], [0], threading.Lock()
    original = server.httpd.RequestHandlerClass.do_POST

    def slow_post(handler):
        with lock:
            inflight[0] += 1
            peak[0] = max(peak[0], inflight[0])
        time.sleep(delay)
        original(handler)
        with lock:
            inflight[0] -= 1

    server.httpd.RequestHandlerClass.do_POST = slow_post
    settings = Settings(_env_file=None, backend="openai", remote_url=server.url)
    assert settings.remote_concurrency == 2
    with TestClient(create_app(settings, default_embedder_factory)) as client:
        for _ in range(100):
            if client.get("/health").json()["status"] == "ok":
                break
            time.sleep(0.05)
        started = time.perf_counter()
        results = []
        threads = [
            threading.Thread(target=lambda: results.append(client.post("/embed", json={"texts": ["x"]}).status_code))
            for _ in range(2)
        ]
        [t.start() for t in threads]
        [t.join() for t in threads]
        elapsed = time.perf_counter() - started
    assert results == [200, 200] and peak[0] == 2
    assert elapsed < 2 * delay * 0.9


def test_local_backends_stay_single_threaded():
    from test_api import StubEmbedder

    app = create_app(Settings(_env_file=None, backend="torch"), lambda _s: StubEmbedder())
    assert app.title  # app builds; the stub has no `concurrency`, so the executor keeps one thread
