"""Der Liga-Seed der lokalen Abnahme (#2096) schreibt nur in einen lokalen Abnahme-Stand - wie der Fast-Lap-Seed.

Über ABNAHME_PROJECT/ABNAHME_COMPOSE_DIR ließe sich das Skript auf einen fremden Stack richten. Im Container bricht es
deshalb vor jedem Schreiben ab, wenn nicht alles stimmt: Datenbank der Abnahme (``tls_abnahme…``), keine Produktion,
öffentliche Adressen nur auf diesem Rechner."""
import importlib.util
import pathlib
from datetime import date, timedelta

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "seed_abnahme_liga.py"


def load():
    spec = importlib.util.spec_from_file_location("seed_abnahme_liga", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GOOD = {"DB_NAME": "tls_abnahme", "APP_ENV": "development", "FRONTEND_URL": "http://127.0.0.1:24100",
        "PUBLIC_BACKEND_URL": "http://localhost:24100", "MONGO_URL": "mongodb://abnahme:nur-test@mongodb:27017/?authSource=admin"}


@pytest.mark.parametrize("today", [date(2026, 11, 2), date(2026, 11, 3), date(2026, 11, 8), date(2031, 2, 28)])
def test_the_season_lies_ahead_whatever_the_date(today):
    # Der Stand läuft nicht aus (#2200): immer ein Dienstag in der Zukunft, Pause in den Spielwochen 7 und 8.
    dates = load().season_dates(today)
    start = date.fromisoformat(dates["start_date"][:10])
    assert start.weekday() == 1
    assert 8 <= (start - today).days <= 14
    assert date.fromisoformat(dates["registration_deadline"]) == start - timedelta(days=4)
    pause = dates["blocked_periods"][0]
    assert (date.fromisoformat(pause["start_date"]) - start).days == 41
    assert (date.fromisoformat(pause["end_date"]) - start).days == 54


@pytest.mark.parametrize("env", [{}, {"ABNAHME_PROJECT": " "}, {"ABNAHME_PROJECT": "lsw-abnahme"}])
def test_a_job_never_targets_the_shared_stack(env):
    with pytest.raises(SystemExit):
        load().guard_job_project(env)


def test_a_job_runs_on_an_own_stack():
    load().guard_job_project({"ABNAHME_PROJECT": "lsw-abnahme-2200"})


def test_a_local_acceptance_stack_is_fine():
    load().guard_environment(GOOD)
    load().guard_environment({**GOOD, "DB_NAME": "tls_abnahme_2"})


def test_the_backend_of_the_acceptance_stack_has_no_public_backend_url():
    # Im Abnahme-Stand ist PUBLIC_BACKEND_URL nur Build-Argument des Frontends (Codex-Prüfung): fehlt sie, kein Abbruch.
    env = {key: value for key, value in GOOD.items() if key != "PUBLIC_BACKEND_URL"}
    load().guard_environment(env)


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
    # Codex zu #1610: Datenbank nur der Compose-Dienst „mongodb“ oder dieser Rechner.
    {"MONGO_URL": ""},
    {"MONGO_URL": "mongodb://abnahme:nur-test@db.lionsquad.at:27017"},
    {"MONGO_URL": "mongodb+srv://abnahme:nur-test@cluster0.example.net"},
    {"MONGO_URL": "mongodb://mongodb:27017,db.lionsquad.at:27017/?replicaSet=rs0"},
    {"MONGO_URL": "mongodb://abnahme:nur-test@mongodb:27017/?authSource=admin&replicaSet=rs0"},
])
def test_anything_else_stops_before_writing(change):
    with pytest.raises(SystemExit):
        load().guard_environment({**GOOD, **change})
