"""Generate the parity fixtures for the backend's TypeScript port of `embedder.prepare_text`.

    python scripts/gen_prepare_text_fixtures.py > ../socud-backend/src/queue/fixtures/prepare-text.json

The backend (EMBEDDING_PROVIDER=api) re-implements the worker's text preparation in
`socud-backend/src/queue/embedding-text.ts`; `embedding-text.spec.ts` asserts that it produces exactly the
strings recorded here by the real Python code. Re-run this script (and commit the JSON) whenever `prepare_text`
or `clean_content` changes. The output is deterministic (fixed seed). Needs numpy only, no model.
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DEFAULT_QUERY_INSTRUCTION  # noqa: E402
from embedder import prepare_text  # noqa: E402

CUSTOM_TASK = "Given a question, find the passage that answers it"

HANDWRITTEN = [
    "",
    " ",
    "   \n\t \n  ",
    "plain text",
    "  leading and trailing  ",
    "line one\r\nline two\r\n\r\n\r\n\r\nline three\rline four",
    "# Heading 1\n## Heading 2\n###### Heading 6\n####### seven hashes\n   ### indented heading\n#nospace",
    "- item one\n* item two\n+ item three\n  - nested item\n-not a bullet\n1. numbered\n2. list",
    "> quote\n>> nested quote\n> > spaced nested\n>no space",
    "---\n***\n___\n- - -\n* * *\ntext\n----------",
    "**bold** and __also bold__ and *italic* and _underscore italic_ and ***both***",
    "snake_case_identifier and __init__ and 2*3*4 and a * b * c and **unclosed and *unclosed",
    "**bold\nacross lines** and *italic\nacross lines*",
    "price is 5*3 and *emphasis* inside (*parens*) and [*bracketed*]",
    "![alt text](https://example.com/img.png) before [link text](https://example.com/a_(b)) after",
    "[link](url) and [another [nested] link](url2) and [](empty) and [text]() and [x](a b)",
    "```python\ndef f(x):\n    return x * 2\n```\nafter code",
    "~~~\ntilde fence\n~~~\n   ```js inline-info\nconsole.log(1)\n```",
    "text ```not a fence``` text\n``` \ncode with trailing\n```   ",
    "Cyrillic: Как оформить отпуск сотруднику?\n\n**Важно:** подайте заявление [здесь](http://hr.example/leave).",
    "Привет,   мир!\t\tТабы и   пробелы  неразрывные",
    "unicode ws: em en　ideographic line sep para sep\x85nel\x1cfs\x1dgs\x0bvt\x0cff﻿bom",
    "  \x85 leading unicode whitespace   \x85",
    "﻿starts with BOM﻿",
    "\x1c\x1d\x1e\x1f edge control separators \x1f",
    "emoji 😀 and CJK 日本語のテキスト and Arabic مرحبا and combining é",
    "__init__ and ___triple___ and **__mixed__** and *_x_*",
    "word*star*word and word_under_word and ñ*ü*ß and я*ё*ж and 5*",
    "*start of line italic*\n**start bold**\n * spaced star * \n*",
    "$$ E = mc^2 $$ and inline $a_i * b_i$ and \\(x*y*z\\)",
    "| col a | col b |\n| --- | --- |\n| 1 | 2 |",
    "<div>html **kept** tags</div> &amp; entities",
    "  \n\n\n  paragraph one  \n\n\n\n\n  paragraph two  \n\n\n",
    "a\n \nb\n\t\nc",
    "- \n* \n+ \n#\n# \n> \n>",
    "line with trailing spaces   \nnext   \n   ",
    "Instruct: already an instruction\nQuery:text",
    "unclosed fence start\n```\nno end",
    "# Title\n\nSome *emphasis*, a [link](https://x.y/z), `inline code`, and:\n\n```\ncode block\n```\n\n> quote\n\n- a\n- b",
    "x" * 100,
    "слово " * 5500,  # very long (33000 chars), above the worker's MAX_TEXT_LENGTH of 32000
    ("Абзац **с выделением** и [ссылкой](http://e.x).\n\n" * 600),
    "a" * 33000 + "\n" + "b" * 10,
]

ALPHABET = [
    "*", "**", "_", "__", "`", "```", "~~~", "#", "##", "-", "+", ">", ">>", "[", "]", "(", ")", "!", "!", "\n", "\n\n",
    "\n\n\n", "\r\n", "\r", " ", "  ", "\t", " ", " ", " ", "\x85", "\x1c", "﻿", "word", "Слово",
    "text", "a_b", "x*y", "1.", "http://e.x", "---", "***", "___", "ё", "日本", "😀", "é", "$", "\\", "|", ":",
]


def fuzz_cases(count: int, seed: int = 20260511) -> list[str]:
    rng = random.Random(seed)
    cases = []
    for _ in range(count):
        n = rng.randint(1, 40)
        cases.append("".join(rng.choice(ALPHABET) for _ in range(n)))
    return cases


def main() -> None:
    inputs = HANDWRITTEN + fuzz_cases(600)
    cases = []
    for text in inputs:
        for task in (DEFAULT_QUERY_INSTRUCTION, CUSTOM_TASK):
            for is_query in (False, True):
                if not is_query and task == CUSTOM_TASK:
                    continue  # documents never use the task: one document case per input is enough
                cases.append(
                    {"text": text, "isQuery": is_query, "task": task, "expected": prepare_text(text, is_query, task)}
                )
    json.dump({"defaultTask": DEFAULT_QUERY_INSTRUCTION, "cases": cases}, sys.stdout, ensure_ascii=False, indent=0)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
