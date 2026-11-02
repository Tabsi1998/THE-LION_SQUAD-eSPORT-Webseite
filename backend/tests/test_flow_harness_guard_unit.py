"""Die Sicherung der Ablauf-Tests gegen echtes MongoDB (#2200): nur eigene Rechner, nur Testdatenbanken. Ohne Server."""
from __future__ import annotations

import pathlib
import re
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import flow_mongo  # noqa: E402


@pytest.mark.parametrize("url", [
    "mongodb://127.0.0.1:27017",
    "mongodb://localhost",
    "mongodb://LOCALHOST:27217/",
    "mongodb://127.0.0.1:27017/flowtest_probe",
])
def test_these_addresses_are_allowed(url):
    assert flow_mongo.check_url(url) == url


@pytest.mark.parametrize("url", [
    "mongodb+srv://cluster.example.test",
    "http://127.0.0.1:27017",
    "127.0.0.1:27017",
    "mongodb://mongodb:27017",  # der Dienst der Produktion in docker-compose.yml
    "mongodb://mongo:27017",
    "mongodb://testnutzer:testwert@127.0.0.1:27017/?authSource=admin",
    "mongodb://testnutzer@127.0.0.1:27017",
    "mongodb://127.0.0.1:27017/?replicaSet=rs0",
    "mongodb://127.0.0.1:27017,localhost:27018",
    "mongodb://db.example.test:27017",
    "mongodb://10.0.0.5:27017",
    "mongodb://127.0.0.1:27017,db.example.test:27017",
    "mongodb://localhost@db.example.test:27017",  # „localhost“ ist hier der Benutzer, nicht der Host
    "mongodb://127.0.0.1:27017/tls_arena",
    "mongodb://[::1]:27017",
    "mongodb://",
])
def test_everything_else_is_refused(url):
    with pytest.raises(flow_mongo.FlowMongoRefused):
        flow_mongo.check_url(url)


def test_without_the_variable_it_stays_mongomock():
    assert flow_mongo.configured_url({}) is None
    assert flow_mongo.configured_url({flow_mongo.ENV_NAME: "  "}) is None


def test_an_environment_marked_as_production_is_refused():
    env = {flow_mongo.ENV_NAME: "mongodb://127.0.0.1:27017", "APP_ENV": "production"}
    with pytest.raises(flow_mongo.FlowMongoRefused):
        flow_mongo.configured_url(env)


def test_database_names_are_unique_and_carry_the_prefix():
    first = flow_mongo.new_db_name({"PYTEST_XDIST_WORKER": "gw3"})
    second = flow_mongo.new_db_name({"PYTEST_XDIST_WORKER": "gw3"})
    assert first != second
    assert first.startswith("flowtest_gw3_")
    assert len(first) <= 63, "MongoDB erlaubt höchstens 63 Zeichen"


@pytest.mark.parametrize("name", ["tls_arena", "tls_abnahme", "flowtest", ""])
def test_other_database_names_are_never_touched(name):
    with pytest.raises(flow_mongo.FlowMongoRefused):
        flow_mongo.check_db_name(name)


def test_the_local_check_uses_the_image_of_the_compose_file():
    root = pathlib.Path(__file__).resolve().parents[2]
    image = re.search(r"^\s*image: (mongo:\S+)$", (root / "docker-compose.yml").read_text(encoding="utf-8"), re.M).group(1)
    assert f'FLOW_MONGO_IMAGE = "{image}"' in (root / "scripts" / "local_check.py").read_text(encoding="utf-8")
