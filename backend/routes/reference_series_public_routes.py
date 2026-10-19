"""Externe Serien - öffentliche Seiten (#1745 bis #1748): Serienseite, Rennliga, Team-Liga und der schlanke Endpunkt
für „Heute im Einsatz“ und „Läuft gerade“. Öffentliche Pfade unter ``/api/reference-series/public/…``, damit
eine Spur-Adresse nie mit ``/admin`` zusammenfällt; Sichtbarkeit der Serie gilt auch für Termine und Tabellen.

Kommt mit den Paketen P7 bis P10b. Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741),
damit die Pakete einander nicht in dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in
``models.py``, ``database.py`` und ``services/personal_data.py``."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])
