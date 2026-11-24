"""Beta: build a searchable corpus from any YouTube video's captions."""
import re
from collections import OrderedDict

import numpy as np
import requests
from youtube_transcript_api import YouTubeTranscriptApi

from rag import Corpus, UpstreamError, embed

_cache: "OrderedDict[str, Corpus]" = OrderedDict()
MAX_VIDEOS = 5           # keep memory small
WINDOW_SEC = 60          # one chunk ≈ one minute of speech
MAX_CHUNKS = 240         # ≈ 4 hours of video

_ID = re.compile(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([\w-]{11})")


def parse_id(url: str) -> str | None:
    url = url.strip()
    if re.fullmatch(r"[\w-]{11}", url):
        return url
    m = _ID.search(url)
    return m.group(1) if m else None


def _title(video_id: str) -> str:
    try:
        r = requests.get("https://www.youtube.com/oembed",
                         params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}, timeout=10)
        return r.json()["title"][:90]
    except Exception:
        return "YouTube video"


def _fetch_snippets(video_id: str):
    try:
        transcripts = YouTubeTranscriptApi().list(video_id)
        try:
            t = transcripts.find_transcript(["en", "en-IN", "en-US", "en-GB", "hi"])
        except Exception:
            t = next(iter(transcripts))
        return t.fetch()
    except StopIteration:
        raise UpstreamError("Is video pe captions available nahi hain. Koi aur video try karo.")
    except Exception as e:
        name = type(e).__name__
        if name in ("TranscriptsDisabled", "NoTranscriptFound"):
            raise UpstreamError("Is video pe captions available nahi hain. Koi aur video try karo.") from e
        if name in ("VideoUnavailable", "InvalidVideoId"):
            raise UpstreamError("Ye video nahi mila. Link check karo.") from e
        raise UpstreamError(
            "YouTube ne abhi access block kar diya (servers pe aisa hota hai). Built-in JS course try karo."
        ) from e


def load(video_id: str) -> tuple[Corpus, str]:
    if video_id in _cache:
        _cache.move_to_end(video_id)
        corpus = _cache[video_id]
        return corpus, corpus.chunks[0]["title"]

    snippets = _fetch_snippets(video_id)
    title = _title(video_id)

    chunks, buf, start = [], [], None
    for s in snippets:
        if start is None:
            start = s.start
        buf.append(s.text.replace("\n", " "))
        if s.start + s.duration - start >= WINDOW_SEC:
            chunks.append({"start": start, "end": s.start + s.duration, "text": " ".join(buf)})
            buf, start = [], None
    if buf:
        chunks.append({"start": start, "end": start + WINDOW_SEC, "text": " ".join(buf)})
    if not chunks:
        raise UpstreamError("Is video ke captions khaali hain. Koi aur video try karo.")
    chunks = chunks[:MAX_CHUNKS]
    for c in chunks:
        c.update(youtube_id=video_id, label="YouTube", title=title)

    corpus = Corpus(chunks, embed([c["text"] for c in chunks]))
    _cache[video_id] = corpus
    if len(_cache) > MAX_VIDEOS:
        _cache.popitem(last=False)
    return corpus, title


def get(video_id: str) -> Corpus | None:
    return _cache.get(video_id)
