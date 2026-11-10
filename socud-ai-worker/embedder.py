"""Pure helpers for the embedding pipeline. Depends on numpy only, so it is unit-testable without MLX or the model.

Reference semantics: Qwen/Qwen3-Embedding-4B (last-token pooling over the final hidden state, left padding,
EOS appended, instruction on queries only, L2 normalisation) plus Matryoshka truncation (slice, renormalise).
"""

import re
from typing import Optional, Sequence

import numpy as np

# --- Text preprocessing -----------------------------------------------------------------------------------------
# Qwen3-Embedding is trained on raw web text and copes with markdown and LaTeX, so cleaning is deliberately light:
# remove only syntax that carries no meaning (fence markers, link targets, image embeds, heading/list/quote markers,
# emphasis delimiters). Code bodies, formulas, and hyphens/underscores inside words are left untouched.

_FENCE_LINE = re.compile(r"^[ \t]*(?:```+|~~~+)[^\n]*\n?", re.MULTILINE)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.MULTILINE)
_QUOTE = re.compile(r"^[ \t]*>+[ \t]?", re.MULTILINE)
_BULLET = re.compile(r"^[ \t]*[-*+][ \t]+", re.MULTILINE)
_RULE = re.compile(r"^[ \t]*(?:[-*_][ \t]*){3,}$", re.MULTILINE)
_BOLD = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1", re.DOTALL)
_ITALIC_STAR = re.compile(r"(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])")
_SPACES = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def clean_content(text: str) -> str:
    """Strip markdown markers that carry no meaning; keep words, code, formulas and intra-word hyphens."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _FENCE_LINE.sub("", text)
    text = _IMAGE.sub("", text)
    text = _LINK.sub(r"\1", text)
    text = _RULE.sub("", text)
    text = _HEADING.sub("", text)
    text = _QUOTE.sub("", text)
    text = _BULLET.sub("", text)
    text = _BOLD.sub(r"\2", text)
    text = _ITALIC_STAR.sub(r"\1", text)
    text = _SPACES.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip()


def format_query(text: str, task: str) -> str:
    """Official Qwen3-Embedding query format. Note: no space after 'Query:'."""
    return f"Instruct: {task}\nQuery:{text}"


def prepare_text(text: str, is_query: bool, task: str) -> str:
    """Clean a text and, for queries only, prepend the task instruction. Documents get no instruction."""
    cleaned = clean_content(text)
    return format_query(cleaned, task) if is_query else cleaned


# --- Tokens -----------------------------------------------------------------------------------------------------
def truncate_with_eos(ids: Sequence[int], max_tokens: int, eos_id: int) -> list[int]:
    """Return at most `max_tokens` ids that always end with `eos_id` (the pooled position).

    `ids` must be tokenised without special tokens. Over-long inputs lose their tail, never the EOS.
    """
    if max_tokens < 2:
        raise ValueError("max_tokens must be at least 2")
    return list(ids[: max_tokens - 1]) + [eos_id]


def plan_batches(lengths: Sequence[int], max_batch_size: int, token_budget: int) -> list[list[int]]:
    """Group indices into inference batches.

    Sorting by length keeps padding small. A batch is closed when it has `max_batch_size` items or when
    `len(batch) * longest_sequence` would exceed `token_budget` (a single item always forms a valid batch).
    """
    if max_batch_size < 1 or token_budget < 1:
        raise ValueError("max_batch_size and token_budget must be positive")
    order = sorted(range(len(lengths)), key=lambda i: lengths[i], reverse=True)
    batches: list[list[int]] = []
    current: list[int] = []
    for i in order:
        # `order` is descending, so the first element of a batch is its longest sequence.
        longest = lengths[current[0]] if current else lengths[i]
        if current and (len(current) >= max_batch_size or (len(current) + 1) * longest > token_budget):
            batches.append(current)
            current = []
        current.append(i)
    if current:
        batches.append(current)
    return batches


def pad_left(sequences: Sequence[Sequence[int]], pad_id: int) -> tuple[np.ndarray, np.ndarray]:
    """Left-pad to the longest sequence. Returns (input_ids, attention_mask), both int32 of shape (B, L)."""
    longest = max(len(s) for s in sequences)
    input_ids = np.full((len(sequences), longest), pad_id, dtype=np.int32)
    attention_mask = np.zeros((len(sequences), longest), dtype=np.int32)
    for row, seq in enumerate(sequences):
        input_ids[row, longest - len(seq):] = seq
        attention_mask[row, longest - len(seq):] = 1
    return input_ids, attention_mask


def build_attention_mask(attention_mask: np.ndarray) -> Optional[np.ndarray]:
    """Boolean (B, 1, L, L) mask for causal attention over a left-padded batch (True = may attend).

    A query at position i may attend key j iff j <= i and j is a real token. Padding rows would otherwise have
    no allowed key at all and produce NaN; letting them attend to themselves keeps them finite, and since real
    tokens never attend to padding keys those rows cannot influence any real token. Returns None when the batch
    has no padding (plain causal attention suffices).
    """
    attention_mask = np.asarray(attention_mask).astype(bool)
    if attention_mask.all():
        return None
    length = attention_mask.shape[1]
    causal = np.tril(np.ones((length, length), dtype=bool))
    allowed = causal[None, :, :] & attention_mask[:, None, :]
    allowed |= np.eye(length, dtype=bool)[None, :, :]
    return allowed[:, None, :, :]


# --- Pooling and normalisation ----------------------------------------------------------------------------------
def last_token_pool(hidden_states, attention_mask: np.ndarray):
    """Hidden state of the last token of every sequence, shape (B, H).

    Requires LEFT padding: then the last token of every row sits at index -1, which makes the result independent
    of the padding. Works for numpy and mlx arrays. Raises if the batch is not left-padded, because pooling
    `[:, -1]` would then silently return a padding position.
    """
    mask = np.asarray(attention_mask)
    if not mask[:, -1].all():
        raise ValueError("last_token_pool requires left padding (last position must be a real token)")
    return hidden_states[:, -1, :]


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.maximum(norms, 1e-12)


def mrl_truncate(vectors: np.ndarray, dim: int) -> np.ndarray:
    """Matryoshka truncation: keep the first `dim` components, then L2-renormalise."""
    if dim < 1 or dim > vectors.shape[-1]:
        raise ValueError(f"dim must be in [1, {vectors.shape[-1]}], got {dim}")
    return l2_normalize(vectors[..., :dim])
