"""Externe Serien - Rechte (#1749): Captain je Serie mit Ablauf; der Vorstand (Bereich Redaktion) darf alles.

Kommt mit Paket P6. Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741), damit die
Pakete einander nicht in dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in
``models.py``, ``database.py`` und ``services/personal_data.py``."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])
