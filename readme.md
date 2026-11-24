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

## Rebuilding the data from your own videos
The original offline pipeline still works. It needs local Ollama with `bge-m3`.
1. Put videos in `videos/`, then run `process_videos.py` (ffmpeg converts them to mp3).
2. Transcribe the mp3s into `jsons/`. The transcription script is not in this repo.
3. Run `preprocess_json.py` to embed the chunks, then `python scripts/export_data.py` to produce the slim `data/` files.
4. Update `data/videos.json` with the YouTube IDs.

The old Streamlit prototype (`app.py`, `query_rag.py`) runs locally with Ollama. See `README_UI.md` and `requirements-streamlit.txt`.
