import numpy as np
import pytest
from fastapi.testclient import TestClient

from config import Settings
from main import create_app


class StubEmbedder:
    model_name = "stub-model"
    dim = 1024
    device = "mlx"

    def __init__(self, fail_load=False, fail_embed=False):
        self.fail_load = fail_load
        self.fail_embed = fail_embed
        self.calls = []

    def load(self):
        if self.fail_load:
            raise RuntimeError("boom")

    def embed(self, texts, is_query=False):
        if self.fail_embed:
            raise RuntimeError("inference exploded")
        self.calls.append((list(texts), is_query))
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        out[:, 0] = 1.0
        return out


def make_client(stub=None, **overrides):
    stub = stub or StubEmbedder()
    settings = Settings(_env_file=None, **overrides)
    return TestClient(create_app(settings, lambda _s: stub)), stub


def test_health_ok_after_startup():
    client, _ = make_client()
    with client:
        res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "model": "stub-model", "dim": 1024, "device": "mlx"}


def test_health_reports_loading_before_lifespan_and_503():
    client, _ = make_client()
    # Not entered as a context manager: lifespan has not run, so the model is not loaded.
    res = client.get("/health")
    assert res.status_code == 503
    assert res.json()["status"] == "loading"
    assert client.post("/embed", json={"texts": ["a"]}).status_code == 503


def test_health_reports_load_error():
    client, _ = make_client(StubEmbedder(fail_load=True))
    with client:
        res = client.get("/health")
        assert res.status_code == 503
        assert res.json()["status"] == "error"
        assert "boom" in res.json()["error"]
        assert client.post("/embed", json={"texts": ["a"]}).status_code == 503


def test_embed_returns_embeddings_and_passes_is_query():
    client, stub = make_client()
    with client:
        res = client.post("/embed", json={"texts": ["a", "b"], "is_query": True})
    body = res.json()
    assert res.status_code == 200
    assert body["model"] == "stub-model" and body["dim"] == 1024
    assert len(body["embeddings"]) == 2 and len(body["embeddings"][0]) == 1024
    assert stub.calls == [(["a", "b"], True)]


def test_is_query_defaults_to_false():
    client, stub = make_client()
    with client:
        client.post("/embed", json={"texts": ["a"]})
    assert stub.calls[0][1] is False


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"texts": []},
        {"texts": "not a list"},
        {"texts": [1, 2]},
        {"texts": ["x"] * 33},
        {"texts": ["a"], "is_query": "maybe"},
    ],
)
def test_embed_validation_422(payload):
    client, _ = make_client()
    with client:
        assert client.post("/embed", json=payload).status_code == 422


def test_embed_rejects_overlong_text_but_accepts_the_limit():
    client, _ = make_client(max_text_length=10)
    with client:
        assert client.post("/embed", json={"texts": ["x" * 11]}).status_code == 422
        assert client.post("/embed", json={"texts": ["x" * 10]}).status_code == 200


def test_default_limits_match_contract():
    s = Settings(_env_file=None, backend="mlx")
    assert (s.embedding_dim, s.max_tokens, s.max_batch_size, s.max_text_length) == (1024, 8192, 32, 32000)
    assert s.host == "127.0.0.1"
    assert s.model_name == "mlx-community/Qwen3-Embedding-4B-4bit-DWQ"


def test_token_required_when_configured():
    client, stub = make_client(worker_token="s3cret")
    with client:
        body = {"texts": ["a"]}
        assert client.post("/embed", json=body).status_code == 401
        assert client.post("/embed", json=body, headers={"X-Worker-Token": "wrong"}).status_code == 401
        assert client.post("/embed", json=body, headers={"X-Worker-Token": "s3cret"}).status_code == 200
        # Auth is checked before body validation, and /health stays open.
        assert client.post("/embed", json={}).status_code == 401
        assert client.get("/health").status_code == 200
    assert len(stub.calls) == 1


def test_non_ascii_token_header_is_rejected_not_a_server_error():
    client, _ = make_client(worker_token="s3cret")
    with client:
        res = client.post("/embed", json={"texts": ["a"]}, headers={"X-Worker-Token": "sécret".encode()})
    assert res.status_code == 401


def test_no_token_configured_means_open():
    client, _ = make_client(worker_token="")
    with client:
        assert client.post("/embed", json={"texts": ["a"]}).status_code == 200


def test_inference_failure_is_500_without_details():
    client, _ = make_client(StubEmbedder(fail_embed=True))
    with client:
        res = client.post("/embed", json={"texts": ["a"]})
    assert res.status_code == 500
    assert "exploded" not in res.text
