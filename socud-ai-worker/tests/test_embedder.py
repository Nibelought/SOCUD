import numpy as np
import pytest

from embedder import (
    build_attention_mask,
    clean_content,
    format_query,
    l2_normalize,
    last_token_pool,
    mrl_truncate,
    pad_left,
    plan_batches,
    prepare_text,
    truncate_with_eos,
)

TASK = "Given a search query, retrieve relevant passages from a knowledge base that answer the query"


# --- prompt formatting ---------------------------------------------------------------------------------------
def test_query_gets_instruction_without_space_after_query_colon():
    assert format_query("capital of China?", "Find it") == "Instruct: Find it\nQuery:capital of China?"


def test_prepare_text_documents_get_no_instruction():
    assert prepare_text("The capital of China is Beijing.", False, TASK) == "The capital of China is Beijing."


def test_prepare_text_queries_get_instruction_and_are_cleaned():
    assert prepare_text("**Bold** question", True, TASK) == f"Instruct: {TASK}\nQuery:Bold question"


# --- clean_content ---------------------------------------------------------------------------------------------
def test_clean_keeps_intra_word_hyphens():
    assert clean_content("Send an e-mail to the well-known state-of-the-art team") == (
        "Send an e-mail to the well-known state-of-the-art team"
    )


def test_clean_keeps_snake_case_and_math():
    assert clean_content("call my_function_name and $x^2 + y_1$") == "call my_function_name and $x^2 + y_1$"


def test_clean_strips_fence_markers_but_keeps_code():
    text = "Before\n```python\nprint('hi')\n```\nAfter"
    assert clean_content(text) == "Before\nprint('hi')\nAfter"


def test_clean_handles_fence_without_stray_space_and_multiple_blocks():
    text = "```\na\n```\ntext\n```js\nb\n```"
    assert clean_content(text) == "a\ntext\nb"


def test_clean_links_images_headings_lists_quotes():
    text = "# Title\n\n> quoted\n\n- item one\n* item two\n\nSee [docs](https://example.com/x) ![alt](img.png) now"
    assert clean_content(text) == "Title\n\nquoted\n\nitem one\nitem two\n\nSee docs now"


def test_clean_emphasis_and_horizontal_rule():
    assert clean_content("**bold** and __also__ and *em* text\n---\nnext") == "bold and also and em text\n\nnext"


def test_clean_keeps_unbalanced_asterisks_and_math_star():
    assert clean_content("2 * 3 = 6 and a*b") == "2 * 3 = 6 and a*b"


def test_clean_russian_and_whitespace():
    assert clean_content("  Привет,   мир!\r\n\r\n\r\n\r\nКак  дела?  ") == "Привет, мир!\n\nКак дела?"


def test_clean_empty():
    assert clean_content("") == ""
    assert clean_content("   \n ") == ""


# --- truncation ------------------------------------------------------------------------------------------------
def test_truncate_appends_eos():
    assert truncate_with_eos([1, 2, 3], 10, 99) == [1, 2, 3, 99]


def test_truncate_keeps_eos_when_too_long():
    out = truncate_with_eos(list(range(100)), 8, 99)
    assert len(out) == 8
    assert out == [0, 1, 2, 3, 4, 5, 6, 99]


def test_truncate_exact_fit_and_minimum():
    assert truncate_with_eos([1, 2, 3], 4, 99) == [1, 2, 3, 99]
    with pytest.raises(ValueError):
        truncate_with_eos([1], 1, 99)


# --- MRL / normalisation ---------------------------------------------------------------------------------------
def test_mrl_truncate_slices_then_renormalises():
    v = l2_normalize(np.array([[3.0, 4.0, 12.0, 84.0]]))
    out = mrl_truncate(v, 2)
    assert out.shape == (1, 2)
    np.testing.assert_allclose(out, [[0.6, 0.8]], atol=1e-6)
    np.testing.assert_allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-6)


def test_mrl_truncate_rejects_bad_dim():
    with pytest.raises(ValueError):
        mrl_truncate(np.ones((1, 4)), 5)
    with pytest.raises(ValueError):
        mrl_truncate(np.ones((1, 4)), 0)


def test_l2_normalize_zero_vector_is_finite():
    assert np.isfinite(l2_normalize(np.zeros((1, 3)))).all()


# --- padding, mask, pooling ------------------------------------------------------------------------------------
def test_pad_left_layout():
    ids, mask = pad_left([[1, 2, 3], [4]], pad_id=0)
    assert ids.tolist() == [[1, 2, 3], [0, 0, 4]]
    assert mask.tolist() == [[1, 1, 1], [0, 0, 1]]


def test_attention_mask_none_without_padding():
    assert build_attention_mask(np.ones((2, 3), dtype=int)) is None


def test_attention_mask_blocks_padding_keys_and_keeps_rows_finite():
    _, mask = pad_left([[1, 2, 3], [4]], pad_id=0)
    allowed = build_attention_mask(mask)
    assert allowed.shape == (2, 1, 3, 3)
    # Row 1 is [pad, pad, real]: the real token attends only to itself, never to padding.
    assert allowed[1, 0, 2].tolist() == [False, False, True]
    # Padding queries attend to themselves so softmax never sees an all-masked row.
    assert allowed[1, 0].any(axis=-1).all()
    # Row 0 has no padding: ordinary causal mask.
    assert allowed[0, 0].tolist() == np.tril(np.ones((3, 3), dtype=bool)).tolist()


def test_last_token_pool_left_padding():
    hidden = np.arange(2 * 3 * 2, dtype=float).reshape(2, 3, 2)
    _, mask = pad_left([[1, 2, 3], [4]], pad_id=0)
    np.testing.assert_array_equal(last_token_pool(hidden, mask), hidden[:, -1, :])


def test_last_token_pool_rejects_right_padding():
    with pytest.raises(ValueError):
        last_token_pool(np.zeros((1, 3, 2)), np.array([[1, 1, 0]]))


def _toy_last_hidden(embeddings, mask, allowed):
    """Single-head causal self-attention over fixed embeddings; returns the last-position output."""
    scores = embeddings @ embeddings.transpose(0, 2, 1) / np.sqrt(embeddings.shape[-1])
    if allowed is not None:
        scores = np.where(allowed[:, 0], scores, -1e9)
    else:
        scores = np.where(np.tril(np.ones(scores.shape[-2:], dtype=bool)), scores, -1e9)
    weights = np.exp(scores - scores.max(-1, keepdims=True))
    weights /= weights.sum(-1, keepdims=True)
    return last_token_pool(weights @ embeddings, mask)


def test_padding_does_not_leak_into_last_token_result():
    rng = np.random.default_rng(0)
    table = rng.normal(size=(20, 8))
    short, long_ = [5, 6], [1, 2, 3, 4, 5, 6, 7]
    # Batched with left padding (pad token embedding is deliberately non-zero garbage).
    ids, mask = pad_left([short, long_], pad_id=19)
    batched = _toy_last_hidden(table[ids], mask, build_attention_mask(mask))
    alone = _toy_last_hidden(table[np.array([short])], np.ones((1, 2), dtype=int), None)
    np.testing.assert_allclose(batched[0], alone[0], atol=1e-9)
    # Sanity: without the padding mask the result differs, so the test is discriminating.
    leaky = _toy_last_hidden(table[ids], mask, None)
    assert not np.allclose(leaky[0], alone[0], atol=1e-6)


# --- batch planning --------------------------------------------------------------------------------------------
def test_plan_batches_respects_size_and_token_budget_and_covers_all():
    lengths = [10, 500, 20, 480, 30, 1000]
    batches = plan_batches(lengths, max_batch_size=3, token_budget=1500)
    assert sorted(i for b in batches for i in b) == list(range(len(lengths)))
    for b in batches:
        assert len(b) <= 3
        assert len(b) * max(lengths[i] for i in b) <= 1500 or len(b) == 1
    assert batches[0][0] == 5  # longest first


def test_plan_batches_oversized_item_gets_own_batch():
    assert plan_batches([5000, 10], max_batch_size=8, token_budget=1000) == [[0], [1]]


def test_plan_batches_empty_and_invalid():
    assert plan_batches([], 4, 100) == []
    with pytest.raises(ValueError):
        plan_batches([1], 0, 100)
