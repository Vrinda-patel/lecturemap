"""One-time: convert all_chunks_with_embeddings.json into the slim files the web app ships with.

Run from the project root:  python scripts/export_data.py
"""
import json

import numpy as np

with open("all_chunks_with_embeddings.json", encoding="utf-8") as f:
    raw = json.load(f)

chunks = [
    {"number": int(c["number"]), "start": round(c["start"], 1), "end": round(c["end"], 1), "text": c["text"].strip()}
    for c in raw
]
emb = np.array([c["embedding"] for c in raw], dtype=np.float32)
emb /= np.linalg.norm(emb, axis=1, keepdims=True)  # pre-normalise so cosine = dot product

with open("data/chunks.json", "w", encoding="utf-8") as f:
    json.dump(chunks, f, ensure_ascii=False)
np.save("data/embeddings.npy", emb.astype(np.float16))

print(f"{len(chunks)} chunks, embeddings {emb.shape} -> data/")
