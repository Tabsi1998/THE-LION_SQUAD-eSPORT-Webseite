"""Erfolge (#2339): jedes Symbol aus dem Katalog - Kategorien, Gruppen und Stufen - steht in der Liste des Webs
(frontend/src/components/tls/AchievementIcon.jsx). Fehlt ein Name, zeigt die Seite das Ersatzsymbol; vorher standen so
Saison und Profil & Konto mit einer Trophäe da. Der Test liest die Web-Datei wie test_badge_art_keys.py."""
import pathlib
import re

import achievement_catalog as catalog

ICON_FILE = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "tls" / "AchievementIcon.jsx"
KEY_RE = re.compile(r'^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9-]*)):\s', re.M)


def normalize(value) -> str:
    """Wie ``normalizeIconName`` im Web: camelCase und Unterstriche werden zu Bindestrichen, alles klein."""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", str(value or "").strip())
    return re.sub(r"[\s_]+", "-", text).lower()


def web_icon_names(text: str | None = None) -> set[str]:
    text = text if text is not None else ICON_FILE.read_text(encoding="utf-8")
    block = text.split("const ICONS = {", 1)[1].split("};", 1)[0]
    return {a or b for a, b in KEY_RE.findall(block)}


def catalog_icon_names() -> dict[str, list[str]]:
    used: dict[str, list[str]] = {}
    for key, meta in catalog.CATEGORIES.items():
        used.setdefault(normalize(meta["icon"]), []).append(f"Kategorie {key}")
    for group in catalog.ACHIEVEMENT_GROUPS:
        if group.get("icon"):
            used.setdefault(normalize(group["icon"]), []).append(group["code"])
    for tier in catalog.ACHIEVEMENT_TIERS:
        if tier.get("icon"):
            used.setdefault(normalize(tier["icon"]), []).append(tier["code"])
    return used


def test_jedes_katalog_symbol_steht_im_web():
    known = web_icon_names()
    assert len(known) >= 140
    missing = {name: codes[:3] for name, codes in catalog_icon_names().items() if name not in known}
    assert missing == {}, missing


def test_kategorien_saison_und_profil_haben_ihr_symbol():
    known = web_icon_names()
    assert {"calendar-days", "user-round"} <= known
    assert catalog.CATEGORIES["season"]["icon"] == "calendar-days" and catalog.CATEGORIES["profile"]["icon"] == "user-round"


def test_die_pruefung_findet_einen_fehlenden_namen():
    # Gegenprobe: dieselbe Lesart auf einer Liste ohne „calendar-days“ meldet ihn.
    text = 'const ICONS = {\n  trophy: Trophy,\n  "user-round": UserRound,\n};'
    known = web_icon_names(text)
    assert known == {"trophy", "user-round"}
    assert "calendar-days" in {name for name in catalog_icon_names() if name not in known}
    assert normalize("CalendarDays") == "calendar-days" and normalize("user_round") == "user-round"
