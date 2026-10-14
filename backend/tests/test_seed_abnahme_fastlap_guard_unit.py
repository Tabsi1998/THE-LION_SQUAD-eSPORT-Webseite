"""Der Fast-Lap-Seed für die lokale Abnahme schreibt nur in einen lokalen Abnahme-Stand (#1585, Codex-Prüfung).

Über ABNAHME_PROJECT/ABNAHME_COMPOSE_DIR ließe sich das Skript auf einen fremden Stack richten. Im Container bricht es
deshalb vor jedem Schreiben ab, wenn nicht alles stimmt: Datenbank der Abnahme (``tls_abnahme…``), keine Produktion,
öffentliche Adressen nur auf diesem Rechner."""
import importlib.util
import pathlib

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "seed_abnahme_fastlap.py"


def load():
    spec = importlib.util.spec_from_file_location("seed_abnahme_fastlap", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GOOD = {"DB_NAME": "tls_abnahme", "APP_ENV": "development", "FRONTEND_URL": "http://127.0.0.1:24100",
        "PUBLIC_BACKEND_URL": "http://localhost:24100"}


def test_a_local_acceptance_stack_is_fine():
    load().guard_environment(GOOD)
    load().guard_environment({**GOOD, "DB_NAME": "tls_abnahme_2"})


@pytest.mark.parametrize("change", [
    {"DB_NAME": "tls"},
    {"DB_NAME": "lionsquad"},
    {"DB_NAME": ""},
    {"APP_ENV": "production"},
    {"APP_ENV": "PROD"},
    {"ENV": "production"},
    {"FRONTEND_URL": "https://lionsquad.at"},
    {"PUBLIC_BACKEND_URL": "https://lionsquad.at"},
    {"PUBLIC_BACKEND_URL": "http://127.0.0.1.lionsquad.at"},
    {"FRONTEND_URL": ""},
])
def test_anything_else_stops_before_writing(change):
    with pytest.raises(SystemExit):
        load().guard_environment({**GOOD, **change})
