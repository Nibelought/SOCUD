"""Stress / throughput test of an embedding endpoint. Standard library only.

    # the SOCUD worker (POST /embed)
    python scripts/stress_test.py --url http://127.0.0.1:8000 [--token ...]
    # an OpenAI-compatible server directly (LM Studio, vLLM ...), to tune it without the worker in between
    python scripts/stress_test.py --url http://192.168.31.59:1234/v1 --openai --model text-embedding-qwen3-embedding-4b

Phase 1 sweeps a matrix of (texts per request) x (parallel requests) with realistic ~1800-character Russian chunks
(what the backend's chunker produces) and prints throughput, request latency percentiles and errors per cell.
Phase 2 (--no-queries to skip) keeps the recommended cell running as background indexing load and measures the latency of
single search-query embeddings meanwhile, which is what the backend's EMBED_QUERY_TIMEOUT_MS / 4 s search budget cares
about. Exit code 1 if any request failed. It loads the target GPU: do not run it while the machine is in use.
"""

import argparse
import itertools
import json
import random
import statistics
import threading
import time
import urllib.request

WORDS = (
    "договор поставка оборудование сотрудник отпуск заявление руководитель проект документ требование хранение "
    "персональные данные безопасность доступ отчёт квартал бюджет согласование регламент процесс система пользователь "
    "пароль учётная запись уведомление срок исполнение ответственность контроль качество поставщик заказчик счёт "
    "оплата акт приёмка инструкция настройка сервер резервное копирование журнал событий аудит изменение версия "
    "публикация поиск индекс вектор модель"
).split()
QUERIES = [
    "как оформить отпуск",
    "требования к хранению персональных данных",
    "reset password",
    "срок согласования договора поставки",
    "резервное копирование сервера",
]


def make_chunk(rng, chars=1800):
    out, size = [], 0
    while size < chars:
        sentence = " ".join(rng.choice(WORDS) for _ in range(rng.randint(6, 14))).capitalize() + ". "
        out.append(sentence)
        size += len(sentence)
    return "".join(out)[:chars]


class Target:
    def __init__(self, args):
        self.openai = args.openai
        base = args.url.rstrip("/")
        self.endpoint = base + ("/embeddings" if args.openai else "/embed")
        self.model = args.model
        self.headers = {"Content-Type": "application/json"}
        if args.token:
            self.headers["Authorization" if args.openai else "X-Worker-Token"] = (
                f"Bearer {args.token}" if args.openai else args.token
            )

    def embed(self, texts, is_query=False):
        if self.openai:
            if is_query:  # same prefix the worker would add, so the cost is comparable
                texts = [f"Instruct: retrieve relevant passages\nQuery:{t}" for t in texts]
            payload = {"model": self.model, "input": texts}
        else:
            payload = {"texts": texts, "is_query": is_query}
        req = urllib.request.Request(self.endpoint, data=json.dumps(payload).encode(), headers=self.headers)
        with urllib.request.urlopen(req, timeout=300) as res:
            json.load(res)


def percentile(values, p):
    if not values:
        return float("nan")
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


class Load:
    """`concurrency` threads sending document batches back to back until stopped."""

    def __init__(self, target, batch, concurrency, seed=1):
        self.target, self.batch, self.concurrency = target, batch, concurrency
        self.latencies, self.errors, self.texts = [], 0, 0
        self.lock = threading.Lock()
        self.stop = threading.Event()
        rng = random.Random(seed)
        self.pool = [make_chunk(rng) for _ in range(256)]
        self.threads = [threading.Thread(target=self.run, args=(i,), daemon=True) for i in range(concurrency)]

    def run(self, worker):
        rng = random.Random(worker)
        while not self.stop.is_set():
            texts = [rng.choice(self.pool) for _ in range(self.batch)]
            started = time.perf_counter()
            try:
                self.target.embed(texts)
            except Exception:
                with self.lock:
                    self.errors += 1
                time.sleep(0.2)
                continue
            elapsed = time.perf_counter() - started
            with self.lock:
                self.latencies.append(elapsed)
                self.texts += len(texts)

    def start(self):
        self.t0 = time.perf_counter()
        for t in self.threads:
            t.start()

    def finish(self):
        self.stop.set()
        for t in self.threads:
            t.join()
        self.seconds = time.perf_counter() - self.t0


def parse_ints(value):
    return [int(x) for x in value.split(",")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--token")
    ap.add_argument("--openai", action="store_true", help="target is an OpenAI-compatible /embeddings endpoint")
    ap.add_argument("--model", default="text-embedding-qwen3-embedding-4b")
    ap.add_argument("--batches", type=parse_ints, default=[1, 4, 8, 16, 32])
    ap.add_argument("--concurrency", type=parse_ints, default=[1, 2, 4])
    ap.add_argument("--duration", type=float, default=15, help="seconds per matrix cell")
    ap.add_argument("--no-queries", action="store_true", help="skip the query-latency-under-load phase")
    a = ap.parse_args()

    target = Target(a)
    target.embed(["warm-up"])
    print(f"target {target.endpoint}, ~1800-char chunks, {a.duration:.0f}s per cell")
    print(f"{'batch':>5} {'par':>3} {'texts/s':>8} {'req p50':>8} {'req p95':>8} {'req max':>8} {'errors':>6}")
    results, failures = [], 0
    for batch, conc in itertools.product(a.batches, a.concurrency):
        load = Load(target, batch, conc)
        load.start()
        time.sleep(a.duration)
        load.finish()
        rate = load.texts / load.seconds
        failures += load.errors
        results.append((rate, percentile(load.latencies, 95), batch, conc))
        print(
            f"{batch:>5} {conc:>3} {rate:>8.2f} {percentile(load.latencies, 50):>7.2f}s "
            f"{percentile(load.latencies, 95):>7.2f}s {max(load.latencies, default=float('nan')):>7.2f}s "
            f"{load.errors:>6}"
        )
    peak = max(r[0] for r in results)
    # The GPU saturates: many cells land within noise of the peak. Prefer the one with the lowest request latency.
    best_rate, _, best_batch, best_conc = min((r for r in results if r[0] >= 0.97 * peak), key=lambda r: r[1])
    print(f"peak {peak:.2f} texts/s; recommended (within 3% of peak, lowest p95): batch={best_batch} "
          f"parallel={best_conc} -> {best_rate:.2f} texts/s")

    if not a.no_queries:
        print(f"\nsearch-query latency while indexing at batch={best_batch} parallel={best_conc}:")
        load = Load(target, best_batch, best_conc, seed=2)
        load.start()
        time.sleep(3)
        latencies, rng = [], random.Random(3)
        for _ in range(30):
            started = time.perf_counter()
            try:
                target.embed([rng.choice(QUERIES)], is_query=True)
                latencies.append(time.perf_counter() - started)
            except Exception:
                failures += 1
            time.sleep(0.2)
        load.finish()
        failures += load.errors
        print(
            f"  {len(latencies)} queries: p50 {percentile(latencies, 50):.2f}s  p95 {percentile(latencies, 95):.2f}s  "
            f"max {max(latencies, default=float('nan')):.2f}s  mean {statistics.mean(latencies):.2f}s"
        )
    print("RESULT:", "FAIL (errors)" if failures else "PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
