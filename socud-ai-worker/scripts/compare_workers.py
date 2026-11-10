"""Compare two RUNNING workers on the same texts, e.g. the MLX worker on the Mac vs the CUDA worker on the GPU PC.

    python scripts/compare_workers.py --a http://127.0.0.1:8000 --b http://192.168.1.50:8000 [--token-a ...] [--token-b ...]

Embeds a few Russian and English queries and passages on both workers and prints, per text, the cosine similarity
between the two workers' vectors, then whether both rank the passages the same way for every query. The two
workers run the same model, but the MLX checkpoint is 4-bit quantised and the CUDA one is bf16, so expect cosines
around 0.98-0.999 and identical rankings. Much lower values (< 0.9) point to a preprocessing or pooling mismatch,
not to precision drift. Exit code 0 = OK, 1 = suspicious. Standard library only.
"""

import argparse
import json
import math
import sys
import urllib.request

QUERIES = [
    "Как оформить отпуск сотруднику?",
    "How do I reset my password?",
    "Какие требования к хранению персональных данных?",
]
PASSAGES = [
    "Для оформления отпуска сотрудник подаёт заявление руководителю не позднее чем за две недели до начала отпуска.",
    "To reset your password, open the account settings page and choose \"Forgot password\"; a link is sent by email.",
    "Персональные данные хранятся в защищённой базе, доступ к ней имеют только уполномоченные сотрудники.",
    "The quarterly report is due on the first Monday of the month and must be approved by the finance team.",
    "Мы ежегодно проводим корпоративный праздник для всех сотрудников компании и их семей.",
]
MIN_COSINE = 0.9


def embed(url, token, texts, is_query):
    req = urllib.request.Request(
        url.rstrip("/") + "/embed",
        data=json.dumps({"texts": texts, "is_query": is_query}).encode(),
        headers={"Content-Type": "application/json", **({"X-Worker-Token": token} if token else {})},
    )
    with urllib.request.urlopen(req, timeout=600) as res:
        body = json.load(res)
    return body["embeddings"], body.get("model", "?")


def dot(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


def cosine(a, b):
    return dot(a, b) / (math.sqrt(dot(a, a)) * math.sqrt(dot(b, b)))


def ranking(query_vec, passage_vecs):
    return sorted(range(len(passage_vecs)), key=lambda i: dot(query_vec, passage_vecs[i]), reverse=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="base URL of worker A")
    ap.add_argument("--b", required=True, help="base URL of worker B")
    ap.add_argument("--token-a")
    ap.add_argument("--token-b")
    a = ap.parse_args()

    qa, model_a = embed(a.a, a.token_a, QUERIES, True)
    qb, model_b = embed(a.b, a.token_b, QUERIES, True)
    pa, _ = embed(a.a, a.token_a, PASSAGES, False)
    pb, _ = embed(a.b, a.token_b, PASSAGES, False)
    print(f"A: {a.a} ({model_a})\nB: {a.b} ({model_b})")

    cosines = [cosine(x, y) for x, y in zip(qa + pa, qb + pb, strict=True)]
    labels = [f"query   {t[:40]}" for t in QUERIES] + [f"passage {t[:40]}" for t in PASSAGES]
    for label, c in zip(labels, cosines, strict=True):
        print(f"  cos {c:.4f}  {label}")
    print(f"min cosine {min(cosines):.4f} (threshold {MIN_COSINE})")

    same_ranking = True
    for i, q in enumerate(QUERIES):
        ra, rb = ranking(qa[i], pa), ranking(qb[i], pb)
        same_ranking &= ra == rb
        print(f"  ranking {'same' if ra == rb else 'DIFFERENT'}  A={ra} B={rb}  {q}")

    ok = min(cosines) >= MIN_COSINE and same_ranking
    print("OK" if ok else "SUSPICIOUS: the workers disagree more than precision differences explain")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
