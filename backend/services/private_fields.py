"""Private Kontofelder (#1492): eine Liste für jede Abfrage auf ``users`` und jede Antwort mit einem Konto.

Was hier steht, verlässt das Backend nie - weder in der eigenen Kontoansicht noch in Listen mit anderen Personen.
Ein neues privates Feld wird nur hier ergänzt: ``private_projection`` und ``strip_private`` lesen die Menge bei jedem
Aufruf, und ``tests/test_private_fields_guard_unit.py`` hält jede Abfrage auf ``users`` und jede Bereinigung daran fest.

Wer ein Konto ganz liest (Anmeldung, Zwei-Faktor, Passkeys), braucht diese Felder zum Prüfen - die Antwort geht dann
durch ``strip_private``.
"""

PRIVATE_USER_FIELDS = frozenset({
    "password_hash",
    # Passwortvertrag (#1033): Markierung, nach welcher Form der Hash entstand.
    "password_contract",
    "google_id",
    "mfa_secret",
    "mfa_pending_secret",
    "mfa_pending_created_at",
    "mfa_recovery_code_hashes",
    "mfa_totp_last_counter",
})


def private_projection(*hidden: str) -> dict:
    """Mongo-Projektion ohne ``_id`` und ohne private Felder; ``hidden`` nimmt weitere heraus (etwa ``"email"``)."""
    return {"_id": 0, **{field: 0 for field in sorted(PRIVATE_USER_FIELDS)}, **{field: 0 for field in hidden}}


def strip_private(doc: dict | None) -> dict | None:
    """Entfernt ``_id`` und alle privaten Felder - im Dokument selbst; zurück kommt dasselbe Dokument."""
    if doc is None:
        return None
    for field in ("_id", *PRIVATE_USER_FIELDS):
        doc.pop(field, None)
    return doc
