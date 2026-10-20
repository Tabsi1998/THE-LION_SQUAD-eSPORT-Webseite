#!/usr/bin/env python3
"""Lasttest für den Event-Abend (#1683): Zuschauer, TVs, Helfer und Vor-Ort-Anmeldungen zugleich.

Nur gegen einen lokalen Abnahme-Stand (docs/entwicklung/abnahme-lokal.md), nie gegen Produktion: Das Skript prüft vor
der ersten Anfrage, dass die Adresse auf diesem Rechner liegt, zum Docker-Projekt gehört und dessen Backend die
Abnahme-Datenbank (`tls_abnahme*`) nutzt - dieselbe Prüfung wie `seed_abnahme.py`. Den gemeinsamen Stand
`lsw-abnahme` fasst es nicht an (es trägt Ergebnisse ein und verändert so die Testdaten).

Simuliert wird ein Abend mit den Daten aus dem Seed (Stand-Datei `ABNAHME_STATE`), über die echten Routen und so, wie
die Seiten im Browser abfragen (mit Playwright mitgeschnitten):

  * Zuschauer und Spieler: Turnierseite, Baum, Spielplan, Fast Lap - jeder mit dem Änderungsstrom
    (`/api/changes/stream`) und Nachladen bei jeder passenden Änderung seines Turniers (#1801), wie `useLiveRefresh`
    (150 ms entprellt).
    Ein Teil ist als Spieler angemeldet: dazu „Du bist als Nächstes“ (`live-queue/me`) im 60-s-Takt.
  * TVs mit Anzeige-Schlüssel: Baum (`bracket/display?key=`), Stationen und Live-Warteschlange (`live-queue?key=`).
  * Helfer (Turnierleitung): Live-Warteschlange lesen, aufrufen, starten, Ergebnis eintragen - je Helfer ein Turnier.
  * Fast-Lap-Schnelleingabe: Zeit eintragen, nächster Fahrer.
  * Vor-Ort-Anmeldungen: QR-Code einlösen, Turnier ansehen, anmelden, später wieder abmelden.

Die Zugänge bleiben in der Stand-Datei; Bericht und Ausgabe nennen weder Passwörter noch Schlüssel oder Codes.

    python scripts/seed_abnahme.py
    python scripts/lasttest_abnahme.py --minutes 5 --viewers 150

Bericht als Markdown und JSON (Vorgabe `.local-testing/abnahme/lasttest-<Projekt>-<Zeit>/`): je Gruppe von
Endpunkten Anfragen, Fehlerquote, p50/p95/p99, Grenzwerte grün/rot, die langsamsten Anfragen und `docker stats` von
Backend, Datenbank und Frontend. Exit 0 grün, 1 rot, 2 abgebrochen (kein lokaler Abnahme-Stand, Setup gescheitert).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import random
import re
import struct
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_abnahme as seed  # noqa: E402  (Guard des Seeds: Datenbankname, Mongo, Adressen)

SHARED_PROJECT = "lsw-abnahme"
DEFAULT_PROJECT = "lsw-abnahme-nacht"
P95_LIMIT_MS = 800
ERROR_LIMIT = 0.005

# Was jede Seite beim ersten Laden holt (Layout, Kopf, Fuß) - angemeldet kommen ein paar eigene Abfragen dazu.
SHELL = ["/api/settings/public", "/api/nav", "/api/sponsors?placement=footer", "/api/partners",
         "/api/settings/site-banners", "/api/home/discord", "/api/seasonal/active", "/api/auth/me"]
SHELL_SIGNED_IN = ["/api/chats/unread", "/api/admin/notifications", "/api/users/me/level", "/api/achievements/me"]
# Wie im Web (lib/apiInvalidation.js): eine Änderung an Spielen betrifft auch die Turniere.
RESOURCE_ALIASES = {"matches": {"tournaments"}, "matches-v2": {"tournaments", "matches"}, "f1": {"fastlap", "prizes"}}
# Worauf die Seiten hören (useLiveRefresh in TournamentDetailPage, TournamentBracketPage, TournamentSchedulePage,
# F1DetailPage, BracketTVPage, TournamentLeadPage).
WATCH = {
    "turnier": {"tournaments"},
    "baum": {"tournaments", "matches"},
    "spielplan": {"tournaments", "matches", "matches-v2", "stations"},
    "fastlap": {"f1"},
    "tv": {"tournaments", "matches", "stations", "tv"},
    "helfer": {"tournaments", "matches-v2", "stations"},
}
# Die Turniere des Abends aus dem Seed, an denen Helfer arbeiten und die Zuschauer ansehen (Gewicht).
EVENT_TOURNAMENTS = (("local_live", 50), ("mode_fixed", 20), ("mode_instant", 15), ("mode_draw_show", 15))
VIEWER_PAGES = (("turnier", 35), ("baum", 25), ("spielplan", 25), ("fastlap", 15))
# Schreibende Anfragen, die zwei Helfer gleichzeitig treffen können: 409 heißt „schon erledigt“ - abgelehnt, kein Fehler.
WRITE_TOLERATED = (409,)
# … außer die Turnier-Sperre war besetzt (services/mutation_lock.py wartet 2 s): das sieht die Person als Fehler.
LOCK_BUSY = "bereits verarbeitet"


# ------------------------------------------------------------------------------------------------------------ Guard

def published_ports(ports: dict | None) -> set[int]:
    """Host-Ports aus `docker inspect … .NetworkSettings.Ports` ({"80/tcp": [{"HostPort": "24800"}]})."""
    found = set()
    for bindings in (ports or {}).values():
        for binding in bindings or []:
            port = str((binding or {}).get("HostPort") or "")
            if port.isdigit():
                found.add(int(port))
    return found


def base_url_problems(base_url: str) -> list[str]:
    """Nur scheme://host:port[/pfad] - keine Zugangsdaten, keine Abfrage, kein Fragment. Die Meldungen nennen die
    Adresse nie im Wortlaut (sie könnte Zugangsdaten enthalten)."""
    parts = urlsplit(base_url)
    problems = []
    if parts.scheme not in {"http", "https"}:
        problems.append("Adresse braucht http:// oder https://")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        problems.append("Adresse enthält Zugangsdaten (user@) - nur scheme://host:port[/pfad]")
    if parts.query or parts.fragment or base_url.rstrip().endswith(("?", "#")):
        problems.append("Adresse enthält Abfrage oder Fragment (? oder #) - nur scheme://host:port[/pfad]")
    try:
        parts.port
    except ValueError:
        problems.append("Adresse hat keinen gültigen Port")
    return problems


def clean_base_url(base_url: str) -> str:
    """Die Adresse, wie sie in Ausgabe und Bericht steht: scheme://host[:port][/pfad], ohne alles andere."""
    parts = urlsplit(base_url.strip())
    host = f"[{parts.hostname}]" if parts.hostname and ":" in parts.hostname else (parts.hostname or "")
    try:
        port = f":{parts.port}" if parts.port else ""
    except ValueError:
        port = ""
    return f"{parts.scheme}://{host}{port}{parts.path}".rstrip("/")


def target_problems(base_url: str, project: str, backend_env: dict | None, ports: set[int]) -> list[str]:
    """Was dagegen spricht, diesen Stand unter Last zu setzen - leer heißt: ein eigener, lokaler Abnahme-Stand."""
    problems = base_url_problems(base_url)
    parts = urlsplit(base_url)
    if parts.hostname not in seed.LOCAL_HOSTS:
        problems.append(f"Adresse {parts.hostname or '(ohne Host)'!r} liegt nicht auf diesem Rechner")
    if project == SHARED_PROJECT:
        problems.append(f"{SHARED_PROJECT} ist der gemeinsame Stand - der Lasttest trägt Ergebnisse ein, bitte einen "
                        "eigenen Stand (ABNAHME_PROJECT) nehmen")
    if backend_env is None:
        problems.append(f"Container {project}-backend läuft nicht")
    else:
        problems.extend(seed.abnahme_target_problems(backend_env))
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        port = None
    if port is not None and port not in ports:
        problems.append(f"Port {port} gehört nicht zum Stand {project} (veröffentlicht: {sorted(ports) or 'keine'})")
    return problems


def _inspect(container: str, template: str):
    completed = subprocess.run(["docker", "inspect", container, "--format", template], capture_output=True,
                               text=True, encoding="utf-8")
    if completed.returncode != 0:
        return None
    return json.loads(completed.stdout or "null")


def ensure_target(base_url: str, project: str) -> None:
    """Hart abbrechen, bevor eine Anfrage hinausgeht, wenn das kein eigener, lokaler Abnahme-Stand ist."""
    env_rows = _inspect(f"{project}-backend", "{{json .Config.Env}}")
    backend_env = dict(row.split("=", 1) for row in env_rows if "=" in row) if env_rows is not None else None
    ports: set[int] = set()
    for service in ("frontend", "backend"):
        ports |= published_ports(_inspect(f"{project}-{service}", "{{json .NetworkSettings.Ports}}"))
    problems = target_problems(base_url, project, backend_env, ports)
    if problems:
        raise SystemExit("Lasttest abgebrochen, das ist kein eigener lokaler Abnahme-Stand: " + "; ".join(problems))


# ----------------------------------------------------------------------------------------------------- Werkzeuge

def totp(secret: str, at: float | None = None, digits: int = 6, step: int = 30) -> str:
    """Zwei-Faktor-Code nach RFC 6238 (SHA-1) - nur für die Testkonten aus der Stand-Datei."""
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    counter = int((time.time() if at is None else at) // step)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(value).zfill(digits)


SECRET_PARAMS = {"key", "token", "access", "code", "ticket"}


def safe_path(url: str) -> str:
    """Pfad für Bericht und Ausgabe: Schlüssel, Codes und Freigaben in der Abfrage werden zu ***."""
    parts = urlsplit(url)
    query = [(name, "***" if name.lower() in SECRET_PARAMS else value) for name, value in parse_qsl(parts.query)]
    return parts.path + (f"?{urlencode(query, safe='*')}" if query else "")


def event_keys(event: dict) -> set[str]:
    resource = str(event.get("resource") or event.get("entity_type") or "")
    return ({resource} | RESOURCE_ALIASES.get(resource, set())) - {""}


def concerns_page(event: dict, tournament_id: str | None, event_id: str | None, shared_stations: bool) -> bool:
    """Betrifft die Meldung das Turnier der Seite (#1801, wie lib/apiInvalidation.js)? Ohne Turnier in der Meldung oder
    an der Seite: ja. Seiten mit Stationen auch bei jedem anderen Turnier desselben Events (sie teilen sich Stationen) -
    kennt die Seite ihr Event nicht, bei jedem Turnier mit Event."""
    changed = event.get("tournament_id")
    if not changed or not tournament_id or changed == tournament_id:
        return True
    if not shared_stations:
        return False
    changed_event = event.get("parent_event_id")
    return bool(changed_event) and (not event_id or changed_event == event_id)


def wants_reload(kind: str, event: dict, watched: set[str], tournament_id: str | None = None,
                 event_id: str | None = None, *, every_tournament: bool = False) -> bool:
    """Lädt eine Seite mit diesen Ressourcen (und diesem Turnier) bei dieser Meldung neu? Ein Reset des Stroms lädt
    alles. ``every_tournament``: wie das Web vor #1801 - jede passende Meldung, egal welches Turnier."""
    if kind == "reset":
        return True
    if kind != "change" or not event_keys(event) & watched:
        return False
    return every_tournament or concerns_page(event, tournament_id, event_id, "stations" in watched)


def next_action(view: dict, turn: int = 0) -> tuple[str, str, str] | None:
    """Was ein Helfer an der Live-Warteschlange als Nächstes tut: (Art, Station, Spiel) oder nichts.

    Läuft ein Spiel, kommt das Ergebnis; ist eins aufgerufen, wird es gestartet; ist die Station frei und das nächste
    Spiel bereit, wird es aufgerufen. `turn` dreht die Reihenfolge der Stationen weiter, damit nicht immer Station 1
    zuerst drankommt."""
    stations = [row for row in (view or {}).get("stations") or [] if row.get("status") != "broken"]
    if not stations:
        return None
    start = turn % len(stations)
    for station in stations[start:] + stations[:start]:
        running, upcoming = station.get("running"), station.get("next")
        if running:
            return "result", station["id"], running["match_id"]
        if upcoming and upcoming.get("state") == "called":
            return "start", station["id"], upcoming["match_id"]
        if upcoming and upcoming.get("state") == "queued" and upcoming.get("ready"):
            return "call", station["id"], upcoming["match_id"]
    return None


def ranking_body(match: dict) -> dict | None:
    """Ergebnis wie die Schnellwertung: Reihenfolge der Plätze im Spiel, Punkte absteigend."""
    regs = [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]
    if len(regs) < 2:
        return None
    return {"results": [{"registration_id": reg, "rank": index + 1, "score": max(0, 15 - 3 * index)}
                        for index, reg in enumerate(regs)]}


# --------------------------------------------------------------------------------------------------- Auswertung

@dataclass
class Sample:
    group: str
    method: str
    path: str
    status: int | None
    ms: float
    outcome: str  # ok | rejected | error
    detail: str = ""
    at: float = 0.0


def classify(status: int | None, expect: tuple[int, ...], tolerated: tuple[int, ...] = (), detail: str = "") -> str:
    """ok, abgelehnt (409 „schon erledigt“) oder Fehler. Eine besetzte Turnier-Sperre ist ein Fehler: die Person sieht
    „Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.“"""
    if status is not None and status in expect:
        return "ok"
    if status is not None and status in tolerated and LOCK_BUSY not in (detail or ""):
        return "rejected"
    return "error"


def percentile(values: list[float], pct: float) -> float:
    """Nächster Rang: der kleinste Wert, unter oder auf dem `pct` Prozent der Werte liegen."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(pct / 100 * len(ordered)) - 1)]


def _stats(rows: list[Sample], p95_limit: float, error_limit: float) -> dict:
    times = [row.ms for row in rows if row.outcome != "error" or row.status is not None]
    errors = sum(row.outcome == "error" for row in rows)
    rate = errors / len(rows) if rows else 0.0
    p95 = round(percentile(times, 95), 1)
    return {
        "requests": len(rows), "errors": errors, "rejected": sum(row.outcome == "rejected" for row in rows),
        "error_rate": round(rate, 5), "p50_ms": round(percentile(times, 50), 1), "p95_ms": p95,
        "p99_ms": round(percentile(times, 99), 1), "max_ms": round(max(times, default=0.0), 1),
        "p95_ok": p95 < p95_limit, "errors_ok": rate < error_limit,
    }


def summarize(samples: list[Sample], p95_limit: float = P95_LIMIT_MS, error_limit: float = ERROR_LIMIT,
              slowest: int = 10) -> dict:
    """Je Gruppe und gesamt: Anfragen, Fehler, Quote, p50/p95/p99, max - und ob die Grenzwerte halten."""
    groups: dict[str, list[Sample]] = {}
    for row in samples:
        groups.setdefault(row.group, []).append(row)
    table = {name: _stats(rows, p95_limit, error_limit) for name, rows in sorted(groups.items())}
    for stats in table.values():
        stats["ok"] = stats["p95_ok"] and stats["errors_ok"]
    overall = _stats(samples, p95_limit, error_limit)
    overall["ok"] = overall["p95_ok"] and overall["errors_ok"]
    examples: dict[str, dict] = {}
    for row in samples:
        if row.outcome == "error":
            label = f"{row.group}: {row.method} {row.status or row.detail}"
            examples.setdefault(label, {"label": label, "path": row.path, "detail": row.detail, "count": 0})["count"] += 1
    return {
        "limits": {"p95_ms": p95_limit, "error_rate": error_limit},
        "green": bool(samples) and all(stats["ok"] for stats in table.values()),
        "overall": overall,
        "groups": table,
        "slowest": [asdict(row) for row in sorted(samples, key=lambda row: row.ms, reverse=True)[:slowest]],
        "error_examples": sorted(examples.values(), key=lambda row: -row["count"])[:10],
    }


SIZE_UNITS = {"b": 1 / 2**20, "kib": 1 / 1024, "kb": 1 / 1024, "mib": 1.0, "mb": 1.0, "gib": 1024.0, "gb": 1024.0}


def parse_size_mib(text: str) -> float:
    match = re.match(r"\s*([\d.]+)\s*([A-Za-z]+)", text or "")
    if not match:
        return 0.0
    return float(match.group(1)) * SIZE_UNITS.get(match.group(2).lower(), 0.0)


def parse_stats_line(line: str) -> dict | None:
    """Eine Zeile `docker stats --no-stream --format '{{json .}}'` → Name, CPU in %, RAM in MiB."""
    try:
        row = json.loads(line)
    except json.JSONDecodeError:
        return None
    return {"name": row.get("Name") or row.get("Container") or "?",
            "cpu": float(str(row.get("CPUPerc") or "0").rstrip("%") or 0),
            "mem_mib": parse_size_mib(str(row.get("MemUsage") or "").split("/")[0])}


def summarize_stats(snapshots: list[dict]) -> dict:
    by_name: dict[str, list[dict]] = {}
    for row in snapshots:
        by_name.setdefault(row["name"], []).append(row)
    return {name: {"samples": len(rows), "cpu_avg": round(sum(r["cpu"] for r in rows) / len(rows), 1),
                   "cpu_max": round(max(r["cpu"] for r in rows), 1),
                   "mem_max_mib": round(max(r["mem_mib"] for r in rows), 1)}
            for name, rows in sorted(by_name.items())}


def _de(value: float, digits: int = 0) -> str:
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _pct(rate: float) -> str:
    return f"{_de(rate * 100, 2)} %"


def render_markdown(report: dict) -> str:
    """Der Bericht für Menschen: ein Satz vorweg, dann Tabellen."""
    summary, cfg, run = report["summary"], report["config"], report["run"]
    overall = summary["overall"]
    verdict = "grün" if summary["green"] else "rot"
    who = (f"{cfg['viewers']} Zuschauer (davon {run['signed_in_viewers']} angemeldet), {cfg['tvs']} TVs, "
           f"{cfg['helpers']} Helfer, Fast Lap, {run['onsite_signups']} Vor-Ort-Anmeldungen")
    lines = [
        f"# Lasttest Event-Abend (#1683) – {report['started_at'][:16].replace('T', ' ')} UTC",
        "",
        f"**Ergebnis: {verdict}.** {who} über {_de(cfg['minutes'], 1)} Minuten: {_de(overall['requests'])} Anfragen, "
        f"p95 {_de(overall['p95_ms'])} ms, p99 {_de(overall['p99_ms'])} ms, Fehlerquote {_pct(overall['error_rate'])}.",
        "",
        f"Grenzwerte je Gruppe: p95 < {_de(summary['limits']['p95_ms'])} ms und Fehler < "
        f"{_pct(summary['limits']['error_rate'])}. Stand `{cfg['project']}`, {cfg['base_url']}.",
        "",
        "| Gruppe | Anfragen | Fehler | Quote | abgelehnt | p50 ms | p95 ms | p99 ms | max ms | Grenzwert |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for name, stats in summary["groups"].items():
        flag = "grün" if stats["ok"] else "rot" + ("" if stats["p95_ok"] else " (p95)")
        flag += "" if stats["errors_ok"] else " (Fehler)"
        lines.append(f"| {name} | {_de(stats['requests'])} | {stats['errors']} | {_pct(stats['error_rate'])} | "
                     f"{stats['rejected']} | {_de(stats['p50_ms'])} | {_de(stats['p95_ms'])} | {_de(stats['p99_ms'])} | "
                     f"{_de(stats['max_ms'])} | {flag} |")
    lines += ["", "## Langsamste Anfragen", "", "| ms | Gruppe | Anfrage | Status |", "| ---: | --- | --- | --- |"]
    for row in summary["slowest"]:
        lines.append(f"| {_de(row['ms'])} | {row['group']} | {row['method']} {row['path']} | {row['status'] or row['detail']} |")
    if summary["error_examples"]:
        lines += ["", "## Fehler", "", "| Anzahl | Was | Beispiel | Meldung |", "| ---: | --- | --- | --- |"]
        for row in summary["error_examples"]:
            lines.append(f"| {row['count']} | {row['label']} | {row['path']} | {row['detail'] or '-'} |")
    lines += ["", "## Server (docker stats)", ""]
    if report["server"]:
        lines += ["| Container | Messungen | CPU Ø | CPU max | RAM max |", "| --- | ---: | ---: | ---: | ---: |"]
        for name, stats in report["server"].items():
            lines.append(f"| {name} | {stats['samples']} | {_de(stats['cpu_avg'], 1)} % | {_de(stats['cpu_max'], 1)} % | "
                         f"{_de(stats['mem_max_mib'])} MiB |")
        lines.append("")
        lines.append("CPU in Prozent eines Kerns (100 % = ein Kern voll); das Backend läuft mit einem uvicorn-Worker.")
    else:
        lines.append("Keine Messung (docker stats nicht erreichbar).")
    lag = run["loop_lag_ms"]
    lines += [
        "", "## Ablauf", "",
        f"- Meldungen aus dem Änderungsstrom: {_de(run['events'])}, daraus Nachladen: {_de(run['reloads'])}, "
        f"Resets des Stroms: {run['resets']}, abgebrochene Ströme: {run['stream_drops']}; Nachladen "
        + ("überlappend (Web vor #1683)" if cfg.get("overlapping_reloads") else "nie doppelt je Seite (Web ab #1683)")
        + ", " + ("bei jeder Änderung jedes Turniers (Web vor #1801)" if cfg.get("reload_every_tournament")
                  else "nur bei Änderungen des eigenen Turniers (Web ab #1801)"),
        f"- Helfer: {run['actions'].get('call', 0)} aufgerufen, {run['actions'].get('start', 0)} gestartet, "
        f"{run['actions'].get('result', 0)} Ergebnisse; Fast Lap: {run['actions'].get('lap', 0)} Zeiten; "
        f"Vor Ort: {run['onsite_signups']} angemeldet, {run['actions'].get('onsite_off', 0)} wieder abgemeldet",
        f"- Messgenauigkeit: Verzögerung der Lastschleife p95 {_de(lag['p95'])} ms, max {_de(lag['max'])} ms "
        "(liegt sie hoch, sind die Zeiten oben etwas zu groß gemessen)",
    ]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------------------------------------------- Ablauf

@dataclass
class Config:
    base_url: str
    project: str
    state: Path
    out: Path
    minutes: float = 5.0
    viewers: int = 150
    signed_in: float = 0.3
    tvs: int = 3
    helpers: int = 4
    helper_pause: float = 20.0
    fastlap_pause: float = 30.0
    onsite: int = 20
    ramp: float = 60.0
    stats_every: float = 10.0
    p95_ms: float = P95_LIMIT_MS
    error_rate: float = ERROR_LIMIT
    seed: int = 1683
    overlapping_reloads: bool = False
    reload_every_tournament: bool = False


class SetupError(RuntimeError):
    pass


@dataclass
class Counters:
    events: int = 0
    reloads: int = 0
    resets: int = 0
    stream_drops: int = 0
    onsite_signups: int = 0
    signed_in_viewers: int = 0
    actions: dict = field(default_factory=dict)

    def act(self, kind: str) -> None:
        self.actions[kind] = self.actions.get(kind, 0) + 1


class LoadTest:
    def __init__(self, cfg: Config, state: dict):
        import httpx

        self.httpx = httpx
        self.cfg = cfg
        self.state = state
        self.rng = random.Random(cfg.seed)
        self.samples: list[Sample] = []
        self.counters = Counters()
        self.stats: list[dict] = []
        self.lag: list[float] = []
        self.tasks: set[asyncio.Task] = set()
        self.clients: list = []
        self.deadline = 0.0
        self.t0 = 0.0
        self.sessions: dict[str, object] = {}  # Konto → Cookies
        self.player_ids: dict[str, str] = {}  # Benutzer-ID → Konto
        self.tournaments: dict[str, dict] = {}
        self.tv_keys: list[dict] = []
        self.onsite_token = ""
        self.onsite_pool: asyncio.Queue | None = None
        self.track_id = ""

    # -- Grundlagen
    def client(self, cookies=None):
        httpx = self.httpx
        # Wie ein Browser: höchstens sechs Verbindungen je Seite, eine davon hält der Strom. trust_env=False: kein
        # Proxy aus der Umgebung (HTTP_PROXY, ALL_PROXY …) - die Anfragen gehen nur an die geprüfte lokale Adresse.
        client = httpx.AsyncClient(base_url=self.cfg.base_url, timeout=httpx.Timeout(30.0),
                                   limits=httpx.Limits(max_connections=6, max_keepalive_connections=6),
                                   cookies=httpx.Cookies(cookies) if cookies is not None else None, trust_env=False)
        self.clients.append(client)
        return client

    def running(self) -> bool:
        return time.perf_counter() < self.deadline

    async def pause(self, seconds: float) -> bool:
        left = self.deadline - time.perf_counter()
        if left <= 0:
            return False
        await asyncio.sleep(min(seconds, left))
        return self.running()

    def spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def call(self, client, group: str, method: str, url: str, *, expect=(200,), tolerated=(), **kwargs):
        """Eine gemessene Anfrage. Gibt die Antwort zurück (oder None bei Netzfehler)."""
        if client.is_closed:
            return None  # die Seite ist schon weg, ein verspätetes Nachladen fällt aus
        headers = dict(kwargs.pop("headers", None) or {})
        token = client.cookies.get("csrf_token")
        if token and method != "GET":
            headers["x-csrf-token"] = token
        started = time.perf_counter()
        response, status, detail = None, None, ""
        try:
            response = await client.request(method, url, headers=headers, **kwargs)
            status = response.status_code
        except self.httpx.HTTPError as error:
            if client.is_closed:
                return None  # Seite verlassen: der Browser bricht die Anfrage ab, das ist kein Fehler des Servers
            detail = type(error).__name__
        ms = (time.perf_counter() - started) * 1000
        if response is not None and status not in expect:
            detail = _detail(response)
        outcome = classify(status, tuple(expect), tuple(tolerated), detail)
        if self.t0 and started - self.t0 >= 0:
            self.samples.append(Sample(group, method, safe_path(url), status, round(ms, 1), outcome, detail,
                                       round(started - self.t0, 2)))
        return response

    # -- Vorbereitung (nicht gemessen)
    async def login(self, account_key: str):
        account = self.state["accounts"][account_key]
        client = self.client()
        credentials = {"email": account["email"], "password": account["password"], "remember": True}
        for _ in range(3):
            response = await client.post("/api/auth/login", json=credentials)
            if response.status_code != 200:
                raise SetupError(f"Anmeldung {account_key}: HTTP {response.status_code}")
            body = response.json()
            if not body.get("mfa_required"):
                break
            if not account.get("totp"):
                raise SetupError(f"Anmeldung {account_key} verlangt Zwei-Faktor, die Stand-Datei hat kein Geheimnis")
            done = await client.post("/api/auth/mfa/complete", json={"ticket": body["mfa_ticket"], "code": totp(account["totp"])})
            if done.status_code == 200:
                break
            # Jeder Code gilt einmal (Seed oder Browser-Test im selben Fenster): auf das nächste 30-s-Fenster warten.
            await asyncio.sleep(31 - time.time() % 30)
        else:
            raise SetupError(f"Zwei-Faktor {account_key} gescheitert")
        me = await client.get("/api/auth/me")
        if me.status_code != 200:
            raise SetupError(f"Sitzung {account_key}: HTTP {me.status_code}")
        self.sessions[account_key] = client.cookies
        return client, me.json()

    async def setup(self) -> None:
        state = self.state
        missing = [key for key, _ in EVENT_TOURNAMENTS if key not in state.get("tournaments", {})]
        if missing or "onsite_members" not in state.get("tournaments", {}) or not state.get("fastlap"):
            raise SetupError("Stand-Datei unvollständig - erst `python scripts/seed_abnahme.py` (gleiche ABNAHME_STATE)")
        admin, _ = await self.login("admin")
        self.admin = admin
        await self.login("lead")
        # Spieler-Konten: 16 aus dem Seed (gleiches Muster wie Spieler 1) und der Gast - einmal anmelden, die Sitzung
        # teilen sich die angemeldeten Zuschauer (so bleibt der Lasttest unter der Sperre gegen Rateversuche).
        template = state["accounts"]["player"]
        for index in range(1, 17):
            key = f"spieler{index:02d}"
            state["accounts"].setdefault(key, {**template, "email": template["email"].replace("01@", f"{index:02d}@")})
            _, me = await self.login(key)
            self.player_ids[me["id"]] = key
        _, guest = await self.login("guest")
        self.player_ids[guest["id"]] = "guest"
        for key, _ in EVENT_TOURNAMENTS:
            tid = state["tournaments"][key]
            response = await admin.get(f"/api/tournaments/{tid}?include_draft=true")
            if response.status_code != 200:
                raise SetupError(f"Turnier {key} fehlt im Stand (HTTP {response.status_code}) - Stand-Datei passt nicht")
            body = response.json()
            # Das Event braucht der Spielplan (geteilte Stationen, #1801).
            self.tournaments[key] = {"id": tid, "slug": body.get("slug") or tid, "event_id": body.get("event_id")}
        csrf ={"x-csrf-token": admin.cookies.get("csrf_token") or ""}
        for index in range(self.cfg.tvs):
            key = EVENT_TOURNAMENTS[index % 2][0]
            response = await admin.post("/api/tv/keys", json={"tournament_id": self.tournaments[key]["id"],
                                                              "label": f"Lasttest TV {index + 1}"}, headers=csrf)
            if response.status_code != 200:
                raise SetupError(f"TV-Schlüssel: HTTP {response.status_code}")
            body = response.json()
            self.tv_keys.append({"id": body.get("id"), "token": body["token"], "tournament": key})
        onsite_tid = state["tournaments"]["onsite_members"]
        access = await admin.get(f"/api/tournaments/{onsite_tid}/onsite-access")
        path = access.json().get("path") if access.status_code == 200 else None
        if not path or "#" not in path:
            raise SetupError(f"Vor-Ort-Code: HTTP {access.status_code}")
        self.onsite_token = path.split("#", 1)[1]
        onsite = await admin.get(f"/api/tournaments/{onsite_tid}?include_draft=true")
        self.tournaments["onsite_members"] = {"id": onsite_tid, "slug": onsite.json().get("slug") or onsite_tid}
        taken = {row.get("user_id") for row in (await admin.get(f"/api/tournaments/{onsite_tid}/registrations")).json()}
        self.onsite_pool = asyncio.Queue()
        for user_id, key in self.player_ids.items():
            if user_id not in taken:
                self.onsite_pool.put_nowait((user_id, key))
        challenge = await admin.get(f"/api/f1/challenges/{state['fastlap']}")
        tracks = challenge.json().get("tracks") if challenge.status_code == 200 else None
        if not tracks:
            raise SetupError("Fast Lap ohne Strecke im Stand")
        self.track_id = tracks[0]["id"]

    async def cleanup(self) -> None:
        csrf = {"x-csrf-token": self.admin.cookies.get("csrf_token") or ""}
        for key in self.tv_keys:
            if key.get("id"):
                await self.admin.delete(f"/api/tv/keys/{key['id']}", headers=csrf)

    # -- Strom und Seiten
    async def stream(self, client, watched: Callable[[], set[str]], reload, overlap: bool = False,
                     scope: Callable[[], tuple[str | None, str | None]] = lambda: (None, None)) -> None:
        """Der Änderungsstrom einer Seite: Verbindungszeit messen, bei passender Meldung entprellt nachladen.

        `watched` sagt beim Eintreffen einer Meldung, worauf die Seite gerade hört (sie kann inzwischen gewechselt haben),
        `scope` ihr Turnier und Event (#1801): nachgeladen wird nur bei Änderungen dieses Turniers - mit
        `--reload-every-tournament` wie das Web vor #1801 bei jeder.
        Wie `useLiveRefresh`: 150 ms entprellt, nach dem Verbinden einmal nachladen, und nie zwei Nachladen derselben
        Seite zugleich - kommt währenddessen eine Meldung, folgt genau eines danach. Mit `--overlapping-reloads` wie
        das Web vor #1683: jede Meldung startet ein eigenes Nachladen, auch wenn das vorige noch läuft. Der TV-Baum
        überlappt immer (`overlap`, er ordnet die Antworten selbst)."""
        pending: list[asyncio.Task] = []
        flight = {"running": False, "again": False}

        async def single_flight():
            if flight["running"]:
                flight["again"] = True
                return
            flight["running"] = True
            try:
                while True:
                    flight["again"] = False
                    self.counters.reloads += 1
                    await reload()
                    if not flight["again"]:
                        break
            finally:
                flight["running"] = False

        async def later():
            await asyncio.sleep(0.15 + self.rng.uniform(0, 0.25))
            if overlap or self.cfg.overlapping_reloads:
                self.counters.reloads += 1
                self.spawn(reload())
            else:
                self.spawn(single_flight())

        def schedule():
            if pending and not pending[-1].done():
                pending[-1].cancel()
            pending.append(self.spawn(later()))
            del pending[:-1]

        while self.running():
            started = time.perf_counter()
            connected = False
            try:
                async with client.stream("GET", "/api/changes/stream", headers={"accept": "text/event-stream"},
                                         timeout=self.httpx.Timeout(30.0, read=45.0)) as response:
                    if response.status_code != 200:
                        self._sample("Ereignisstrom", "GET", "/api/changes/stream", response.status_code, started, "error")
                        await self.pause(5)
                        continue
                    name, data = None, None
                    async for line in response.aiter_lines():
                        if line.startswith("event:"):
                            name = line[6:].strip()
                        elif line.startswith("data:"):
                            data = line[5:].strip()
                        elif not line:
                            if name == "connected" and not connected:
                                connected = True
                                self._sample("Ereignisstrom", "GET", "/api/changes/stream", 200, started, "ok")
                                schedule()
                            elif name in {"change", "reset"}:
                                self.counters.events += 1
                                self.counters.resets += name == "reset"
                                event = json.loads(data or "{}")
                                if wants_reload(name, event, watched(), *scope(),
                                                every_tournament=self.cfg.reload_every_tournament):
                                    schedule()
                            name, data = None, None
            except asyncio.CancelledError:
                raise
            except self.httpx.HTTPError as error:
                if not self.running():
                    return
                self.counters.stream_drops += 1
                if not connected:
                    self._sample("Ereignisstrom", "GET", "/api/changes/stream", None, started, "error", type(error).__name__)
                await self.pause(3)

    def _sample(self, group, method, path, status, started, outcome, detail=""):
        self.samples.append(Sample(group, method, path, status, round((time.perf_counter() - started) * 1000, 1),
                                   outcome, detail, round(started - self.t0, 2)))

    async def load(self, client, requests: list[tuple[str, str]]) -> None:
        await asyncio.gather(*(self.call(client, group, "GET", url) for group, url in requests))

    def page_requests(self, page: str, tournament: dict, signed_in: bool, first: bool) -> list[tuple[str, str]]:
        tid, slug = tournament["id"], tournament["slug"]
        if page == "turnier":
            rows = [("Turnierseite", f"/api/tournaments/{slug}"), ("Turnierseite", f"/api/tournaments/{tid}/registrations")]
            if first:
                rows.append(("Turnierseite", f"/api/tournaments/{slug}/streams"))
            if signed_in:
                rows.append(("Du bist als Nächstes", f"/api/tournaments/{tid}/live-queue/me"))
                if first:
                    rows += [("Turnierseite", f"/api/tournaments/{slug}/friends"), ("Turnierseite", "/api/teams/my")]
            return rows
        if page == "baum":
            return [("Turnierseite", f"/api/tournaments/{slug}"), ("Baum", f"/api/tournaments/{tid}/bracket")]
        if page == "spielplan":
            return [("Turnierseite", f"/api/tournaments/{slug}"), ("Baum", f"/api/tournaments/{tid}/bracket"),
                    ("Spielplan", f"/api/tournaments/{tid}/matchdays"), ("Spielplan", f"/api/tournaments/{tid}/live-queue")]
        cid = self.state["fastlap"]
        return [("Fast Lap Anzeige", f"/api/f1/challenges/{cid}"),
                ("Fast Lap Anzeige", f"/api/f1/challenges/{cid}/leaderboard?track_id={self.track_id}")]

    def pick(self, options) -> str:
        names, weights = zip(*options)
        return self.rng.choices(names, weights=weights)[0]

    async def viewer(self, index: int) -> None:
        if not await self.pause(self.cfg.ramp * index / max(1, self.cfg.viewers)):
            return
        signed_in = self.rng.random() < self.cfg.signed_in
        account = None
        if signed_in:
            self.counters.signed_in_viewers += 1
            account = f"spieler{index % 16 + 1:02d}"
        while self.running():
            # Ein Seitenaufruf mit Rahmen und eigenem Strom, danach Wechsel innerhalb der Seite (ohne Rahmen).
            client = self.client(self.sessions[account] if account else None)
            shell = [("Seitenrahmen", url) for url in SHELL + (SHELL_SIGNED_IN if account else [])]
            page = self.pick(VIEWER_PAGES)
            tournament = self.tournaments[self.pick(EVENT_TOURNAMENTS)]
            await self.load(client, shell + self.page_requests(page, tournament, signed_in, True))
            state = {"page": page, "tournament": tournament}

            # An diesen Seitenaufruf gebunden (nicht an den nächsten der Schleife).
            async def reload(client=client, state=state):
                await self.load(client, self.page_requests(state["page"], state["tournament"], signed_in, False))

            # Die Seite wechselt, der Strom bleibt: welche Ressourcen und welches Turnier zählen, entscheidet die Seite
            # beim Eintreffen.
            watcher = self.spawn(self.stream(
                client, lambda state=state: WATCH[state["page"]], reload,
                scope=lambda state=state: (state["tournament"]["id"], state["tournament"].get("event_id"))))
            poller = self.spawn(self._poll_me(client, state, signed_in))
            for _ in range(self.rng.randint(1, 4)):
                if not await self.pause(self.rng.uniform(30, 120)):
                    break
                state["page"] = self.pick(VIEWER_PAGES)
                state["tournament"] = self.tournaments[self.pick(EVENT_TOURNAMENTS)]
                await self.load(client, self.page_requests(state["page"], state["tournament"], signed_in, True))
            watcher.cancel()
            poller.cancel()
            await client.aclose()

    async def _poll_me(self, client, state: dict, signed_in: bool) -> None:
        # „Du bist als Nächstes“ fragt zusätzlich jede Minute (LiveQueueStatus, pollMs 60000).
        if not signed_in:
            return
        while await self.pause(60):
            if state["page"] == "turnier":
                await self.call(client, "Du bist als Nächstes", "GET",
                                f"/api/tournaments/{state['tournament']['id']}/live-queue/me")

    async def tv(self, index: int) -> None:
        key = self.tv_keys[index]
        tournament = self.tournaments[key["tournament"]]
        client = self.client()
        token = key["token"]

        async def reload():
            await self.load(client, [("TV Baum", f"/api/tournaments/{tournament['id']}/bracket/display?key={token}"),
                                     ("TV Warteschlange", f"/api/stations?tournament_id={tournament['id']}"),
                                     ("TV Warteschlange", f"/api/tournaments/{tournament['id']}/live-queue?key={token}")])

        await self.load(client, [("Seitenrahmen", url) for url in SHELL])
        await reload()
        # Mit Anzeige-Schlüssel kennt der TV sein Event nicht (#1801): dann zählt jedes Turnier mit Event.
        self.spawn(self.stream(client, lambda: WATCH["tv"], reload, overlap=True, scope=lambda: (tournament["id"], None)))

    async def helper(self, index: int) -> None:
        key = EVENT_TOURNAMENTS[index % len(EVENT_TOURNAMENTS)][0]
        tid = self.tournaments[key]["id"]
        client = self.client(self.sessions["lead"])

        async def look():
            response = await self.call(client, "Helfer Ansicht", "GET", f"/api/tournaments/{tid}/live-queue")
            return response.json() if response is not None and response.status_code == 200 else {}

        async def reload():
            await look()

        # Die Turnierleitung kennt das Event ihres Turniers nicht (Ansicht ohne Event, #1801).
        self.spawn(self.stream(client, lambda: WATCH["helfer"], reload, scope=lambda: (tid, None)))
        turn = index
        while await self.pause(self.cfg.helper_pause * self.rng.uniform(0.6, 1.4)):
            action = next_action(await look(), turn)
            turn += 1
            if not action:
                continue
            kind, station_id, match_id = action
            if kind == "result":
                matches = await self.call(client, "Helfer Ansicht", "GET", f"/api/tournaments/{tid}/matches-v2")
                match = next((row for row in (matches.json() if matches is not None and matches.status_code == 200 else [])
                              if row.get("id") == match_id), None)
                body = ranking_body(match or {})
                if body:
                    response = await self.call(client, "Ergebnis eintragen", "POST", f"/api/matches/{match_id}/result",
                                               json=body, tolerated=WRITE_TOLERATED)
                    if response is not None and response.status_code == 200:
                        self.counters.act("result")
            else:
                response = await self.call(client, "Aufrufen/Starten", "POST", f"/api/tournaments/{tid}/live-queue/{kind}",
                                           json={"station_id": station_id, "match_id": match_id}, tolerated=WRITE_TOLERATED)
                if response is not None and response.status_code == 200:
                    self.counters.act(kind)

    async def fastlap_helper(self) -> None:
        client = self.client(self.sessions["admin"])
        cid = self.state["fastlap"]
        drivers = sorted(uid for uid, key in self.player_ids.items() if key != "guest")
        turn = 0
        while await self.pause(self.cfg.fastlap_pause * self.rng.uniform(0.6, 1.4)):
            body = {"user_id": drivers[turn % len(drivers)], "track_id": self.track_id,
                    "time_ms": self.rng.randint(91_000, 99_000), "is_invalid": False, "admin_note": None,
                    "score_scope": "official"}
            turn += 1
            response = await self.call(client, "Fast Lap Schnelleingabe", "POST", f"/api/f1/challenges/{cid}/times",
                                       json=body, tolerated=WRITE_TOLERATED)
            if response is not None and response.status_code == 200:
                self.counters.act("lap")
            await self.call(client, "Fast Lap Schnelleingabe", "POST", f"/api/f1/challenges/{cid}/queue/next",
                            json={"done_id": None, "station": None, "track_id": self.track_id})

    async def onsite(self, index: int) -> None:
        """Vor Ort: QR-Code scannen, Turnier ansehen, anmelden - nach ein bis zwei Minuten wieder abmelden."""
        window = max(1.0, self.cfg.minutes * 60 - self.cfg.ramp - 150)
        if not await self.pause(self.cfg.ramp + window * index / max(1, self.cfg.onsite)):
            return
        user_id, account = await self.onsite_pool.get()
        try:
            if not self.running():
                return
            client = self.client(self.sessions[account])
            tournament = self.tournaments["onsite_members"]
            group = "Vor-Ort-Anmeldung"
            redeemed = await self.call(client, group, "POST", "/api/tournaments/onsite/redeem", json={"token": self.onsite_token})
            if redeemed is None or redeemed.status_code != 200:
                return
            await self.call(client, group, "GET", f"/api/tournaments/{tournament['slug']}")
            registration = await self.call(client, group, "POST", f"/api/tournaments/{tournament['id']}/register",
                                           json={"accept_rules": True, "accept_privacy": True})
            if registration is None or registration.status_code != 200:
                return
            self.counters.onsite_signups += 1
            reg_id = registration.json().get("id")
            await self.call(client, group, "GET", f"/api/tournaments/{tournament['id']}/registrations")
            await self.pause(self.rng.uniform(45, 100))
            # Abmelden auch nach dem Ende - die nächste Runde braucht die Plätze wieder.
            response = await self.call(client, group, "DELETE", f"/api/tournaments/{tournament['id']}/registrations/{reg_id}")
            if response is not None and response.status_code == 200:
                self.counters.act("onsite_off")
        finally:
            self.onsite_pool.put_nowait((user_id, account))

    # -- Messung am Rand
    async def watch_server(self) -> None:
        names = [f"{self.cfg.project}-{service}" for service in ("backend", "mongodb", "frontend")]
        while self.running():
            completed = await asyncio.to_thread(
                subprocess.run, ["docker", "stats", "--no-stream", "--format", "{{json .}}", *names],
                capture_output=True, text=True, encoding="utf-8")
            if completed.returncode == 0:
                at = round(time.perf_counter() - self.t0, 1)
                for line in completed.stdout.splitlines():
                    row = parse_stats_line(line)
                    if row:
                        self.stats.append({**row, "at": at})
            await self.pause(self.cfg.stats_every)

    async def watch_loop(self) -> None:
        # Misst, wie spät die Lastschleife aufwacht - bei hoher Last misst der Client sonst zu lange Zeiten.
        while self.running():
            started = time.perf_counter()
            await asyncio.sleep(0.1)
            self.lag.append(max(0.0, (time.perf_counter() - started - 0.1) * 1000))

    async def run(self) -> dict:
        started_at = datetime.now(timezone.utc)
        try:
            await self.setup()
            self.t0 = time.perf_counter()
            self.deadline = self.t0 + self.cfg.minutes * 60
            workers = [self.watch_server(), self.watch_loop(), self.fastlap_helper()]
            workers += [self.viewer(index) for index in range(self.cfg.viewers)]
            workers += [self.tv(index) for index in range(len(self.tv_keys))]
            workers += [self.helper(index) for index in range(self.cfg.helpers)]
            workers += [self.onsite(index) for index in range(self.cfg.onsite)]
            print(f"Lasttest läuft {self.cfg.minutes:g} min gegen {self.cfg.base_url} ({self.cfg.project}) …", flush=True)
            await asyncio.gather(*(self.spawn(worker) for worker in workers), return_exceptions=True)
            await asyncio.sleep(max(0.0, self.deadline - time.perf_counter()))
            # Laufende Abmeldungen dürfen zu Ende gehen, Ströme und Nachladen nicht.
            for task in list(self.tasks):
                task.cancel()
            await asyncio.gather(*list(self.tasks), return_exceptions=True)
            await self.cleanup()
        finally:
            for client in self.clients:
                await client.aclose()
        self.samples = [row for row in self.samples if row.at <= self.cfg.minutes * 60]
        lag = sorted(self.lag)
        run = {**asdict(self.counters), "loop_lag_ms": {"p95": round(percentile(lag, 95), 1),
                                                        "max": round(max(lag, default=0.0), 1)}}
        config = {key: (str(value) if isinstance(value, Path) else value) for key, value in asdict(self.cfg).items()}
        return {
            "started_at": started_at.isoformat(), "config": config, "run": run,
            "summary": summarize(self.samples, self.cfg.p95_ms, self.cfg.error_rate),
            "server": summarize_stats(self.stats), "server_samples": self.stats,
        }


def _detail(response) -> str:
    try:
        detail = response.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    text = detail if isinstance(detail, str) else ""
    return text[:120]


# --------------------------------------------------------------------------------------------------------- Aufruf

def parse_args(argv: list[str] | None = None) -> Config:
    project = os.environ.get("ABNAHME_PROJECT", DEFAULT_PROJECT)
    port = os.environ.get("FRONTEND_PORT", "24500")
    parser = argparse.ArgumentParser(description="Lasttest für den Event-Abend gegen einen lokalen Abnahme-Stand (#1683).")
    parser.add_argument("--base-url", default=os.environ.get("LASTTEST_URL", f"http://127.0.0.1:{port}"),
                        help="Web-Adresse des Stands (Vorgabe http://127.0.0.1:$FRONTEND_PORT)")
    parser.add_argument("--project", default=project, help="Docker-Projekt (Vorgabe $ABNAHME_PROJECT oder lsw-abnahme-nacht)")
    parser.add_argument("--state", type=Path, default=None, help="Stand-Datei des Seeds (Vorgabe $ABNAHME_STATE)")
    parser.add_argument("--out", type=Path, default=None, help="Ordner für report.md und report.json")
    parser.add_argument("--minutes", type=float, default=5.0, help="Dauer in Minuten (Vorgabe 5)")
    parser.add_argument("--viewers", type=int, default=150, help="Zuschauer und Spieler mit Browser (Vorgabe 150)")
    parser.add_argument("--signed-in", type=float, default=0.3, help="Anteil angemeldeter Spieler (Vorgabe 0.3)")
    parser.add_argument("--tvs", type=int, default=3, help="TVs mit Anzeige-Schlüssel (Vorgabe 3)")
    parser.add_argument("--helpers", type=int, default=4, help="Helfer an der Live-Warteschlange (Vorgabe 4)")
    parser.add_argument("--helper-pause", type=float, default=20.0, help="Sekunden zwischen zwei Helfer-Schritten (20)")
    parser.add_argument("--fastlap-pause", type=float, default=30.0, help="Sekunden zwischen zwei Fast-Lap-Zeiten (30)")
    parser.add_argument("--onsite", type=int, default=20, help="Vor-Ort-Anmeldungen über den Lauf verteilt (Vorgabe 20)")
    parser.add_argument("--ramp", type=float, default=60.0, help="Sekunden, bis alle Zuschauer da sind (Vorgabe 60)")
    parser.add_argument("--p95-ms", type=float, default=P95_LIMIT_MS, help="Grenzwert p95 je Gruppe in ms (800)")
    parser.add_argument("--max-error-rate", type=float, default=ERROR_LIMIT, help="Grenzwert Fehlerquote (0.005)")
    parser.add_argument("--seed", type=int, default=1683, help="Zufallsstart, damit Läufe vergleichbar bleiben")
    parser.add_argument("--overlapping-reloads", action="store_true",
                        help="Nachladen wie das Web vor #1683: jede Meldung lädt neu, auch wenn das vorige noch läuft")
    parser.add_argument("--reload-every-tournament", action="store_true",
                        help="Nachladen wie das Web vor #1801: bei jeder Änderung jedes Turniers, nicht nur des eigenen")
    args = parser.parse_args(argv)
    default_state = ROOT / ".local-testing" / "abnahme" / f"state-{args.project}.json"
    state = args.state or Path(os.environ.get("ABNAHME_STATE") or default_state)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    out = args.out or ROOT / ".local-testing" / "abnahme" / f"lasttest-{args.project}-{stamp}"
    return Config(base_url=args.base_url.strip(), project=args.project, state=state, out=out, minutes=args.minutes,
                  viewers=args.viewers, signed_in=args.signed_in, tvs=min(args.tvs, 6), helpers=args.helpers,
                  helper_pause=args.helper_pause, fastlap_pause=args.fastlap_pause, onsite=args.onsite, ramp=args.ramp,
                  p95_ms=args.p95_ms, error_rate=args.max_error_rate, seed=args.seed,
                  overlapping_reloads=args.overlapping_reloads, reload_every_tournament=args.reload_every_tournament)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows-Konsole: Umlaute im Bericht
    cfg = parse_args(argv)
    try:
        ensure_target(cfg.base_url, cfg.project)
    except SystemExit as stop:
        print(stop, file=sys.stderr)
        return 2
    cfg.base_url = clean_base_url(cfg.base_url)
    if not cfg.state.is_file():
        print(f"Stand-Datei fehlt: {cfg.state} - erst python scripts/seed_abnahme.py", file=sys.stderr)
        return 2
    state = json.loads(cfg.state.read_text(encoding="utf-8"))
    try:
        report = asyncio.run(LoadTest(cfg, state).run())
    except SetupError as error:
        print(f"Lasttest abgebrochen: {error}", file=sys.stderr)
        return 2
    cfg.out.mkdir(parents=True, exist_ok=True)
    markdown = render_markdown(report)
    (cfg.out / "report.md").write_text(markdown, encoding="utf-8", newline="\n")
    (cfg.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                                         newline="\n")
    print(markdown)
    print(f"Bericht: {cfg.out / 'report.md'}")
    return 0 if report["summary"]["green"] else 1


if __name__ == "__main__":
    sys.exit(main())
