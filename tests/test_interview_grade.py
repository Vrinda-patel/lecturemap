"""API tests for the grading response the Interview Report relies on.

Run: python -m pytest tests/   (external APIs are stubbed; no keys needed)
"""
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import main  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    dim = main.COURSE.emb.shape[1]
    monkeypatch.setattr(main, "embed", lambda texts: np.ones((len(texts), dim), dtype=np.float32) / np.sqrt(dim))
    main._hits.clear()
    return TestClient(main.app)


def grade(client, monkeypatch, model_reply, answer="It keeps its scope"):
    monkeypatch.setattr(main, "chat_json", lambda *a, **k: model_reply)
    return client.post("/api/interview/grade", json={"question": "What is a closure?", "answer": answer})


def test_strengths_and_weaknesses_returned(client, monkeypatch):
    r = grade(client, monkeypatch, {"score": 7, "feedback": "ok", "ideal_answer": "ideal",
                                    "strengths": ["Clear definition"], "weaknesses": ["No example"], "ref": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["score"] == 7
    assert body["strengths"] == ["Clear definition"]
    assert body["weaknesses"] == ["No example"]
    assert body["source"]["youtube_id"]


def test_missing_or_malformed_lists_become_empty(client, monkeypatch):
    r = grade(client, monkeypatch, {"score": "x", "feedback": "ok", "ideal_answer": "i",
                                    "strengths": "not a list", "weaknesses": None})
    body = r.json()
    assert body["score"] == 0
    assert body["strengths"] == [] and body["weaknesses"] == []


def test_lists_are_cleaned_and_capped(client, monkeypatch):
    r = grade(client, monkeypatch, {"score": 15, "strengths": ["  a  ", "", 3, None, "b", "c", "d"],
                                    "weaknesses": ["z" * 1000]})
    body = r.json()
    assert body["score"] == 10
    assert body["strengths"] == ["a", "b", "c"]
    assert len(body["weaknesses"][0]) == 240


def test_existing_fields_unchanged(client, monkeypatch):
    r = grade(client, monkeypatch, {"score": 5, "feedback": "f", "ideal_answer": "i", "ref": 99}, answer="")
    assert set(r.json()) == {"score", "feedback", "ideal_answer", "strengths", "weaknesses", "source"}
    assert r.json()["source"] is None
