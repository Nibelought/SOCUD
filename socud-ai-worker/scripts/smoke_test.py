"""End-to-end smoke test against a RUNNING worker (needs the real model). Standard library only.

    python scripts/smoke_test.py [--url http://127.0.0.1:8000] [--token ...] [--bench]

Checks: dimension 1024, unit norm, Russian/English retrieval ranking, and the Qwen3-Embedding README example
(capital of China / gravity). With --bench it also reports throughput for ~500-token passages.
"""

import argparse
import json
import math
import time
import urllib.request

REF_TASK = "Given a web search query, retrieve relevant passages that answer the query"
# Official README scores for Qwen/Qwen3-Embedding-4B (bf16, 2560-dim); 4-bit + 1024 dims will not match exactly.
REF_SCORES = [[0.7534, 0.1147], [0.0320, 0.6258]]


def call(url, token, texts, is_query=False):
    req = urllib.request.Request(
        url + "/embed",
        data=json.dumps({"texts": texts, "is_query": is_query}).encode(),
        headers={"Content-Type": "application/json", **({"X-Worker-Token": token} if token else {})},
    )
    with urllib.request.urlopen(req, timeout=600) as res:
        return json.load(res)["embeddings"]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


def scores(queries, docs):
    return [[dot(q, d) for d in docs] for q in queries]


def check_pairs(name, qs, ds):
    s = scores(qs, ds)
    ok = all(s[i][i] > max(s[i][j] for j in range(len(ds)) if j != i) for i in range(len(qs)))
    print(f"{name}: {[[round(x, 3) for x in row] for row in s]} -> {'OK' if ok else 'FAIL'}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--token", default=None)
    ap.add_argument("--bench", action="store_true")
    a = ap.parse_args()
    ok = True

    emb = call(a.url, a.token, ["Привет, мир", "hello world"])
    norms = [math.sqrt(dot(v, v)) for v in emb]
    print("dim", [len(v) for v in emb], "norms", [round(n, 5) for n in norms])
    ok &= all(len(v) == 1024 for v in emb) and all(abs(n - 1) < 1e-3 for n in norms)

    ru_q = ["Как оформить отпуск?", "Где хранятся резервные копии базы данных?", "Кто отвечает за онбординг новых сотрудников?"]
    ru_d = [
        "Чтобы оформить отпуск, подайте заявление руководителю не позднее чем за две недели и согласуйте даты в HR-системе.",
        "Резервные копии базы данных создаются каждую ночь и хранятся в защищённом облачном хранилище 30 дней.",
        "Онбординг новых сотрудников ведёт HR-менеджер: он выдаёт доступы, знакомит с командой и планирует адаптацию.",
    ]
    en_q = ["How do I request vacation?", "Where are database backups stored?", "Who runs onboarding for new hires?"]
    en_d = [
        "To request vacation, submit a request to your manager at least two weeks ahead and confirm dates in the HR system.",
        "Database backups are created every night and kept in secure cloud storage for 30 days.",
        "Onboarding of new hires is run by the HR manager, who grants access and plans the adaptation period.",
    ]
    ru = (call(a.url, a.token, ru_q, True), call(a.url, a.token, ru_d))
    en = (call(a.url, a.token, en_q, True), call(a.url, a.token, en_d))
    ok &= check_pairs("RU", *ru) & check_pairs("EN", *en)
    # Cross-lingual: Russian query against English passages.
    ok &= check_pairs("RU->EN", ru[0], en[1])

    ref_q = ["What is the capital of China?", "Explain gravity"]
    ref_d = [
        "The capital of China is Beijing.",
        "Gravity is a force that attracts two bodies towards each other. It gives weight to physical objects and "
        "is responsible for the movement of planets around the sun.",
    ]
    qv = call(a.url, a.token, [f"Instruct: {REF_TASK}\nQuery:{q}" for q in ref_q])  # documents path = no wrapping
    dv = call(a.url, a.token, ref_d)
    s = scores(qv, dv)
    print("README example (task embedded manually):", [[round(x, 3) for x in r] for r in s], "reference", REF_SCORES)
    ok &= s[0][0] > s[0][1] and s[1][1] > s[1][0]

    if a.bench:
        word = "Квартальный отчёт по инфраструктуре описывает мониторинг, резервное копирование и доступы. "
        passage = word * 15  # about 500 tokens
        for n in (1, 4, 8, 16):
            call(a.url, a.token, [passage] * min(n, 2))  # warm
            t = time.perf_counter()
            call(a.url, a.token, [passage + str(i) for i in range(n)])
            dt = time.perf_counter() - t
            print(f"bench batch={n:>2}: {dt:6.2f}s  {n / dt:5.2f} texts/s")

    print("RESULT:", "PASS" if ok else "FAIL")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
