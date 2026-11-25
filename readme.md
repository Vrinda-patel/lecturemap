# LectureMap

Ask any JavaScript doubt and get an answer with **clickable timestamps** that jump the lecture video to the exact second. Also has **Exam mode** (5 notes + 5 MCQs) and **Interview mode** (AI mock interviewer with scoring). Answers in Hinglish or English. A Beta mode lets you use any YouTube video with captions.

Content: [Namaste JavaScript by Akshay Saini](https://www.youtube.com/playlist?list=PLlasXeu85E9cQ32gLCvAvr9vNaUccPVNP).

## Stack
- FastAPI backend (`main.py`, `rag.py`, `prompts.py`, `youtube.py`) and a vanilla HTML/JS frontend (`static/`)
- Groq for the LLM, Cloudflare Workers AI `bge-m3` for embeddings
- Data: 542 transcript chunks with precomputed bge-m3 embeddings in `data/`

## Run locally
1. Create a `.env` file in the project root:
   ```
   GROQ_API_KEY=...
   CF_ACCOUNT_ID=...
   CF_API_TOKEN=...
   ```
2. Install and run:
   ```bash
   pip install -r requirements.txt python-dotenv
   python main.py        # http://localhost:8000
   ```

## Deploy on Embarko
1. Build the bundle with `python scripts/package.py`, which writes `dist/lecturemap.zip`.
2. Go to https://embarko.ai/app, choose **Put something online**, then **Upload a file instead**, and upload the zip.
3. In App setup, set the env vars `GROQ_API_KEY`, `CF_ACCOUNT_ID` and `CF_API_TOKEN`.

## PDF export
Each mode has a download button in the top bar: **Download Conversation PDF** (Ask), **Download Exam Revision PDF** (Exam) and **Download Interview Report** (Interview).

- **How it works:** `static/report.js` turns the session data already in the browser into a branded A4 report, and the browser's print dialog saves it (choose **Save as PDF**). No server endpoint, no extra AI calls, nothing new to install.
- **Privacy:** session data never leaves the user's browser, so there are no sessions to authorise. AI text is sanitised with DOMPurify and user text is HTML-escaped before it goes into the report.
- **Contents:** Conversation has every Q&A, code blocks, clickable timestamp links and an index of lecture moments. Exam Revision has notes, quiz questions with the correct answer, your answer and explanations. Interview Report has per-question and overall scores, feedback, improved answers, strengths, weaknesses and a revision plan.
- **Browsers:** Chrome/Edge (desktop and Android) and Safari (macOS and iOS, via Share → Save to Files). Page numbers in the footer need Chrome/Edge 131+; other browsers still produce the PDF without them. In-app browsers (Instagram, WhatsApp and similar) can't save PDFs, so the app asks the user to open the link in Chrome or Safari.
- **Why not server-side Playwright/Chromium:** Embarko gives 256 MB RAM and deploys from a zip with only `requirements.txt`. Headless Chromium needs about 150–300 MB per render plus a browser binary and system libraries, so it would crash the app.

## Tests
```bash
pip install -r requirements-dev.txt
python -m pytest tests/            # API (AI calls are stubbed, no keys needed)
node --test tests/report.test.js   # PDF report builders (Node 18+)
```

## Rebuilding the data from your own videos
The original offline pipeline still works. It needs local Ollama with `bge-m3`.
1. Put videos in `videos/`, then run `process_videos.py` (ffmpeg converts them to mp3).
2. Transcribe the mp3s into `jsons/`. The transcription script is not in this repo.
3. Run `preprocess_json.py` to embed the chunks, then `python scripts/export_data.py` to produce the slim `data/` files.
4. Update `data/videos.json` with the YouTube IDs.

The old Streamlit prototype (`app.py`, `query_rag.py`) runs locally with Ollama. See `README_UI.md` and `requirements-streamlit.txt`.
