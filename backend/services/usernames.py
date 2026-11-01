"""Der Benutzername (#2126): eine Regel für neue Namen - gleich in frontend/src/lib/username.js.

Die Regel gilt beim Anlegen. Ältere Konten behalten ihren Namen, auch mit Leerzeichen oder nur in der Schreibweise
verschieden („Max“ und „max“): Die Anmeldung läuft über die E-Mail, Profile findet die exakte Schreibweise zuerst und
danach jede andere. Nichts wird umbenannt. Darum auch kein eindeutiger Index ohne Groß/klein: ein Doppelter aus der
Zeit davor würde ihn verhindern; ``username_taken`` prüft beim Anlegen.
"""
import re
import unicodedata
from urllib.parse import quote

USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_.-]{3,32}")
# Ohne Feldnamen: services/validation_messages.py setzt „Benutzername:“ davor.
USERNAME_RULE = "3 bis 32 Zeichen, nur Buchstaben ohne Umlaute, Ziffern und _ . - (keine Leerzeichen)"


def username_problem(username: str) -> str | None:
    return None if USERNAME_PATTERN.fullmatch(username or "") else USERNAME_RULE


def can_be_a_username(name: str) -> bool:
    """Vor jeder Suche: so lang oder mit NUL gab es nie einen Benutzernamen - die Antwort ist ohne Datenbank „nicht gefunden“."""
    return len(name) <= 200 and "\x00" not in name


def any_case(username: str) -> dict:
    """Die Abfrage für denselben Namen in jeder Schreibweise."""
    return {"username": {"$regex": f"^{re.escape(username)}$", "$options": "i"}}


async def username_taken(db, username: str) -> bool:
    return bool(await db.users.find_one(any_case(username), {"_id": 0, "id": 1}))


def username_from_name(name: str | None) -> str:
    """Ein gültiger Vorschlag aus einem Klarnamen (Google-Anmeldung): „Jörg Müller“ wird zu „Jorg_Muller“."""
    plain = unicodedata.normalize("NFKD", (name or "").replace("ß", "ss")).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", plain).strip("_.-")[:20]
    return cleaned if len(cleaned) >= 3 else "player"


def profile_path(username: str) -> str:
    return f"/u/{quote(str(username), safe='')}"
