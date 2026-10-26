"""Ja/Nein-Felder aus Formularen (multipart), gleich in jeder FastAPI-Version.

Seit FastAPI 0.161 wird ein *fehlendes* ``bool``-Formularfeld zu ``False``, auch mit ``Form(default=True)`` - wie ein
nicht angehakter HTML-Haken. Ein Feld mit der Vorgabe „ja“ nimmt deshalb Text an (``str | None = Form(None)``) und
liest ihn hier: fehlt es oder ist es leer, gilt die Vorgabe.
"""
from fastapi import HTTPException

_TRUE = frozenset({"true", "1", "on", "yes", "ja"})
_FALSE = frozenset({"false", "0", "off", "no", "nein"})


def form_flag(value: str | None, *, default: bool) -> bool:
    """``value`` als Ja/Nein - ohne Wert die Vorgabe, ein unbekanntes Wort gibt 422."""
    if value is None or not value.strip():
        return default
    word = value.strip().lower()
    if word in _TRUE:
        return True
    if word in _FALSE:
        return False
    raise HTTPException(status_code=422, detail="Ja/Nein-Feld: erwartet true oder false.")
