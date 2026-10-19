"""Der Mitspieler für den Probelauf (#1635) schreibt nur in einen lokalen Abnahme-Stand (scripts/probelauf_mitspieler.py).

Zwei Schranken: auf dem Rechner nur Docker-Projekte ``lsw-abnahme…`` (sonst startet nicht einmal ``docker compose``), im
Container dieselbe Prüfung wie ``seed_abnahme.py`` (Datenbank der Abnahme, keine Produktion, Adressen nur auf diesem
Rechner, Mongo des Abnahme-Stacks)."""
import importlib.util
import pathlib
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name="probelauf_mitspieler", path="probelauf_mitspieler.py"):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helper = load()
LOCAL = {
    "DB_NAME": "tls_abnahme",
    "APP_ENV": "development",
    "FRONTEND_URL": "http://127.0.0.1:23000",
    "MONGO_URL": "mongodb://abnahme:nur-test@mongodb:27017/?authSource=admin",
}


@pytest.mark.parametrize("name", ["lsw-abnahme", "lsw-abnahme-1635", "lsw-abnahme-nacht", "lsw-abnahme-2"])
def test_acceptance_projects_pass(name):
    assert helper.project_problem(name) is None


@pytest.mark.parametrize("name", ["", "the-lion_squad-esport-webseite", "lionsquad", "lsw-abnahme_prod", "x-lsw-abnahme",
                                  "lsw-abnahme-", "LSW-ABNAHME", "lsw-abnahmeprod"])
def test_other_projects_are_refused(name):
    assert helper.project_problem(name)


def test_host_refuses_foreign_project_before_docker(monkeypatch, capsys):
    monkeypatch.setattr(helper, "PROJECT", "the-lion_squad-esport-webseite")

    def no_docker(*args, **kwargs):
        raise AssertionError("docker compose darf gar nicht erst starten")

    monkeypatch.setattr(subprocess, "Popen", no_docker)
    assert helper.host_main(["stand"]) == 2
    assert "kein Abnahme-Stand" in capsys.readouterr().err


def test_local_acceptance_stack_passes_inside():
    assert helper.abnahme_target_problems(LOCAL) == []
    helper.ensure_abnahme_target(LOCAL)
    # Im Backend des Abnahme-Stands fehlt PUBLIC_BACKEND_URL (nur Build-Argument des Frontends).
    assert helper.abnahme_target_problems({**LOCAL, "PUBLIC_BACKEND_URL": "http://localhost:23000"}) == []


@pytest.mark.parametrize("change, expected", [
    ({"DB_NAME": "tls_production"}, "Datenbank"),
    ({"DB_NAME": None}, "Datenbank"),
    ({"APP_ENV": "production"}, "Produktion"),
    ({"ENVIRONMENT": "Prod"}, "Produktion"),
    ({"FRONTEND_URL": "https://lionsquad.at"}, "FRONTEND_URL"),
    ({"FRONTEND_URL": "http://192.168.1.20:23000"}, "FRONTEND_URL"),
    ({"FRONTEND_URL": None}, "FRONTEND_URL"),
    ({"PUBLIC_BACKEND_URL": "https://api.lionsquad.at"}, "PUBLIC_BACKEND_URL"),
    ({"MONGO_URL": None}, "MONGO_URL"),
    ({"MONGO_URL": "mongodb+srv://abnahme:nur-test@cluster0.example.net"}, "MONGO_URL"),
    ({"MONGO_URL": "mongodb://mongodb:27017,db.lionsquad.at:27017/?replicaSet=rs0"}, "MONGO_URL"),
])
def test_foreign_target_aborts_inside(change, expected):
    env = {key: value for key, value in {**LOCAL, **change}.items() if value is not None}
    with pytest.raises(SystemExit) as raised:
        helper.ensure_abnahme_target(env)
    assert expected in str(raised.value)


def test_test_accounts_come_from_the_seed():
    # Passwort und Zwei-Faktor-Geheimnis liest das Skript aus seed_abnahme.py (eine Quelle), die Konten müssen passen.
    seed = load("seed_abnahme", "seed_abnahme.py")
    assert helper.seed_credentials(ROOT) == (seed.TEST_PASSWORD, seed.TEST_TOTP_SECRET)
    assert {helper.ADMIN, helper.LEAD, helper.HELPER} == {account["email"] for account in seed.ACCOUNTS.values()}
    assert helper.ABNAHME_DB_NAME == seed.ABNAHME_DB_NAME


def test_every_phase_has_a_function():
    assert set(helper.PHASES) == set(helper.PHASE_FUNCTIONS)
    assert helper.parse_args(["spielen", "--turnier", "sofort", "--anzahl", "2"]).anzahl == 2
    with pytest.raises(SystemExit):
        helper.parse_args(["unbekannt"])
