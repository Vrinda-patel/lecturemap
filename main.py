"""LectureMap — FastAPI app (Embarko entry point).

Local run:  python main.py   →  http://localhost:8000
"""
import os
import random
import time
from collections import OrderedDict, defaultdict, deque
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:  # local dev only; on Embarko env vars come from App setup
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

import prompts
import youtube
from rag import REQUIRED_ENV, UpstreamError, chat, chat_json, context_block, embed, load_course, ref_to_source, source

app = FastAPI(title="LectureMap")


# ---------- rate limit: protects the shared Groq / Cloudflare quota ----------
RATE_LIMIT = int(os.environ.get("RATE_LIMIT_PER_MIN", 20))
_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.method == "POST" and request.url.path.startswith("/api/"):
        fwd = request.headers.get("x-forwarded-for", "")
        # rightmost entry is added by Embarko's proxy; leftmost ones can be spoofed by the client
        ip = fwd.split(",")[-1].strip() or (request.client.host if request.client else "?")
        now = time.monotonic()
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return JSONResponse({"detail": "Thoda dheere 🙂 Ek minute mein bahut saare sawaal ho gaye. 1 minute baad try karo."}, 429)
        q.append(now)
        if len(_hits) > 5000:  # forget idle visitors so memory stays flat
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                del _hits[k]
    return await call_next(request)


COURSE, VIDEOS = load_course()
COURSE_IDS = {v["youtube_id"] for v in VIDEOS}
STATIC = Path(__file__).parent / "static"

Lang = Literal["hinglish", "english"]


class Scope(BaseModel):
    video: str | None = Field(None, description="youtube_id; null = whole course")
    lang: Lang = "hinglish"


def corpus_for(video: str | None):
    if not video or video in COURSE_IDS:
        return COURSE
    c = youtube.get(video)
    if c is None:
        raise HTTPException(404, "Ye video load nahi hai. Link dobara paste karo.")
    return c


def pick_chunks(video: str | None, topic: str | None, k: int):
    """Context for exam/interview: a topic search, a whole video, or a random slice of the course."""
    corpus = corpus_for(video)
    if topic and topic.strip():
        return corpus.search(embed([topic])[0], k=k, video=video)
    if video:
        return corpus.of_video(video, limit=k)
    start = random.randrange(0, len(corpus.chunks) - k)
    return corpus.chunks[start:start + k]


def lang_note(lang: str) -> str:
    return f"\n\nIMPORTANT — output language: {prompts.LANG[lang]}"


def str_list(value, n: int = 3, max_len: int = 240) -> list[str]:
    """Keep only non-empty strings from a model-provided list (models sometimes return a string or null)."""
    if not isinstance(value, list):
        return []
    return [s.strip()[:max_len] for s in value if isinstance(s, str) and s.strip()][:n]


def guard(fn):
    try:
        return fn()
    except UpstreamError as e:
        raise HTTPException(503, str(e))


# ---------- API ----------

@app.get("/api/videos")
def videos():
    return [v for v in VIDEOS if v["label"] != "Bonus"]


class Turn(BaseModel):
    q: str = Field(..., max_length=500)
    a: str = Field(..., max_length=4000)


class AskIn(Scope):
    question: str = Field(..., min_length=2, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=6)


_ask_cache: "OrderedDict[tuple, dict]" = OrderedDict()


@app.post("/api/ask")
def ask(body: AskIn):
    history = body.history[-2:]  # last 2 turns are enough for follow-ups like "iska example do"
    key = (body.question.strip().lower(), body.video, body.lang)
    if not history and key in _ask_cache:
        return _ask_cache[key]

    def run():
        corpus = corpus_for(body.video)
        # include the previous question in the search so follow-ups find the same topic
        query = f"{history[-1].q}\n{body.question}" if history else body.question
        chunks = corpus.search(embed([query])[0], k=5, video=body.video)
        convo = "".join(f"Student: {t.q}\nYou: {t.a[:1500]}\n\n" for t in history)
        user = f"Excerpts:\n{context_block(chunks)}\n\n"
        if convo:
            user += f"Earlier conversation (for context only; citation numbers there refer to older excerpts):\n{convo}"
        user += f"Student's question: {body.question}"
        answer = chat(prompts.ask(body.lang), user)
        return {"answer": answer, "sources": [source(c, i) for i, c in enumerate(chunks, 1)]}

    result = guard(run)
    if not history:
        _ask_cache[key] = result
        if len(_ask_cache) > 300:
            _ask_cache.popitem(last=False)
    return result


class ExamIn(Scope):
    topic: str | None = Field(None, max_length=200)


@app.post("/api/exam")
def exam(body: ExamIn):
    def run():
        chunks = pick_chunks(body.video, body.topic, k=12)
        data = chat_json(prompts.exam(body.lang), f"Excerpts:\n{context_block(chunks)}{lang_note(body.lang)}")
        notes = [{"point": n.get("point", ""), "source": ref_to_source(chunks, n.get("ref"))}
                 for n in data.get("notes", [])][:5]
        quiz = []
        for q in data.get("quiz", [])[:5]:
            opts = q.get("options", [])
            if len(opts) == 4 and isinstance(q.get("answer"), int) and 0 <= q["answer"] < 4:
                quiz.append({"q": q.get("q", ""), "options": opts, "answer": q["answer"],
                             "explain": q.get("explain", ""), "source": ref_to_source(chunks, q.get("ref"))})
        if not quiz:
            raise UpstreamError("Quiz ban nahi paaya. Dobara try karo.")
        return {"notes": notes, "quiz": quiz}

    return guard(run)


class InterviewQIn(ExamIn):
    asked: list[str] = Field(default_factory=list, max_length=20)


@app.post("/api/interview/question")
def interview_question(body: InterviewQIn):
    def run():
        chunks = pick_chunks(body.video, body.topic, k=6)
        asked = "\n".join(f"- {q}" for q in body.asked) or "(none)"
        data = chat_json(prompts.interview_question(body.lang),
                         f"Excerpts:\n{context_block(chunks)}\n\nAlready asked:\n{asked}{lang_note(body.lang)}", max_tokens=600)
        if not data.get("question"):
            raise UpstreamError("Question ban nahi paaya. Dobara try karo.")
        return {"question": data["question"], "source": ref_to_source(chunks, data.get("ref"))}

    return guard(run)


class GradeIn(Scope):
    question: str = Field(..., max_length=1000)
    answer: str = Field("", max_length=3000)


@app.post("/api/interview/grade")
def interview_grade(body: GradeIn):
    def run():
        corpus = corpus_for(body.video)
        chunks = corpus.search(embed([body.question])[0], k=4, video=body.video)
        data = chat_json(prompts.interview_grade(body.lang),
                         f"Excerpts:\n{context_block(chunks)}\n\nQuestion: {body.question}\n\nCandidate's answer: {body.answer or '(no answer)'}{lang_note(body.lang)}",
                         max_tokens=1500)
        try:
            score = max(0, min(10, int(data.get("score", 0))))
        except (TypeError, ValueError):
            score = 0
        return {"score": score, "feedback": data.get("feedback", ""), "ideal_answer": data.get("ideal_answer", ""),
                "strengths": str_list(data.get("strengths")), "weaknesses": str_list(data.get("weaknesses")),
                "source": ref_to_source(chunks, data.get("ref"))}

    return guard(run)


class YouTubeIn(BaseModel):
    url: str = Field(..., max_length=300)


@app.post("/api/youtube")
def load_youtube(body: YouTubeIn):
    vid = youtube.parse_id(body.url)
    if not vid:
        raise HTTPException(400, "Ye YouTube link sahi nahi lag raha.")
    if vid in COURSE_IDS:
        v = next(v for v in VIDEOS if v["youtube_id"] == vid)
        return {"video": vid, "title": v["title"], "chunks": None, "course": True}
    corpus, title = guard(lambda: youtube.load(vid))
    return {"video": vid, "title": title, "chunks": len(corpus.chunks), "course": False}


@app.get("/api/health")
def health():
    # only says whether each key is present — never its value
    return {"ok": True, "chunks": len(COURSE.chunks),
            "env": {k: bool(os.environ.get(k, "").strip()) for k in REQUIRED_ENV}}


# ---------- frontend ----------

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
