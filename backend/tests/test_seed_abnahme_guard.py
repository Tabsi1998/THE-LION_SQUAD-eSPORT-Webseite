"""Der Abnahme-Seed schreibt nur in einen lokalen Abnahme-Stand (scripts/seed_abnahme.py, Teil --inside)."""
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("seed_abnahme", ROOT / "scripts" / "seed_abnahme.py")
seed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed)

LOCAL = {
    "DB_NAME": "tls_abnahme",
    "APP_ENV": "development",
    "FRONTEND_URL": "http://127.0.0.1:23000",
    "PUBLIC_BACKEND_URL": "http://localhost:23000",
}


def test_db_name_matches_env_example():
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.abnahme.example").read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    assert values["DB_NAME"].startswith(seed.ABNAHME_DB_NAME)


def test_local_abnahme_stack_passes():
    assert seed.abnahme_target_problems(LOCAL) == []
    seed.ensure_abnahme_target(LOCAL)


def test_public_backend_url_only_checked_when_set():
    # Im echten Abnahme-Backend fehlt PUBLIC_BACKEND_URL (nur Build-Argument des Frontends).
    without = {key: value for key, value in LOCAL.items() if key != "PUBLIC_BACKEND_URL"}
    assert seed.abnahme_target_problems(without) == []
    assert seed.abnahme_target_problems({**LOCAL, "DB_NAME": "tls_abnahme_planer"}) == []


@pytest.mark.parametrize("change, expected", [
    ({"DB_NAME": "tls_production"}, "Datenbank"),
    ({"DB_NAME": None}, "Datenbank"),
    ({"APP_ENV": "production"}, "Umgebung"),
    ({"APP_ENV": "development", "ENVIRONMENT": "Production"}, "Umgebung"),
    ({"ENV": "prod"}, "Umgebung"),
    ({"FRONTEND_URL": None}, "FRONTEND_URL"),
    ({"FRONTEND_URL": "https://lionsquad.at"}, "FRONTEND_URL"),
    ({"PUBLIC_BACKEND_URL": "https://api.lionsquad.at"}, "PUBLIC_BACKEND_URL"),
    ({"FRONTEND_URL": ""}, "FRONTEND_URL"),
])
def test_foreign_target_aborts(change, expected):
    env = {key: value for key, value in {**LOCAL, **change}.items() if value is not None}
    with pytest.raises(SystemExit) as raised:
        seed.ensure_abnahme_target(env)
    assert expected in str(raised.value)
