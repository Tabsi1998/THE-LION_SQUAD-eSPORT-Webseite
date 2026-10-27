"""Hilfe für Tests, die öffentliche Formulare abschicken (#2067): ein gültiges Formular-Token wie aus dem Browser.

Das Token ist ``age`` Sekunden alt - so prüft der Test nicht nebenbei die Mindestzeit und muss nicht warten.
"""
import time

from services import spam_guard


def form_fields(form: str, *, age: float = 30.0) -> dict:
    return {spam_guard.TOKEN_FIELD: spam_guard.issue_token(form, now=time.time() - age), spam_guard.HONEYPOT_FIELD: ""}
