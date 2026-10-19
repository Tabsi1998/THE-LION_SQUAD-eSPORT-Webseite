"""Externe Serien - Kalender (#1742): Termine anlegen, einfügen, verschieben und absagen, „Ergebnis fehlt“.

Kommt mit Paket P3. Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741), damit die
Pakete einander nicht in dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in
``models.py``, ``database.py`` und ``services/personal_data.py``."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])
