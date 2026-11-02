"""Ablauf-Tests wahlweise gegen ein echtes MongoDB (#2200): die Sicherung und der Umgang mit der Testdatenbank.

Mongomock kennt weder Indizes noch echte Nebenläufigkeit. Mit ``FLOW_MONGO_URL`` läuft ``flow_harness.make_flow`` deshalb
gegen einen echten Server: ``database.init_indexes`` läuft wirklich, jeder Test beginnt leer, am Ende ist die Datenbank weg.
Ohne die Variable bleibt alles bei mongomock.

**Eine Datenbank je Prozess, nicht je Test.** Eine Datenbank je Test hieße: rund 180 Sammlungen, 650 Indizes, 800 Dateien - je
Test, und das Löschen wartet auf den nächsten Checkpoint. Gemessen stauten sich bei vier Prozessen 180 000 Dateien, ein
``dropDatabase`` dauerte eine Minute und 460 Tests über 20 Minuten. Deshalb hat jeder Prozess (``-n``) eine eigene Datenbank
mit eindeutigem Namen. Vor jedem Test wird sie geleert; wurden Indizes verändert, wird sie neu aufgebaut.

Die Sicherung gegen Fehlbedienung steht hier und nicht verstreut in den Tests:

* erlaubt ist genau ein Host, ``localhost`` oder ``127.0.0.1``, ohne Zugangsdaten und ohne ``replicaSet``. Der Client verbindet
  sich direkt (``directConnection``), er folgt also keinem Hinweis des Servers auf andere Rechner. Der Dienstname ``mongodb``
  aus ``docker-compose.yml`` ist absichtlich nicht dabei - so heißt auch die Datenbank der Produktion.
* Die Adresse liest der Parser von pymongo, nicht ein eigener Ausdruck: Was der Client am Ende benutzt, wird geprüft.
* Tests legen, leeren und löschen nur Datenbanken mit dem Präfix ``flowtest_``, jeder dieser Wege prüft das noch einmal.
* Bei einem Verstoß bricht der Lauf ab, bevor er die erste Verbindung aufbaut (``conftest.pytest_configure``).
"""
from __future__ import annotations

import asyncio
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

ENV_NAME = "FLOW_MONGO_URL"
DB_PREFIX = "flowtest_"
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1"})
PRODUCTION_VALUES = frozenset({"production", "prod"})
# Der Server antwortet lokal sofort; fehlt er, soll der Lauf nicht je Test 30 Sekunden warten.
SERVER_TIMEOUT_MS = 5000

# Die Datenbank dieses Prozesses und ihre Indizes nach init_indexes ({Sammlung: index_information}).
_process_db: str | None = None
_baseline: dict[str, dict] = {}
_admin_client = None


class FlowMongoRefused(RuntimeError):
    """Diese Adresse oder dieser Datenbankname ist für die Ablauf-Tests nicht erlaubt."""


def check_url(url: str) -> str:
    """Gibt die Adresse zurück, wenn sie für die Tests erlaubt ist - sonst ``FlowMongoRefused``."""
    from pymongo.errors import PyMongoError
    from pymongo.uri_parser import parse_uri

    # Vor dem Parser: mongodb+srv:// würde zum Auflösen schon ins Netz gehen - und zeigt immer auf einen entfernten Cluster.
    if not url.startswith("mongodb://"):
        raise FlowMongoRefused(f"{ENV_NAME}: nur einfache mongodb://-Adressen auf diesem Rechner sind erlaubt")
    try:
        parsed = parse_uri(url)
    except (PyMongoError, ValueError) as exc:
        raise FlowMongoRefused(f"{ENV_NAME}: die Adresse ist nicht lesbar ({type(exc).__name__})") from exc
    hosts = {str(host).lower() for host, _port in parsed["nodelist"]}
    if len(parsed["nodelist"]) != 1 or not hosts <= ALLOWED_HOSTS:
        raise FlowMongoRefused(f"{ENV_NAME}: genau ein Host, {' oder '.join(sorted(ALLOWED_HOSTS))}")
    if parsed.get("username") or parsed.get("password"):
        raise FlowMongoRefused(f"{ENV_NAME}: Zugangsdaten sind nicht erlaubt - ein Test-MongoDB braucht keine")
    if parsed["options"].get("replicaSet"):
        raise FlowMongoRefused(f"{ENV_NAME}: replicaSet ist nicht erlaubt")
    database = parsed.get("database")
    if database and not database.startswith(DB_PREFIX):
        raise FlowMongoRefused(f"{ENV_NAME}: eine Datenbank in der Adresse muss mit {DB_PREFIX} beginnen")
    return url


def check_environment(env=None) -> None:
    """Keine Ablauf-Tests gegen echtes MongoDB aus einer Umgebung, die sich als Produktion ausgibt."""
    env = os.environ if env is None else env
    if {str(env.get(key) or "").strip().lower() for key in ("APP_ENV", "ENV", "ENVIRONMENT")} & PRODUCTION_VALUES:
        raise FlowMongoRefused(f"{ENV_NAME}: diese Umgebung ist als Produktion gekennzeichnet")


def configured_url(env=None) -> str | None:
    """Die geprüfte Adresse aus der Umgebung, ``None`` für mongomock. Eine leere Variable zählt wie keine."""
    env = os.environ if env is None else env
    url = str(env.get(ENV_NAME) or "").strip()
    if not url:
        return None
    check_environment(env)
    return check_url(url)


def new_db_name(env=None) -> str:
    """Ein eindeutiger Name - parallel laufende Prozesse (``-n``) und spätere Läufe treffen sich nie."""
    env = os.environ if env is None else env
    worker = "".join(char for char in str(env.get("PYTEST_XDIST_WORKER") or "main") if char.isalnum())
    return check_db_name(f"{DB_PREFIX}{worker}_{uuid.uuid4().hex}")


def check_db_name(name: str) -> str:
    if not str(name).startswith(DB_PREFIX):
        raise FlowMongoRefused(f"Die Datenbank {name!r} trägt nicht das Testpräfix {DB_PREFIX}")
    return name


def new_client(url: str):
    """Ein Client wie in ``database.get_client`` - gleiche Rückgaben (Zeiten ohne Zeitzone), nur mit kurzer Wartezeit."""
    from motor.motor_asyncio import AsyncIOMotorClient

    return AsyncIOMotorClient(check_url(url), serverSelectionTimeoutMS=SERVER_TIMEOUT_MS, directConnection=True)


def _indexes(db) -> dict[str, dict]:
    """Je Sammlung die Indizes samt Optionen (eindeutig, Schlüssel, Teilfilter …), nicht nur ihre Namen."""
    return {name: db[name].index_information() for name in db.list_collection_names()}


def _build(database_module, url: str, name: str) -> None:
    """``init_indexes`` wie beim Start der Anwendung - über Motor, mit eigener Schleife in eigenem Thread: ``make_flow`` ist
    synchron und läuft oft schon in der Schleife des Tests. Der aufrufende Thread wartet, solange ``database._db`` geliehen ist."""
    async def run() -> None:
        client = new_client(url)
        previous = database_module._db
        database_module._db = client[check_db_name(name)]
        try:
            await database_module.init_indexes()
        finally:
            database_module._db = previous
            client.close()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="flow-mongo-indexes") as pool:
        pool.submit(lambda: asyncio.run(run())).result()


def _wipe(db, baseline: dict[str, dict]) -> bool:
    """Alle Dokumente weg, Sammlungen und Indizes wie nach ``init_indexes``. ``False``: Die Indizes passen nicht mehr."""
    check_db_name(db.name)
    current = _indexes(db)
    if any(current.get(name) != indexes for name, indexes in baseline.items()):
        return False
    for name in set(current) - set(baseline):
        db.drop_collection(name)
    for name in baseline:
        if db[name].estimated_document_count():
            db[name].delete_many({})
    return True


def prepare_database(database_module, url: str) -> str:
    """Die Datenbank dieses Prozesses bereitstellen und leeren - gibt ihren Namen zurück. Beim ersten Aufruf und wenn ein Test
    Indizes verändert hat, läuft ``init_indexes`` auf einer neuen Datenbank.

    Geleert wird über einen einzigen synchronen Client, der bleibt: Ein neuer Client je Test öffnet für die vielen Sammlungen
    jedes Mal neue Verbindungen, und unter Windows gehen dabei die freien Ports aus (WinError 10048)."""
    global _process_db, _baseline, _admin_client
    from pymongo import MongoClient

    if _admin_client is None:
        _admin_client = MongoClient(check_url(url), serverSelectionTimeoutMS=SERVER_TIMEOUT_MS, directConnection=True, maxPoolSize=2)
    if _process_db and _wipe(_admin_client[_process_db], _baseline):
        return check_db_name(_process_db)
    if _process_db:
        _admin_client.drop_database(check_db_name(_process_db))
    _process_db = new_db_name()
    _build(database_module, url, _process_db)
    _baseline = _indexes(_admin_client[_process_db])
    return _process_db


def drop_process_database() -> None:
    """Aufräumen am Ende des Prozesses (``conftest.pytest_sessionfinish``)."""
    global _process_db, _admin_client
    if _admin_client is None:
        return
    try:
        if _process_db:
            _admin_client.drop_database(check_db_name(_process_db))
    finally:
        _admin_client.close()
        _admin_client = None
        _process_db = None
