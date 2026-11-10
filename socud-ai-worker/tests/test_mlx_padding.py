"""MLX-level check that left padding does not change the pooled vector. Skipped where mlx is unavailable (CI)."""

import numpy as np
import pytest

mx = pytest.importorskip("mlx.core")
nn = pytest.importorskip("mlx.nn")

from embedder import build_attention_mask, last_token_pool, pad_left  # noqa: E402


class TinyBlock(nn.Module):
    def __init__(self, dim=16, heads=2):
        super().__init__()
        self.heads = heads
        self.qkv = nn.Linear(dim, dim * 3, bias=False)
        self.out = nn.Linear(dim, dim, bias=False)

    def __call__(self, x, mask):
        b, length, dim = x.shape
        q, k, v = mx.split(self.qkv(x), 3, axis=-1)
        q, k, v = (t.reshape(b, length, self.heads, -1).transpose(0, 2, 1, 3) for t in (q, k, v))
        scale = (dim // self.heads) ** -0.5
        o = mx.fast.scaled_dot_product_attention(q, k, v, scale=scale, mask=mask)
        return x + self.out(o.transpose(0, 2, 1, 3).reshape(b, length, dim))


def _run(blocks, table, ids, mask_np):
    allowed = build_attention_mask(mask_np)
    mask = "causal" if allowed is None else mx.array(allowed)
    h = table[mx.array(ids)]
    for block in blocks:
        h = block(h, mask)
    return np.array(last_token_pool(h, mask_np))


def test_left_padded_batch_equals_unpadded_single_and_is_finite():
    mx.random.seed(0)
    table = mx.random.normal((30, 16))
    blocks = [TinyBlock(), TinyBlock()]
    short, long_ = [5, 6, 7], [1, 2, 3, 4, 5, 6, 7, 8, 9]
    ids, mask = pad_left([short, long_], pad_id=29)
    batched = _run(blocks, table, ids, mask)
    alone = _run(blocks, table, np.array([short]), np.ones((1, 3), dtype=int))
    assert np.isfinite(batched).all()
    np.testing.assert_allclose(batched[0], alone[0], atol=1e-4)
