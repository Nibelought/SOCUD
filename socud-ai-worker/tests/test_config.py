"""Settings resolution (backend, model, token budget) and the network-exposure guard. No model, no torch."""

import pytest
from pydantic import ValidationError

from config import DEFAULT_MODELS, DEFAULT_TOKEN_BUDGETS, Settings, is_loopback_host
from torch_embedder import resolve_device, resolve_dtype


def make(**kw):
    return Settings(_env_file=None, **kw)


def test_backend_defaults_follow_the_backend():
    for backend in ("mlx", "torch"):
        s = make(backend=backend)
        assert s.model_name == DEFAULT_MODELS[backend]
        assert s.inference_token_budget == DEFAULT_TOKEN_BUDGETS[backend]


def test_auto_backend_resolves_to_a_concrete_one(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Darwin")
    monkeypatch.setattr("platform.machine", lambda: "arm64")
    assert make().backend == "mlx"
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.machine", lambda: "x86_64")
    assert make().backend == "torch"


def test_explicit_values_are_kept():
    s = make(backend="torch", model_name="org/custom", inference_token_budget=1234)
    assert (s.model_name, s.inference_token_budget) == ("org/custom", 1234)


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.5", "localhost", "::1", "[::1]"])
def test_loopback_hosts_need_no_token(host):
    assert is_loopback_host(host)
    assert make(host=host).worker_token is None


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.50", "worker.lan"])
def test_network_hosts_require_a_token(host):
    assert not is_loopback_host(host)
    with pytest.raises(ValidationError, match="WORKER_TOKEN"):
        make(host=host)
    with pytest.raises(ValidationError, match="WORKER_TOKEN"):
        make(host=host, worker_token="")
    assert make(host=host, worker_token="secret").host == host


class FakeTorch:
    def __init__(self, cuda=False, mps=False):
        self.cuda = type("cuda", (), {"is_available": staticmethod(lambda: cuda)})
        self.backends = type("backends", (), {"mps": type("mps", (), {"is_available": staticmethod(lambda: mps)})})


def test_device_auto_prefers_cuda_then_mps_then_cpu():
    assert resolve_device("auto", FakeTorch(cuda=True, mps=True)) == "cuda"
    assert resolve_device("auto", FakeTorch(mps=True)) == "mps"
    assert resolve_device("auto", FakeTorch()) == "cpu"


def test_explicit_unavailable_device_is_an_error_not_a_silent_cpu_fallback():
    with pytest.raises(RuntimeError, match="CUDA"):
        resolve_device("cuda", FakeTorch())
    with pytest.raises(RuntimeError, match="MPS"):
        resolve_device("mps", FakeTorch())
    assert resolve_device("cpu", FakeTorch(cuda=True)) == "cpu"


def test_dtype_defaults_per_device():
    assert resolve_dtype(None, "cuda") == "bfloat16"
    assert resolve_dtype(None, "mps") == "float16"
    assert resolve_dtype(None, "cpu") == "float32"
    assert resolve_dtype("float16", "cuda") == "float16"
