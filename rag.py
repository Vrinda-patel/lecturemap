"""Retrieval + LLM helpers shared by every endpoint.

Embeddings: Cloudflare Workers AI bge-m3 (same model the course data was embedded with).
LLM: Groq (OpenAI-compatible chat API).
"""
import json
import os
from pathlib import Path

import numpy as np
import requests

DATA = Path(__file__).parent / "data"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")


class UpstreamError(Exception):
    """An external API (Groq / Cloudflare) failed; message is safe to show users."""


# ---------- corpus ----------

class Corpus:
    """A list of transcript chunks plus their normalised embeddings."""

    def __init__(self, chunks: list[dict], emb: np.ndarray):
        self.chunks = chunks
        self.emb = emb.astype(np.float32)

    def search(self, qvec: np.ndarray, k: int = 5, video: str | None = None) -> list[dict]:
        scores = self.emb @ qvec
        if video:
            mask = np.array([c["youtube_id"] == video for c in self.chunks])
            scores = np.where(mask, scores, -1.0)
        top = np.argsort(scores)[::-1][:k]
        return [self.chunks[i] for i in top if scores[i] > -1.0]

    def of_video(self, video: str, limit: int = 14) -> list[dict]:
        """Evenly spaced chunks covering a whole video (for notes / quiz)."""
        items = [c for c in self.chunks if c["youtube_id"] == video]
        if len(items) <= limit:
            return items
        idx = np.linspace(0, len(items) - 1, limit).round().astype(int)
        return [items[i] for i in idx]


def load_course() -> tuple[Corpus, list[dict]]:
    videos = json.loads((DATA / "videos.json").read_text(encoding="utf-8"))
    by_num = {v["number"]: v for v in videos}
    chunks = []
    for c in json.loads((DATA / "chunks.json").read_text(encoding="utf-8")):
        v = by_num[c["number"]]
        chunks.append({**c, "youtube_id": v["youtube_id"], "label": v["label"], "title": v["title"]})
    return Corpus(chunks, np.load(DATA / "embeddings.npy")), videos


# ---------- external APIs ----------

def embed(texts: list[str]) -> np.ndarray:
    url = f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CF_ACCOUNT_ID']}/ai/run/@cf/baai/bge-m3"
    headers = {"Authorization": f"Bearer {os.environ['CF_API_TOKEN']}"}
    out = []
    for i in range(0, len(texts), 50):
        try:
            r = requests.post(url, headers=headers, json={"text": texts[i:i + 50]}, timeout=30)
            r.raise_for_status()
            out.extend(r.json()["result"]["data"])
        except requests.RequestException as e:
            raise UpstreamError("Search service abhi respond nahi kar rahi. Thodi der baad try karo.") from e
    vecs = np.array(out, dtype=np.float32)
    return vecs / np.linalg.norm(vecs, axis=1, keepdims=True)


def chat(system: str, user: str, json_mode: bool = False, max_tokens: int = 1500) -> str:
    body = {
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0.4,
        "reasoning_effort": "low",
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            json=body,
            timeout=60,
        )
    except requests.RequestException as e:
        raise UpstreamError("AI service se connect nahi ho paaya. Dobara try karo.") from e
    if r.status_code == 429:
        raise UpstreamError("Abhi bahut log use kar rahe hain 😅 10 second baad dobara try karo.")
    if not r.ok:
        raise UpstreamError("AI service mein dikkat aa gayi. Dobara try karo.")
    return r.json()["choices"][0]["message"]["content"]


def chat_json(system: str, user: str, max_tokens: int = 2500) -> dict:
    """JSON-mode chat with one retry on malformed output."""
    for _ in range(2):
        try:
            return json.loads(chat(system, user, json_mode=True, max_tokens=max_tokens))
        except (json.JSONDecodeError, UpstreamError) as e:
            last = e
    raise last if isinstance(last, UpstreamError) else UpstreamError("AI ka jawab samajh nahi aaya. Dobara try karo.")


# ---------- formatting ----------

def fmt_time(sec: float) -> str:
    s = int(sec)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def context_block(chunks: list[dict]) -> str:
    return "\n\n".join(
        f"[{i}] ({c['label']} · {c['title']} · {fmt_time(c['start'])})\n{c['text']}"
        for i, c in enumerate(chunks, 1)
    )


def source(c: dict, n: int) -> dict:
    return {
        "n": n,
        "youtube_id": c["youtube_id"],
        "label": c["label"],
        "title": c["title"],
        "start": max(0, int(c["start"]) - 2),  # land just before the sentence starts
        "time": fmt_time(c["start"]),
    }


def ref_to_source(chunks: list[dict], ref) -> dict | None:
    """Turn a 1-based [n] reference from the model into a source dict (None if invalid)."""
    try:
        n = int(ref)
    except (TypeError, ValueError):
        return None
    return source(chunks[n - 1], n) if 1 <= n <= len(chunks) else None
