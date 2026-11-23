"""Große Uploads (#2548): FastAPI legt Dateien beim Lesen des Formulars in TMPDIR ab.

Im Backend-Container ist /tmp ein tmpfs mit 128 MB. Videos dürfen bis MAX_VIDEO_UPLOAD_MB (1536) groß sein - lag TMPDIR auf /tmp,
scheiterte jedes Video über ~128 MB mit „There was an error parsing the body“. Dieser Wächter hält fest, dass TMPDIR auf einem
eigenen Volume liegt und nicht unter einem tmpfs. Bewusst ohne YAML-Bibliothek: die Datei wird zeilenweise gelesen.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def backend_block() -> str:
    text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    start = text.index("\n  backend:\n")
    following = re.search(r"\n  [a-z][\w-]*:\n", text[start + 1:])
    return text[start: start + 1 + following.start()] if following else text[start:]


def test_tmpdir_is_a_volume_and_not_the_small_tmpfs():
    block = backend_block()
    tmpdir = re.search(r'^\s+TMPDIR:\s*"?([^"\n]+)"?\s*$', block, re.M)
    assert tmpdir, "TMPDIR fehlt am Backend - große Uploads landen sonst im 128-MB-tmpfs unter /tmp"
    path = tmpdir.group(1).strip()
    tmpfs_paths = re.findall(r"^\s+-\s+(/[^:\s]+):size=", block, re.M)
    assert all(not path.startswith(mount) for mount in tmpfs_paths), f"TMPDIR {path} liegt in einem tmpfs {tmpfs_paths}"
    mounts = re.findall(r"^\s+-\s+[\w.-]+:(/[^\s:]+)\s*$", block, re.M)
    assert path in mounts, f"TMPDIR {path} ist kein eigenes Volume: {mounts}"


def test_the_spool_volume_is_declared_and_created_in_the_image():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert re.search(r"^volumes:\n(?:  \w+:\n)*  upload_spool:", compose, re.M)
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "/app/backend/spool" in dockerfile, "Das Verzeichnis muss im Image dem appuser gehören, sonst ist das neue Volume nicht beschreibbar"
