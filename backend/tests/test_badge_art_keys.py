"""Erfolge II (E8, #618): jede Gruppe des Katalogs hat ein Motiv in der Abzeichen-Kunst des Webs -
entweder direkt (``art``) oder über einen Verwandten (ALIASES in badgeArt.jsx). Der Test liest die
Web-Dateien, damit ein neuer Katalog-Schlüssel ohne Motiv hier auffällt und nicht erst im Browser."""
import pathlib
import re

import achievement_catalog as catalog

WEB = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "achievements"
KEY_RE = re.compile(r'^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9-]*)):\s', re.M)


def _keys(path: pathlib.Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return {a or b for a, b in KEY_RE.findall(text)}


def _motif_keys() -> set[str]:
    keys: set[str] = set()
    for name in ("play", "racing", "people", "club"):
        keys |= _keys(WEB / "motifs" / f"{name}.jsx")
    return keys


def _aliases() -> dict[str, str]:
    text = (WEB / "badgeArt.jsx").read_text(encoding="utf-8")
    block = text.split("export const ALIASES", 1)[1].split("});", 1)[0]
    out: dict[str, str] = {}
    for match in re.finditer(r'(?:"([^"]*)"|([A-Za-z][A-Za-z0-9-]*)):\s*"([^"]+)"', block):
        key = match.group(1) if match.group(1) is not None else match.group(2)
        out[key] = match.group(3)
    return out


def test_jede_katalog_gruppe_hat_ein_motiv():
    motifs = _motif_keys()
    aliases = _aliases()
    assert len(motifs) >= 140
    assert all(target in motifs for target in aliases.values()), sorted(t for t in aliases.values() if t not in motifs)
    missing = []
    for group in catalog.ACHIEVEMENT_GROUPS:
        art = str(group.get("art") or "")
        if art in motifs or aliases.get(art) in motifs:
            continue
        missing.append((group["code"], art))
    assert missing == [], missing


def test_stufen_ohne_eigenes_motiv_landen_bei_einem_verwandten_oder_der_gruppe():
    motifs = _motif_keys()
    aliases = _aliases()
    groups = {g["code"]: g for g in catalog.ACHIEVEMENT_GROUPS}
    orphans = []
    for tier in catalog.ACHIEVEMENT_TIERS:
        art = str(tier.get("art") or "")
        group_art = str(groups.get(tier["group_code"], {}).get("art") or "")
        if art in motifs or aliases.get(art) in motifs or group_art in motifs or aliases.get(group_art) in motifs:
            continue
        orphans.append((tier["code"], art))
    assert orphans == [], orphans[:20]
