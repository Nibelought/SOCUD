"""TorchEmbedder against a tiny random Qwen3 (built from a config, no download). Skipped without torch (CI)."""

import numpy as np
import pytest

torch = pytest.importorskip("torch")
transformers = pytest.importorskip("transformers")

from config import Settings  # noqa: E402
from torch_embedder import TorchEmbedder  # noqa: E402

VOCAB = 300
EOS = 299


class ByteTokenizer:
    """Stand-in for the Qwen tokenizer: one token per UTF-8 byte (ids 0..255)."""

    pad_token_id = EOS

    def encode(self, text, add_special_tokens=False):
        return list(text.encode("utf-8"))


@pytest.fixture(scope="module")
def embedder():
    torch.manual_seed(0)
    config = transformers.Qwen3Config(
        vocab_size=VOCAB,
        hidden_size=32,
        intermediate_size=64,
        num_hidden_layers=2,
        num_attention_heads=4,
        num_key_value_heads=2,
        head_dim=8,
        max_position_embeddings=2048,
    )
    settings = Settings(_env_file=None, backend="torch", device="cpu", dtype="float32", embedding_dim=16)
    emb = TorchEmbedder(settings)
    emb._model = transformers.AutoModel.from_config(config).eval()
    emb._tokenizer = ByteTokenizer()
    emb._eos_id = EOS
    emb._pad_id = EOS
    return emb


TEXTS = ["short", "a considerably longer passage of text, long enough to force padding in a batch", "mid length text"]


def test_vectors_are_unit_norm_finite_and_in_mrl_dim(embedder):
    out = embedder.embed(TEXTS)
    assert out.shape == (3, 16) and out.dtype == np.float32
    assert np.isfinite(out).all()
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)


def test_padding_does_not_change_a_vector(embedder):
    batched = embedder.embed(TEXTS)
    alone = np.vstack([embedder.embed([t]) for t in TEXTS])
    assert np.allclose(batched, alone, atol=1e-5)


def test_result_order_matches_input_order_across_inference_batches(embedder):
    embedder.settings.inference_batch_size = 1  # forces one forward pass per text, in length order
    try:
        one_by_one = embedder.embed(TEXTS)
    finally:
        embedder.settings.inference_batch_size = 8
    assert np.allclose(one_by_one, embedder.embed(TEXTS), atol=1e-5)


def test_query_instruction_changes_the_vector_but_documents_get_none(embedder):
    assert not np.allclose(embedder.embed(["hello"], is_query=True), embedder.embed(["hello"], is_query=False))


def test_too_long_text_is_truncated_not_rejected(embedder):
    embedder.settings.max_tokens = 32
    try:
        out = embedder.embed(["x" * 500])
    finally:
        embedder.settings.max_tokens = 8192
    assert out.shape == (1, 16) and np.isfinite(out).all()


def test_out_of_memory_splits_the_batch(embedder, monkeypatch):
    real = embedder._forward

    def flaky(sequences):
        if len(sequences) > 1:
            raise torch.OutOfMemoryError("simulated")
        return real(sequences)

    expected = embedder.embed(TEXTS)
    monkeypatch.setattr(embedder, "_forward", flaky)
    assert np.allclose(embedder.embed(TEXTS), expected, atol=1e-5)


def test_out_of_memory_on_a_single_text_propagates(embedder, monkeypatch):
    def always_oom(_sequences):
        raise torch.OutOfMemoryError("simulated")

    monkeypatch.setattr(embedder, "_forward", always_oom)
    with pytest.raises(torch.OutOfMemoryError):
        embedder.embed(["x"])


def test_factory_builds_the_torch_embedder_for_the_torch_backend():
    from main import default_embedder_factory

    emb = default_embedder_factory(Settings(_env_file=None, backend="torch", device="cpu"))
    assert isinstance(emb, TorchEmbedder)
    assert (emb.device, emb.dtype, emb.model_name) == ("cpu", "float32", "Qwen/Qwen3-Embedding-4B")
