"""Build dist/lecturemap.zip with only the files Embarko needs.

Run from the project root:  python scripts/package.py
Then upload the zip at https://embarko.ai/app → "Put something online" → "Upload a file instead".
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["main.py", "rag.py", "prompts.py", "youtube.py", "requirements.txt"]
DIRS = ["data", "static"]

out = ROOT / "dist" / "lecturemap.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(ROOT / f, f)
    for d in DIRS:
        for p in sorted((ROOT / d).rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(ROOT).as_posix())
    names = z.namelist()

print(f"{out}  ({out.stat().st_size / 1e6:.1f} MB)")
print("\n".join("  " + n for n in names))
assert not any(n.startswith(".env") for n in names), "secret file in bundle!"
