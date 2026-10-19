"""Externe Serien - Zuordnung (#1743): Teilnehmer je Serie, Aliase über alle Serien, Vorschläge über Spiel-IDs, Gäste.

Kommt mit Paket P4. Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741), damit die
Pakete einander nicht in dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in
``models.py``, ``database.py`` und ``services/personal_data.py``."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])
