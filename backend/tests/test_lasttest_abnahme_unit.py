"""Lasttest für den Event-Abend (#1683): Guard, Auswertung und Helfer-Logik von scripts/lasttest_abnahme.py - ohne Netz."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("lasttest_abnahme", ROOT / "scripts" / "lasttest_abnahme.py")
lasttest = importlib.util.module_from_spec(spec)
# dataclasses sucht das Modul in sys.modules.
sys.modules[spec.name] = lasttest
spec.loader.exec_module(lasttest)

LOCAL_ENV = {
    "DB_NAME": "tls_abnahme",
    "APP_ENV": "development",
    "FRONTEND_URL": "http://127.0.0.1:24800",
    "MONGO_URL": "mongodb://abnahme:nur-test@mongodb:27017/?authSource=admin",
}
URL = "http://127.0.0.1:24800"


# ---------------------------------------------------------------------------------------------------------- Guard

def test_own_local_stack_passes():
    assert lasttest.target_problems(URL, "lsw-abnahme-1683", LOCAL_ENV, {24800, 29801}) == []


@pytest.mark.parametrize("url", ["https://lionsquad.at", "http://192.168.1.20:24800", "http://staging.lionsquad.at:24800"])
def test_only_this_machine(url):
    problems = lasttest.target_problems(url, "lsw-abnahme-1683", LOCAL_ENV, {24800})
    assert any("nicht auf diesem Rechner" in problem for problem in problems)


def test_shared_stack_is_refused():
    problems = lasttest.target_problems("http://127.0.0.1:23000", "lsw-abnahme", LOCAL_ENV, {23000})
    assert any("gemeinsame Stand" in problem for problem in problems)


def test_missing_container_is_refused():
    problems = lasttest.target_problems(URL, "lsw-abnahme-weg", None, set())
    assert any("läuft nicht" in problem for problem in problems)


@pytest.mark.parametrize("env, expected", [
    ({**LOCAL_ENV, "DB_NAME": "tls_production"}, "Datenbank"),
    ({**LOCAL_ENV, "APP_ENV": "production"}, "Produktion"),
    ({**LOCAL_ENV, "MONGO_URL": "mongodb+srv://cluster.example.net/db"}, "MONGO_URL"),
    ({**LOCAL_ENV, "FRONTEND_URL": "https://lionsquad.at"}, "FRONTEND_URL"),
])
def test_backend_must_be_the_abnahme(env, expected):
    problems = lasttest.target_problems(URL, "lsw-abnahme-1683", env, {24800})
    assert any(expected in problem for problem in problems)


def test_port_must_belong_to_the_project():
    # Die Adresse zeigt auf einen anderen Stand (z. B. den gemeinsamen auf 23000), geprüft wurde aber dieser.
    problems = lasttest.target_problems("http://127.0.0.1:23000", "lsw-abnahme-1683", LOCAL_ENV, {24800, 29801})
    assert any("Port 23000" in problem for problem in problems)


@pytest.mark.parametrize("url, expected", [
    ("http://lasttest:geheimpw@127.0.0.1:24800", "Zugangsdaten"),
    ("http://lasttest@127.0.0.1:24800", "Zugangsdaten"),
    ("http://127.0.0.1:24800/?key=geheimpw", "Abfrage oder Fragment"),
    ("http://127.0.0.1:24800/#geheimpw", "Abfrage oder Fragment"),
    ("http://127.0.0.1:24800?", "Abfrage oder Fragment"),
    ("ftp://127.0.0.1:24800", "http://"),
    ("http://127.0.0.1:99999", "Port"),
])
def test_base_url_only_scheme_host_port_path(url, expected):
    problems = lasttest.target_problems(url, "lsw-abnahme-1683", LOCAL_ENV, {24800})
    assert any(expected in problem for problem in problems)
    # Die Meldungen nennen die Adresse nie im Wortlaut.
    assert not any("geheimpw" in problem or "lasttest:" in problem for problem in problems)


@pytest.mark.parametrize("url, clean", [
    ("http://127.0.0.1:24800/", "http://127.0.0.1:24800"),
    ("http://localhost:24800/basis/", "http://localhost:24800/basis"),
    ("http://[::1]:24800", "http://[::1]:24800"),
])
def test_clean_base_url_for_output(url, clean):
    assert lasttest.base_url_problems(url) == []
    assert lasttest.clean_base_url(url) == clean


def test_main_never_prints_userinfo(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(lasttest, "_inspect", lambda container, template: None)
    url = "http://lasttest:geheimpw@127.0.0.1:24800/?key=geheimpw"
    assert lasttest.main(["--project", "lsw-abnahme-1683", "--base-url", url, "--state", str(tmp_path / "s.json")]) == 2
    captured = capsys.readouterr()
    assert "geheimpw" not in captured.err + captured.out


@pytest.mark.parametrize("variable", ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
def test_clients_ignore_proxies_from_the_environment(monkeypatch, tmp_path, variable):
    # Ein Proxy aus der Umgebung würde die geprüfte lokale Adresse umgehen - der Lasttest nimmt keinen.
    monkeypatch.setenv(variable, "http://proxy.invalid:9")
    cfg = lasttest.Config(base_url=URL, project="lsw-abnahme-1683", state=tmp_path / "s.json", out=tmp_path)
    client = lasttest.LoadTest(cfg, {}).client()
    assert client.trust_env is False
    assert not client._mounts  # keine Proxy-Weiterleitung eingehängt


def test_published_ports_from_docker_inspect():
    ports = {"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "24800"}], "443/tcp": None, "8001/tcp": [{"HostPort": ""}]}
    assert lasttest.published_ports(ports) == {24800}
    assert lasttest.published_ports(None) == set()


def test_ensure_target_stops_before_any_request(monkeypatch):
    monkeypatch.setattr(lasttest, "_inspect", lambda container, template: None)
    with pytest.raises(SystemExit, match="kein eigener lokaler Abnahme-Stand"):
        lasttest.ensure_target(URL, "lsw-abnahme-1683")


def test_main_aborts_with_exit_2_without_stack(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(lasttest, "_inspect", lambda container, template: None)
    assert lasttest.main(["--project", "lsw-abnahme-weg", "--base-url", URL, "--state", str(tmp_path / "s.json")]) == 2
    assert "abgebrochen" in capsys.readouterr().err


# ------------------------------------------------------------------------------------------------------ Werkzeuge

@pytest.mark.parametrize("at, code", [(59, "287082"), (1111111109, "081804"), (1234567890, "005924")])
def test_totp_matches_rfc_6238(at, code):
    # Geheimnis aus RFC 6238 Anhang B (SHA-1), wie im Seed.
    assert lasttest.totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", at=at) == code


def test_safe_path_hides_keys_and_codes():
    assert lasttest.safe_path("/api/tournaments/t1/live-queue?key=geheim123") == "/api/tournaments/t1/live-queue?key=***"
    assert lasttest.safe_path("/api/f1/challenges/c1/leaderboard?track_id=t9") == "/api/f1/challenges/c1/leaderboard?track_id=t9"
    assert "geheim" not in lasttest.safe_path("/x?access=geheim&token=geheim&ticket=geheim")


@pytest.mark.parametrize("kind, resource, watched, expected", [
    ("change", "tournaments", {"tournaments"}, True),
    ("change", "matches", {"tournaments"}, True),  # Spiele betreffen die Turnierseite (wie im Web)
    ("change", "matches-v2", {"matches"}, True),
    ("change", "f1", {"tournaments", "matches"}, False),
    ("change", "f1", {"f1"}, True),
    ("change", "stations", {"tournaments"}, False),
    ("reset", "", {"f1"}, True),  # Reset des Stroms: alles neu laden
    ("connected", "tournaments", {"tournaments"}, False),
])
def test_reload_follows_the_web_rules(kind, resource, watched, expected):
    assert lasttest.wants_reload(kind, {"resource": resource}, watched) is expected


# Live-Nachladen je Turnier (#1801), wie lib/apiInvalidation.js: eine Seite lädt nur bei Änderungen ihres Turniers -
# Seiten mit Stationen auch bei den anderen Turnieren ihres Events; ohne Kennung oder ohne eigenes Turnier wie bisher.
SPIELPLAN = {"tournaments", "matches", "matches-v2", "stations"}


@pytest.mark.parametrize("event, watched, tournament_id, event_id, expected", [
    ({"resource": "tournaments", "tournament_id": "t1"}, {"tournaments"}, "t1", None, True),
    ({"resource": "tournaments", "tournament_id": "t2"}, {"tournaments"}, "t1", None, False),
    ({"resource": "matches", "tournament_id": "t2"}, {"tournaments", "matches"}, "t1", None, False),
    ({"resource": "tournaments"}, {"tournaments"}, "t1", None, True),  # Meldung ohne Turnier
    ({"resource": "tournaments", "tournament_id": "t2"}, {"tournaments"}, None, None, True),  # Seite ohne Turnier
    ({"resource": "matches", "tournament_id": "t2", "parent_event_id": "e1"}, SPIELPLAN, "t1", "e1", True),
    ({"resource": "matches", "tournament_id": "t2", "parent_event_id": "e2"}, SPIELPLAN, "t1", "e1", False),
    ({"resource": "matches", "tournament_id": "t2", "parent_event_id": None}, SPIELPLAN, "t1", None, False),
    ({"resource": "matches", "tournament_id": "t2", "parent_event_id": "e2"}, SPIELPLAN, "t1", None, True),  # TV mit Schlüssel
    ({"resource": "tournaments", "tournament_id": "t2", "parent_event_id": "e1"}, {"tournaments"}, "t1", "e1", False),
    ({"resource": "f1", "tournament_id": "t1"}, {"tournaments"}, "t1", None, False),
    # Station nur am Event (Codex-Prüfung): nennt das Event allein.
    ({"resource": "stations", "tournament_id": None, "parent_event_id": "e1"}, SPIELPLAN, "t1", "e1", True),
    ({"resource": "stations", "tournament_id": None, "parent_event_id": "e2"}, SPIELPLAN, "t1", "e1", False),
    ({"resource": "stations", "tournament_id": None, "parent_event_id": "e2"}, SPIELPLAN, "t1", None, True),
    ({"resource": "stations"}, SPIELPLAN, "t1", "e1", True),
])
def test_reload_only_for_the_own_tournament_like_the_web(event, watched, tournament_id, event_id, expected):
    assert lasttest.wants_reload("change", event, watched, tournament_id, event_id) is expected


def test_reload_every_tournament_compares_with_the_web_before_1801():
    other = {"resource": "tournaments", "tournament_id": "t2"}
    assert lasttest.wants_reload("change", other, {"tournaments"}, "t1", None, every_tournament=True) is True
    assert lasttest.wants_reload("reset", {}, {"tournaments"}, "t1", None) is True
    assert lasttest.parse_args(["--reload-every-tournament"]).reload_every_tournament is True
    assert lasttest.parse_args([]).reload_every_tournament is False


def station(sid, running=None, upcoming=None, status="free"):
    return {"id": sid, "status": status, "running": running, "next": upcoming}


def test_helper_enters_result_first_then_starts_then_calls():
    view = {"stations": [
        station("s1", upcoming={"match_id": "m3", "state": "queued", "ready": True}),
        station("s2", upcoming={"match_id": "m2", "state": "called", "ready": True}),
        station("s3", running={"match_id": "m1", "state": "running"}),
    ]}
    assert lasttest.next_action(view, 0) == ("call", "s1", "m3")
    assert lasttest.next_action(view, 1) == ("start", "s2", "m2")
    assert lasttest.next_action(view, 2) == ("result", "s3", "m1")


def test_helper_waits_when_nothing_is_ready():
    view = {"stations": [station("s1", upcoming={"match_id": "m9", "state": "queued", "ready": False}),
                         station("s2", running={"match_id": "m1"}, status="broken")]}
    assert lasttest.next_action(view, 0) is None
    assert lasttest.next_action({}, 3) is None


def test_ranking_body_keeps_the_slot_order():
    match = {"slots": [{"registration_id": "a"}, {"registration_id": None}, {"registration_id": "b"}]}
    assert lasttest.ranking_body(match) == {"results": [{"registration_id": "a", "rank": 1, "score": 15},
                                                        {"registration_id": "b", "rank": 2, "score": 12}]}
    assert lasttest.ranking_body({"slots": [{"registration_id": "a"}]}) is None


# ------------------------------------------------------------------------------------------------------ Auswertung

def sample(group, ms, status=200, outcome="ok", path="/api/x"):
    return lasttest.Sample(group, "GET", path, status, ms, outcome)


def test_classify_separates_rejected_from_errors():
    assert lasttest.classify(200, (200,)) == "ok"
    assert lasttest.classify(409, (200,), (409,)) == "rejected"
    assert lasttest.classify(409, (200,)) == "error"
    assert lasttest.classify(None, (200,)) == "error"
    assert lasttest.classify(500, (200,), (409,)) == "error"
    # Besetzte Turnier-Sperre: die Person sieht „Bitte erneut versuchen“ - das zählt als Fehler.
    busy = "Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen."
    assert lasttest.classify(409, (200,), (409,), busy) == "error"
    assert lasttest.classify(409, (200,), (409,), "Das Spiel läuft schon.") == "rejected"


def test_percentile_nearest_rank():
    values = list(range(1, 101))
    assert lasttest.percentile(values, 50) == 50
    assert lasttest.percentile(values, 95) == 95
    assert lasttest.percentile(values, 99) == 99
    assert lasttest.percentile([7.0], 95) == 7.0
    assert lasttest.percentile([], 95) == 0.0


def test_summary_green_within_limits():
    rows = [sample("Baum", 100 + index) for index in range(200)]
    report = lasttest.summarize(rows, p95_limit=800, error_limit=0.005)
    assert report["green"] is True
    assert report["groups"]["Baum"]["requests"] == 200
    assert report["groups"]["Baum"]["p50_ms"] == 199.0
    assert report["groups"]["Baum"]["p95_ms"] == 289.0


def test_summary_red_when_p95_too_slow():
    rows = [sample("Baum", 100)] * 90 + [sample("Baum", 2000)] * 10
    report = lasttest.summarize(rows, p95_limit=800, error_limit=0.005)
    assert report["green"] is False
    assert report["groups"]["Baum"]["p95_ok"] is False
    assert report["groups"]["Baum"]["errors_ok"] is True


def test_summary_red_on_errors_and_ignores_rejected():
    rows = [sample("Ergebnis eintragen", 50)] * 197 + [sample("Ergebnis eintragen", 60, 409, "rejected")] * 2
    rows.append(sample("Ergebnis eintragen", 30_000, None, "error"))  # Zeitüberschreitung: Fehler, aber keine Zeit
    stats = lasttest.summarize(rows)["groups"]["Ergebnis eintragen"]
    assert stats["errors"] == 1 and stats["rejected"] == 2
    assert stats["error_rate"] == 0.005 and stats["errors_ok"] is False
    assert stats["max_ms"] == 60.0


def test_summary_lists_slowest_and_error_examples():
    rows = [sample("Baum", 10), sample("TV Baum", 900, path="/api/t/bracket/display?key=***"),
            sample("Turnierseite", 50, 500, "error")]
    report = lasttest.summarize(rows, slowest=2)
    assert [row["ms"] for row in report["slowest"]] == [900, 50]
    assert report["error_examples"][0]["label"] == "Turnierseite: GET 500"
    assert report["green"] is False
    assert lasttest.summarize([])["green"] is False  # ohne Anfragen kein Grün


def test_docker_stats_are_parsed():
    line = '{"Name":"lsw-abnahme-1683-backend","CPUPerc":"87.50%","MemUsage":"212.4MiB / 31.2GiB"}'
    assert lasttest.parse_stats_line(line) == {"name": "lsw-abnahme-1683-backend", "cpu": 87.5, "mem_mib": 212.4}
    assert lasttest.parse_stats_line("kein json") is None
    assert lasttest.parse_size_mib("1.5GiB") == 1536.0
    assert lasttest.parse_size_mib("512KiB") == 0.5
    stats = lasttest.summarize_stats([{"name": "b", "cpu": 10.0, "mem_mib": 100.0}, {"name": "b", "cpu": 30.0, "mem_mib": 120.0}])
    assert stats == {"b": {"samples": 2, "cpu_avg": 20.0, "cpu_max": 30.0, "mem_max_mib": 120.0}}


def test_markdown_report_names_verdict_and_limits():
    rows = [sample("Baum", 120), sample("TV Baum", 300, path=lasttest.safe_path("/api/t/bracket/display?key=geheim"))]
    report = {
        "started_at": "2026-10-24T17:00:00+00:00",
        "config": {"viewers": 150, "tvs": 3, "helpers": 4, "minutes": 10, "project": "lsw-abnahme-1683", "base_url": URL},
        "run": {"signed_in_viewers": 45, "onsite_signups": 20, "events": 300, "reloads": 900, "resets": 0, "stream_drops": 0,
                "actions": {"call": 5, "start": 5, "result": 4, "lap": 10, "onsite_off": 20},
                "loop_lag_ms": {"p95": 3.0, "max": 20.0}},
        "summary": lasttest.summarize(rows),
        "server": {"lsw-abnahme-1683-backend": {"samples": 3, "cpu_avg": 40.0, "cpu_max": 95.5, "mem_max_mib": 210.0}},
    }
    text = lasttest.render_markdown(report)
    assert "**Ergebnis: grün.** 150 Zuschauer (davon 45 angemeldet), 3 TVs, 4 Helfer" in text
    assert "p95 < 800 ms" in text and "Fehler < 0,50 %" in text
    assert "| Baum | 1 | 0 | 0,00 % |" in text
    assert "95,5 %" in text
    assert "geheim" not in text
    assert "nur bei Änderungen des eigenen Turniers (Web ab #1801)" in text
    report["config"]["reload_every_tournament"] = True
    assert "bei jeder Änderung jedes Turniers (Web vor #1801)" in lasttest.render_markdown(report)
