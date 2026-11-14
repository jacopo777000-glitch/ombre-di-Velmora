from __future__ import annotations
import io, json, re, zipfile
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/tmp/velmora-painterly")
PACKS = [
    {
        "id": "kalponic",
        "archive": "kalponic.zip",
        "title": "Painterly Battle Backgrounds — Free Pack",
        "author": "Kalponic Studio",
        "page": "https://kalponic-studio.itch.io/painterly-battle-backgrounds",
        "license": "Free for personal and commercial projects; images may be edited and included in finished games; do not resell or repackage as standalone backgrounds."
    },
    {
        "id": "gegx",
        "archive": "gegx.zip",
        "title": "Painterly Backgrounds Free",
        "author": "GegX",
        "page": "https://gegx.itch.io/painterly-backgrounds-free",
        "license": "Free for commercial and non-commercial projects including games; modification permitted; do not resell or redistribute the files as an asset pack or image collection; no AI training."
    }
]

def slug(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "_", Path(value).stem).strip("_").lower()
    return (value[:48] or "background")

def scene_tags(value: str):
    text = value.lower()
    tags = []
    if re.search(r"tavern|inn|pub|bar|locanda|interior|interior", text):
        tags.append("tavern")
    if re.search(r"forest|wood|woods|grove|tree|meadow|swamp|nature|river|valley|camp|mountain|snow|ice|tundra|waterfall", text):
        tags.append("forest")
    if re.search(r"dungeon|crypt|cave|tomb|grave|ruin|temple|library|castle|hall|throne|prison|forge|corridor|cell", text):
        tags.append("crypt")
    if re.search(r"boss|arena|volcano|lava|ritual|fortress|throne|citadel|dragon", text):
        tags.append("boss")
    if not tags:
        tags = ["forest", "crypt", "boss"]
    return sorted(set(tags))

total = {}
for pack in PACKS:
    archive = SOURCE / pack["archive"]
    if not archive.is_file():
        raise SystemExit("Archivio ufficiale mancante: " + str(archive))
    out = ROOT / "assets" / "battle" / pack["id"]
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.webp"):
        old.unlink()
    images = []
    with zipfile.ZipFile(archive) as zf:
        names = sorted(
            n for n in zf.namelist()
            if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and not n.endswith("/")
            and not re.search(r"preview|contact|thumbnail|thumb|parallax|layer|demo|sheet|sample", n, re.I)
        )
        for index, name in enumerate(names, 1):
            try:
                image = Image.open(io.BytesIO(zf.read(name)))
                image = ImageOps.exif_transpose(image)
                if image.width < 1600 or image.height < 900 or image.width / image.height < 1.5:
                    continue
                image = image.convert("RGB")
                image = ImageOps.fit(image, (1920, 1080), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                filename = pack["id"] + "_" + str(len(images) + 1).zfill(2) + "_" + slug(name) + ".webp"
                target = out / filename
                image.save(target, "WEBP", quality=83, method=6)
                images.append({
                    "file": "assets/battle/" + pack["id"] + "/" + filename,
                    "sourceFile": name,
                    "width": image.width,
                    "height": image.height,
                    "bytes": target.stat().st_size,
                    "scenes": scene_tags(name)
                })
            except Exception as exc:
                raise SystemExit("Impossibile elaborare " + name + ": " + str(exc))
    minimum = 40 if pack["id"] == "kalponic" else 6
    if len(images) < minimum:
        raise SystemExit("Numero di sfondi inferiore al minimo per " + pack["id"] + ": " + str(len(images)) + " / " + str(minimum))
    manifest = {
        "author": pack["author"],
        "title": pack["title"],
        "source": pack["page"],
        "pack": pack["archive"],
        "license": pack["license"],
        "conversion": "Originali ridimensionati/croppati a 1920x1080 e convertiti in WebP per l'integrazione nel gioco; i pacchetti ZIP originali non sono inclusi.",
        "images": images
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total[pack["id"]] = len(images)
    print(pack["id"] + ": " + str(len(images)) + " sfondi WebP ottimizzati")

credits = ROOT / "assets" / "battle" / "CREDITS.md"
text = credits.read_text(encoding="utf-8")
additions = []
if "Painterly Battle Backgrounds — Free Pack" not in text:
    additions.append(
        "\n- kalponic/ — Kalponic Studio, Painterly Battle Backgrounds (Free Pack, 50 battle backgrounds). "
        "Official page: https://kalponic-studio.itch.io/painterly-battle-backgrounds. "
        "The author permits personal and commercial game use, editing and inclusion in finished projects; "
        "standalone resale/repackaging is prohibited. The artwork is disclosed as AI-assisted. "
        "Only optimized WebP game resources are included here; the original ZIP is not redistributed.\n"
    )
if "Painterly Backgrounds Free" not in text:
    additions.append(
        "\n- gegx/ — GegX, Painterly Backgrounds Free (six painted fantasy backgrounds plus a parallax set). "
        "Official page: https://gegx.itch.io/painterly-backgrounds-free. "
        "The author permits commercial and non-commercial game use and modification; redistribution as an asset pack "
        "or image collection and AI training are prohibited. Credit is not required. The artwork is disclosed as AI-generated "
        "and hand-curated. Only optimized WebP game resources are included here; the original ZIP is not redistributed.\n"
    )
if additions:
    credits.write_text(text.rstrip() + "\n" + "".join(additions), encoding="utf-8")
print("Importazione completata:", total)
