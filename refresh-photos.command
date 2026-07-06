#!/bin/zsh
set -euo pipefail

SITE_DIR="/Users/ahs/Documents/0041video/tiaose-github-pages"
cd "$SITE_DIR"

python3 - <<'PY'
import json
from pathlib import Path

photo_dir = Path("photos")
extensions = {".jpg", ".jpeg", ".png", ".webp"}
files = sorted(
    path for path in photo_dir.iterdir()
    if path.is_file() and path.suffix.lower() in extensions
)

items = []
for index, path in enumerate(files, start=1):
    title = f"作品 {index:02d}"
    items.append({"src": path.as_posix(), "title": title})

content = "window.SITE_PHOTOS = "
content += json.dumps(items, ensure_ascii=False, indent=2)
content += ";\n"
Path("photos.js").write_text(content, encoding="utf-8")
print(f"已更新 photos.js：{len(items)} 张照片")
PY
