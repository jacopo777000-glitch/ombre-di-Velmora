from __future__ import annotations
import io, json, re, zipfile
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/tmp/velmora-duskforge")
OUT = ROOT / "assets" / "battle" / "duskforge"
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.webp"):
    old.unlink()

packs = [
    ("forest", "forest.zip", "Enchanted Forest RPG Backgrounds"),
    ("dungeon", "dungeon.zip", "Dark Dungeon RPG Backgrounds"),
]
manifest = {"license": "Free for commercial use; no attribution required; raw files may not be redistributed.", "sources": []}
count = 0

def slug(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "_", Path(value).stem).strip("_").lower()
    return (value[:42] or "background")

for pack_id, archive_name, title in packs:
    archive = SOURCE / archive_name
    if not archive.is_file():
        raise SystemExit(f"Archivio ufficiale mancante: {archive}")
    entries = []
    with zipfile.ZipFile(archive) as zf:
        names = sorted(n for n in zf.namelist() if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and not n.endswith("/"))
        for index, name in enumerate(names, 1):
            try:
                image = Image.open(io.BytesIO(zf.read(name)))
                image = ImageOps.exif_transpose(image)
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                image.thumbnail((1920, 1080), Image.Resampling.LANCZOS)
                filename = f"duskforge_{pack_id}_{index:02d}_{slug(name)}.webp"
                target = OUT / filename
                image.save(target, "WEBP", quality=84, method=6)
                entries.append({
                    "file": "assets/battle/duskforge/" + filename,
                    "sourceFile": name,
                    "width": image.width,
                    "height": image.height,
                    "bytes": target.stat().st_size
                })
                count += 1
            except Exception as exc:
                raise SystemExit(f"Impossibile convertire {name} da {archive_name}: {exc}")
    if not entries:
        raise SystemExit(f"Nessuna immagine trovata in {archive_name}")
    manifest["sources"].append({"title": title, "pack": archive_name, "images": entries})

if count < 10:
    raise SystemExit(f"Numero inatteso di immagini importate: {count}")

(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
credits = ROOT / "assets" / "battle" / "CREDITS.md"
text = credits.read_text(encoding="utf-8")
addition = """
- duskforge/ — Duskforge Studio, Enchanted Forest RPG Backgrounds and Dark Dungeon RPG Backgrounds (20 illustrated PNG backgrounds, converted to optimized WebP). Official pages: https://doomguizz.itch.io/enchanted-forest-rpg-backgrounds and https://doomguizz.itch.io/dark-dungeon-rpg-backgrounds.
  - License stated by the author: free for commercial use, no attribution required, no redistribution of raw files. The repository contains only converted, optimized game-ready images, not the original ZIP/PNG files.
"""
if "Enchanted Forest RPG Backgrounds" not in text:
    credits.write_text(text.rstrip() + "\n" + addition, encoding="utf-8")
print(f"Importate {count} immagini WebP in {OUT}")
