"""Betrieb II (#265): Schwellen der Auto-Checks, Drosselung der Alarme und die
Aufbereitung der Web Vitals - ohne Datenbank, ohne Platte."""
from datetime import datetime, timedelta, timezone

from services.ops_alerts import alert_due
from services.ops_checks import (
    rate_database,
    rate_disk,
    rate_error_groups,
    rate_mail,
    rate_stream,
    rate_variants,
    result,
    summarize_run,
    worst_status,
)
from services.ops_vitals import aggregate, clean_batch, clean_entry, normalize_route, rate_metric


def test_the_worst_traffic_light_wins():
    assert worst_status(["ok", "ok"]) == "ok"
    assert worst_status(["ok", "warn", "ok"]) == "warn"
    assert worst_status(["warn", "crit", "ok"]) == "crit"
    assert worst_status([]) == "ok"


def test_database_latency_thresholds():
    assert rate_database(40) == "ok"
    assert rate_database(250) == "warn"
    assert rate_database(1000) == "crit"
    assert rate_database(None) == "crit"


def test_disk_thresholds_are_about_free_share():
    assert rate_disk(60.0) == "ok"
    assert rate_disk(14.9) == "warn"
    assert rate_disk(4.9) == "crit"
    assert rate_disk(None) == "crit"


def test_mail_queue_is_red_when_it_hangs_or_piles_up():
    assert rate_mail({"failed": 0}, due_pending=0, stale_sending=0) == "ok"
    assert rate_mail({"failed": 2}, due_pending=0, stale_sending=0) == "warn"
    assert rate_mail({"failed": 0}, due_pending=20, stale_sending=0) == "crit"
    assert rate_mail({"failed": 0}, due_pending=0, stale_sending=1) == "crit"


def test_a_quiet_change_stream_is_not_an_error():
    assert rate_stream(None) == "ok"
    assert rate_stream(5.0) == "ok"
    assert rate_stream(49.0) == "warn"


def test_missing_variants_and_error_groups():
    assert rate_variants(0) == "ok"
    assert rate_variants(51) == "warn"
    assert rate_error_groups(0, 0) == "ok"
    assert rate_error_groups(3, 0) == "warn"
    assert rate_error_groups(0, 1) == "crit"


def test_a_run_counts_its_lights_and_names_the_failing_checks():
    run = summarize_run([
        result("database", "Datenbank", "ok", "12 ms"),
        result("disk", "Freier Speicher", "warn", "10 GB frei (12 %)"),
        result("mail_queue", "Mail-Queue", "crit", "0 wartend", "2 hängen"),
        result("odd", "Unbekannt", "weird", "?"),
    ], at="2026-09-16T12:00:00+00:00")
    assert run["status"] == "crit"
    assert run["counts"] == {"ok": 1, "warn": 1, "crit": 2}
    assert run["failing"] == ["disk", "mail_queue", "odd"]
    assert run["at"] == "2026-09-16T12:00:00+00:00"


def test_alerts_are_throttled_to_one_per_hour():
    now = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
    assert alert_due(None, now)
    assert not alert_due((now - timedelta(minutes=59)).isoformat(), now)
    assert alert_due((now - timedelta(minutes=60)).isoformat(), now)
    assert alert_due("kaputt", now)


def test_routes_lose_ids_queries_and_junk():
    assert normalize_route("/news/halloween-2026") == "/news/halloween-2026"
    assert normalize_route("/u/0123456789abcdef?tab=x#y") == "/u/:id"
    assert normalize_route("/tournaments/1234/live/") == "/tournaments/:id/live"
    assert normalize_route("///admin//ops") == "/admin/ops"
    assert normalize_route("") == "/"
    assert normalize_route("/a b<script>") == "/abscript"
    assert len(normalize_route("/" + "x" * 500)) == 120


def test_entries_are_checked_and_rated_on_the_server():
    assert clean_entry({"name": "lcp", "value": 2400, "route": "/", "device": "mobile"}) == {
        "name": "LCP", "value": 2400, "rating": "good", "route": "/", "device": "mobile",
    }
    assert clean_entry({"name": "CLS", "value": 0.3, "rating": "good"})["rating"] == "poor"
    assert clean_entry({"name": "INP", "value": "schnell"}) is None
    assert clean_entry({"name": "TTI", "value": 1}) is None
    assert clean_entry({"name": "LCP", "value": -5}) is None
    assert clean_entry({"name": "LCP", "value": 99999999}) is None
    assert clean_entry({"name": "FCP", "value": 900, "device": "tablet"})["device"] == "desktop"
    assert rate_metric("INP", 200) == "good"
    assert rate_metric("INP", 501) == "poor"


def test_a_batch_is_capped_and_survives_junk():
    batch = clean_batch({"entries": [{"name": "LCP", "value": 1000}] * 20 + ["x"]})
    assert len(batch) == 12
    assert clean_batch({"entries": "nope"}) == []
    assert clean_batch([{"name": "CLS", "value": 0.01}]) == [{"name": "CLS", "value": 0.01, "rating": "good", "route": "/", "device": "desktop"}]


def test_aggregation_gives_median_p75_and_the_good_share_per_route():
    rows = [{"name": "LCP", "value": v, "route": "/galerie", "device": "mobile"} for v in (1000, 2000, 3000, 6000)]
    rows += [{"name": "CLS", "value": v, "route": "/galerie", "device": "mobile"} for v in (0.02, 0.05, 0.3)]
    rows += [{"name": "LCP", "value": 900, "route": "/", "device": "desktop"}]
    out = aggregate(rows)
    assert [r["route"] for r in out["routes"]] == ["/galerie", "/"]
    galerie = out["routes"][0]
    assert galerie["samples"] == 4
    assert galerie["metrics"]["LCP"]["p50"] == 2500
    assert galerie["metrics"]["LCP"]["p75"] == 3750
    assert galerie["metrics"]["LCP"]["good_share"] == 0.5
    assert galerie["metrics"]["LCP"]["rating"] == "needs-improvement"
    assert galerie["metrics"]["CLS"]["p75"] == 0.175
    assert galerie["worst"] == "needs-improvement"
    assert out["overall"]["LCP"]["count"] == 5
    assert out["samples"] == 8
