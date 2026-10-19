"""Externe Serien - Ergebnisse eintragen (#1744): Vorschau, Übernehmen mit Version (409), Revision und Protokoll.

Kommt mit Paket P5a. Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741), damit die
Pakete einander nicht in dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in
``models.py``, ``database.py`` und ``services/personal_data.py``."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])
