# LectureMap (formerly JS Exam Saathi) — Build Spec

> Embarko Student Challenge entry. Deadline: **30 Nov 2026, 11:59 PM IST** (submit by noon).
> Pitch: *"22 videos, kal exam? Pucho — exact second pe pahuncho, notes lo, quiz do."*

---

## Progress (25 Nov)
- ✅ Phase 0 (local): Groq (`openai/gpt-oss-120b`) + Cloudflare bge-m3 verified; CF embeddings match existing data; 22 YouTube IDs in `data/videos.json`.
- ✅ Phase 1–4 code: `main.py`, `rag.py`, `prompts.py`, `youtube.py`, `static/`. Tested locally end-to-end; ~63 MB RAM; deploy zip 1.2 MB (`python scripts/package.py`).
- ⏳ Next: deploy on Embarko + verify outbound calls & YouTube Beta from their server, then phone test with friends.

## 0. Starting state (as of 24 Nov)

| Item | Status |
|---|---|
| Data | 542 chunks, 22 videos (Namaste JavaScript by Akshay Saini), avg ~880 chars/chunk |
| Embeddings | `bge-m3`, 1024-dim, in `chunks_embeddings.joblib` + `all_chunks_with_embeddings.json` |
| Retrieval | cosine similarity over all chunks (numpy/sklearn) |
| LLM | `llama3.2` via local Ollama |
| UI | Streamlit (`app.py`) |
| Missing | YouTube video IDs (only local `.webm` files), transcription script |

### Why the current app can't deploy on Embarko as-is
- Embarko: **256 MB RAM**, no GPU, no Docker → local Ollama impossible.
- **No WebSockets** → Streamlit won't work.
- Python apps need `main.py` binding `0.0.0.0:$PORT` (FastAPI/Flask) + `requirements.txt`.
- Outbound API calls are not documented → **must verify in Phase 0**.

---

## 1. Product scope

### Main features (must ship)
1. **Ask mode** — question → Hinglish/English answer + clickable timestamp chips (`▶ Ep 10 · 12:44`) that seek the embedded YouTube player.
2. **Exam / Interview mode**
   - **Exam:** pick topic/episode → 5-point short notes (each with timestamp) + 5 MCQs. Wrong answer → "ye concept 12:44 pe samjhaya hai ▶".
   - **Interview:** AI asks 1 interview question at a time → user types answer → AI scores (1–10), gives feedback + ideal answer + timestamp to revise.
3. **Mobile-first UI** — single page, dark mode, works smoothly at phone width.

### Edge feature (Phase 4, labelled "Beta")
4. **Any YouTube video** — paste link → fetch captions → chunk + embed on the fly → Ask / Exam on that video.
   - Visible warning: *"Beta: kuch videos pe captions nahi hote, ya YouTube server access block kar sakta hai. Aisa hua to built-in JS course try karo."*
   - Failure must be graceful (clear message, never a crash/blank screen).

### Out of scope
Login, user accounts, database, history sync, payments, multiple courses.

---

## 2. Architecture

```
Browser (index.html + JS, mobile-first)
   │  fetch()
   ▼
FastAPI  main.py  (Embarko, 0.0.0.0:$PORT)
   ├── /api/ask         → embed query → top-k → LLM → answer + sources
   ├── /api/notes       → episode/topic → chunks → LLM → notes JSON
   ├── /api/quiz        → episode/topic → chunks → LLM → MCQ JSON
   ├── /api/interview   → next question / grade answer
   ├── /api/youtube     → (Phase 4) captions → chunks → in-memory index
   └── /                → static frontend
Data (shipped with app):
   ├── data/chunks.json       (text, start, end, number, title — no embeddings)
   ├── data/embeddings.npy    (float16, 542×D ≈ 1 MB)
   └── data/videos.json       (number → youtube_id, title)
External: Groq (LLM) + Cloudflare Workers AI bge-m3 (query embeddings)
          keys in Embarko env vars: GROQ_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN
```

**Memory budget (256 MB):** use `numpy` only — drop `pandas`, `scikit-learn`, `joblib` at runtime. Cosine = normalized dot product.

---

## 3. Decisions to make before Phase 1

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | LLM provider | Groq / Gemini / Claude / other | ✅ **Decided: Groq** (key in env var `GROQ_API_KEY`; pick model in Phase 0 from `GET /openai/v1/models`) |
| D2 | Query embeddings | Groq has no confirmed embedding model. (a) **Cloudflare Workers AI `@cf/baai/bge-m3`** → same model as existing data, **no re-embedding** · (b) Groq embeddings if `/models` lists one → re-embed 542 chunks · (c) No embedding API: BM25 keyword search, Groq rewrites Hinglish question → English keywords first | (a) primary, (c) as fallback if Cloudflare fails/limits |
| D3 | App name | ✅ **LectureMap** → `lecturemap.embarko.app` (fallback `lecturemap-js`) | Check availability at deploy |
| D4 | Answer language | Hinglish default with English toggle | Hinglish default |

---

## 4. Phases

Rule: **a phase is done only when every ✅ passes.** Don't start the next phase otherwise.

### Phase 0 — Setup & risk check (Day 1 · 24 Nov)
- [ ] Embarko account (embarko.ai/app, free) — deploys via signed-in upload are permanent.
- [ ] Groq API key (console.groq.com) → list models, choose a fast model with JSON mode support.
- [ ] Cloudflare account → Workers AI API token + account ID; test `@cf/baai/bge-m3` returns 1024-dim vector, and its cosine with existing chunk embeddings gives sensible top results.
- [ ] Deploy a "hello" FastAPI app that (1) returns `ok`, (2) makes one Groq call, (3) makes one Cloudflare embedding call.
- [ ] Map all 22 episodes → YouTube video IDs in `data/videos.json` (manual, from the official playlist).

✅ Hello app live at `*.embarko.app` · ✅ outbound API call works from Embarko · ✅ `videos.json` has 22 entries

> If outbound calls fail → stop and rethink (email hello@embarko.ai). Everything depends on this.

### Phase 1 — Backend core (Day 2 · 25 Nov)
- [ ] `scripts/export_data.py`: joblib/JSON → `chunks.json` + `embeddings.npy` (re-embed if D2 = b).
- [ ] `main.py` (FastAPI): load data at startup, `/api/ask` returns `{answer, sources:[{number,title,start,end,youtube_id}]}`.
- [ ] New prompt: remove "my Sigma course" claim; credit Namaste JavaScript; refuse off-topic; Hinglish option.
- [ ] Shared module `rag.py` (embed, search, llm) — no duplicated logic.
- [ ] Old `app.py` / `query_rag.py` kept for local/Ollama use, not deployed.

✅ 5 test questions return correct episodes + timestamps locally · ✅ memory < 150 MB locally

### Phase 2 — Frontend + first deploy (Day 3 · 26 Nov)
- [ ] `static/index.html` — vanilla HTML/CSS/JS (no build step).
- [ ] Layout: header → YouTube embed (sticky) → chat → input bar at bottom.
- [ ] Timestamp chips call player `seekTo(start)` via YouTube IFrame API.
- [ ] Loading state, error state, empty state with 3 sample questions.
- [ ] Footer credit: "Content: Namaste JavaScript by Akshay Saini · Built with AI · Deployed on Embarko".
- [ ] Deploy to Embarko.

✅ Live link works on your own phone (Android/iOS browser) · ✅ chip tap seeks video correctly

### Phase 3 — Exam / Interview mode (Day 4 · 27 Nov)
- [ ] Mode tabs: **Ask · Exam · Interview**.
- [ ] `/api/notes` + `/api/quiz`: input episode number or topic; LLM returns strict JSON (validate; retry once on bad JSON).
- [ ] Quiz UI: 5 MCQs, instant feedback, score card, "revise at ▶ timestamp" on wrong answers.
- [ ] `/api/interview`: ask → grade → feedback loop (stateless: frontend sends history).
- [ ] Test with 3 friends; note top 3 complaints.

✅ Quiz + interview work end to end on phone · ✅ 3 friends' feedback collected

### Phase 4 — YouTube edge feature, Beta (Day 5 · 28 Nov, morning)
- [ ] Input: paste YouTube URL → extract video ID.
- [ ] Fetch captions server-side (e.g. `youtube-transcript-api`); chunk ~60 s windows; embed; keep in memory (LRU, max ~3 videos).
- [ ] Ask + Exam modes work on that video.
- [ ] Warning banner (see §1.4) + friendly error when captions unavailable/blocked.
- [ ] **Timebox: 4 hours.** If it doesn't work from Embarko by then → ship UI with "Coming soon" + warning, move on.

✅ Works for ≥1 public lecture video **or** graceful fallback is shipped

### Phase 5 — Polish + video (Day 5 · 28 Nov, afternoon)
- [ ] Fix friends' top 3 complaints.
- [ ] Final mobile check, page title, favicon, OG preview image.
- [ ] Record vertical video, 60–90 s:
  1. **0–3 s hook:** "Kal JS ka exam hai aur 22 videos baaki? 😭"
  2. Ask → tap timestamp → video jumps (the wow).
  3. Exam mode quiz → wrong answer → "revise at 12:44".
  4. Interview mode, 1 question.
  5. Paste YouTube link (Beta).
  6. "Deployed on Embarko in one prompt" + link on screen.
- [ ] No copyrighted music. Captions on video.

✅ Video 40 s–3 min · ✅ app link visible in video

### Phase 6 — Launch & submit (Day 6–7 · 29–30 Nov)
- [ ] Post on **Instagram Reels, X, YouTube Shorts** with `#DeployWithEmbarko` + app link (+150 pts).
- [ ] LinkedIn post + Medium blog ("How I built…") with `#embarko.ai #DeployWithEmbarko` (bonus up to 25).
- [ ] Share referral link + app in college/coding groups (real users only — no bots).
- [ ] Submit form at embarko.ai/challenge **by 30 Nov noon**.
- [ ] Keep app live & posts public until results (~5 Dec).

✅ Form submitted · ✅ all post links in form

---

## 5. Judging map (where each phase earns points)

| Criterion | Pts | Covered by |
|---|---|---|
| Work: looks, originality, phone | 400 | Phases 2, 3, 4, 5 |
| Video: hook, clarity, story, Embarko | 300 | Phase 5 |
| Reach: views & engagement | 300 | Phase 6 |
| Submission + platforms | 50 + 150 | Phase 6 |
| Bonus (blog/posts) | 25 | Phase 6 |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Embarko blocks outbound API calls | Fatal | Test in Phase 0 first |
| 256 MB RAM exceeded | App crashes | numpy only, float16 embeddings, no pandas/sklearn |
| LLM returns bad JSON | Quiz breaks | Strict prompt + validate + 1 retry + friendly error |
| YouTube blocks server | Beta feature fails | Timebox, warning banner, fallback to built-in course |
| API rate limits during judging | Demo fails | Cache answers for sample questions; small top-k |
| Copyright | Disqualification | YouTube embeds only, credit creator, no music, no "my course" claim |
| Leaked API key | Cost/abuse | Keys only in Embarko env vars, never in frontend or git |

---

## 7. Final file layout

```
main.py            FastAPI app (Embarko entry point)
rag.py             embed / search / llm helpers
prompts.py         ask / notes / quiz / interview prompts
youtube.py         Phase 4 captions + on-the-fly index
static/index.html  frontend (+ app.js, style.css)
data/chunks.json · data/embeddings.npy · data/videos.json
scripts/export_data.py
requirements.txt   fastapi, uvicorn, numpy, requests (+ youtube-transcript-api)
```
