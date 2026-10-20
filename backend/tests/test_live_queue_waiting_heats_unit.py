"""Live-Warteschlange (#1858): ein Lauf, der noch auf die Auslosung oder auf Vorspiele wartet, blockiert keine Station.

Gefunden in der Generalprobe 2 (20.10.): Läufe-Cup vor Ort (FFA 16, Winner und Loser Bracket, Show-Auslosung, vier
Stationen), daneben der Sofort-Cup mit denselben Spielern. Nach Runde 1 lost die Turnierleitung Winner Runde 2 aus, die
Karte für Loser Runde 1 bleibt liegen. Die Läufe LA/LB (noch leer, warten auf das Los) standen „Als Nächstes“ an
Station 1 und 2, die bereiten Läufe E und F nur „Danach“ - kein einziger „Aufrufen“-Knopf. Nach dem zweiten Los liefen
vier bereite Läufe auf zwei Stationen, Station 3 und 4 blieben frei.

Erwartung: Ein bereiter Lauf kommt an einer freien Station vor jeden Lauf, der noch nicht spielbar ist; wer auf das Los
wartet, sagt „wartet auf die Auslosung“, wer auf Vorspiele wartet, „wartet auf die Vorspiele“. Solange es bereite Läufe
gibt, bleibt keine Station ohne „Aufrufen“. Duelle genauso.
"""
import pathlib
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.live_queue import build_live_queue  # noqa: E402
from services.match_scheduler import plan_schedule  # noqa: E402
from services.match_v2_results import build_show_draw_application, build_v2_result_application  # noqa: E402

T0 = datetime(2026, 10, 31, 18, 0, tzinfo=timezone.utc)
MINUTES = 12

# Der Probelauf-Cup (scripts/probelauf_mitspieler.py): Läufe zu viert, zwei kommen weiter.
HEATS = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""

# Dasselbe als Duelle (Doppel-K.-o. mit 8).
DUELS = """[WB]
A=[1,2]
B=[3,4]
C=[5,6]
D=[7,8]
E=[W:A:1,W:B:1]
F=[W:C:1,W:D:1]
G=[W:E:1,W:F:1]

[LB]
LA=[L:A:1,L:B:1]
LB=[L:C:1,L:D:1]
LC=[W:LA:1,L:E:1]
LD=[W:LB:1,L:F:1]
LE=[W:LC:1,W:LD:1]

[FINAL]
FINAL=[W:G:1,W:LE:1]"""


def tournament() -> dict:
    return {"id": "t", "event_mode": "local", "schedule_mode": "fixed_by_staff", "format": "ffa_custom_bracket",
            "advancement_mode": "draw_show", "start_date": (T0 - timedelta(hours=1)).isoformat(),
            "match_duration_minutes": MINUTES, "match_break_minutes": 5}


def stage(match_type: str) -> dict:
    heats = match_type == "ffa"
    return {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": match_type,
            "settings": {"match_size": 4 if heats else 2, "qualifiers_per_match": 2 if heats else 1, "min_players": 2,
                         "schema": HEATS if heats else DUELS}}


def cup(match_type: str = "ffa") -> list[dict]:
    """Runde 1 gespielt, Winner Runde 2 ausgelost - Loser Runde 1 wartet auf das Los (Show-Auslosung)."""
    count = 16 if match_type == "ffa" else 8
    registrations = [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]
    matches = build_matches_v2_from_schema({**tournament(), "seeding_mode": "manual", "max_participants": count},
                                           stage(match_type), registrations)
    for match in matches:
        match["tournament_id"] = "t"
    for key in "ABCD":
        play(matches, key)
    draw(matches, "WB:2")
    return matches


def by_key(matches: list[dict]) -> dict[str, dict]:
    return {match["match_key"]: match for match in matches}


def seated(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]


def play(matches: list[dict], key: str) -> None:
    match = by_key(matches)[key]
    ranking = sorted(seated(match), key=lambda reg: int(reg[1:]))
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=T0.isoformat())
    match.update(application["match_set"])
    apply_sets(matches, application)


def draw(matches: list[dict], group: str) -> None:
    apply_sets(matches, build_show_draw_application(matches, group, now_iso=T0.isoformat(), rng=random.Random(7)))


def apply_sets(matches: list[dict], application: dict) -> None:
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)


def stations(count: int) -> list[dict]:
    return [{"id": f"st{index}", "name": f"Station {index}", "device_type": "switch2", "tournament_id": "t",
             "status": "free", "current_match_id": None} for index in range(1, count + 1)]


def participant_keys(matches: list[dict]) -> dict[str, set[str]]:
    return {match["id"]: {f"user:u{reg[1:]}" for reg in seated(match)} for match in matches}


def sofort_cup(matches: list[dict], *keys: str, state: str = "planned", offset: int = 10) -> list[dict]:
    """Der Sofort-Cup daneben: je ein Spieler aus diesen Läufen hat dort ein Spiel in ``offset`` Minuten - standardmäßig
    nur geplant (``state``: ``planned``; ``called`` aufgerufen, ``running`` läuft). Bereit sind die Läufe trotzdem."""
    rows = by_key(matches)
    busy = []
    for index, key in enumerate(keys):
        player = seated(rows[key])[0]
        busy.append({"match_id": f"sofort-{index}", "label": "Sofort-Cup Viertelfinale", "participants": {f"user:u{player[1:]}"},
                     "start": T0 + timedelta(minutes=offset), "end": T0 + timedelta(minutes=offset + MINUTES), "state": state})
    return busy


def queue(matches: list[dict], station_count: int, busy=(), match_type: str = "ffa") -> dict:
    return build_live_queue(tournament(), matches, stations(station_count), now=T0, stages=[stage(match_type)],
                            busy_elsewhere=busy, participant_keys=participant_keys(matches))


def nexts(view: dict) -> dict[str, dict]:
    """Je Station das, was „Als Nächstes“ steht: Kürzel → Eintrag."""
    return {row["next"]["match_key"]: row["next"] for row in view["stations"] if row["next"]}


def callable_stations(view: dict) -> list[str]:
    """Stationen mit „Aufrufen“: frei, als Nächstes ein bereites Spiel, noch nicht aufgerufen (StationQueueBoard)."""
    return [row["id"] for row in view["stations"]
            if row["next"] and row["next"]["ready"] and row["next"]["state"] == "queued" and not row["running"]]


def assert_ready_first(view: dict) -> None:
    """An keiner Station steht ein wartendes Spiel vor einem bereiten."""
    lanes: dict[str, list[dict]] = {}
    for entry in view["matches"].values():
        if entry["station_id"] and entry["state"] == "queued":
            lanes.setdefault(entry["station_id"], []).append(entry)
    for station_id, lane in lanes.items():
        lane.sort(key=lambda entry: entry["position"])
        seen_waiting = False
        for entry in lane:
            assert not (seen_waiting and entry["ready"]), \
                f"{station_id}: {entry['match_key']} ist bereit, steht aber hinter einem wartenden Spiel"
            seen_waiting = seen_waiting or not entry["ready"]


# ---------------------------------------------------------------- Show-Auslosung wartet, Sofort-Cup parallel


def test_heats_waiting_for_the_show_draw_leave_free_stations_to_the_ready_heats():
    matches = cup()
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"))
    shown = nexts(view)
    assert set(shown) == {"E", "F", "LA", "LB"}, "jede Station bekommt einen eigenen Lauf als Nächstes"
    assert shown["E"]["ready"] and shown["F"]["ready"], "E und F sind bereit - sie stehen als Nächstes, nicht danach"
    assert len(callable_stations(view)) == 2, "zwei freie Stationen haben „Aufrufen“ für E und F"
    for key in ("LA", "LB"):
        assert shown[key]["ready"] is False and shown[key]["waiting_for"] == "draw", "LA/LB warten auf die Auslosung"
    assert_ready_first(view)


def test_a_heat_waiting_for_its_previous_heats_says_so():
    """LC/LD warten auf LA/LB und E/F - nicht auf ein Los, das noch nicht dran ist."""
    view = queue(cup(), 4)
    entries = {entry["match_key"]: entry for entry in view["matches"].values()}
    assert entries["LC"]["waiting_for"] == "previous" and entries["LD"]["waiting_for"] == "previous"
    assert entries["E"]["waiting_for"] is None, "ein bereiter Lauf wartet auf nichts"


def test_four_ready_heats_get_all_four_free_stations():
    """Nach dem zweiten Los sind E, F, LA und LB bereit: vier freie Stationen, viermal „Aufrufen“ - nicht zwei Läufe
    nacheinander auf Station 1 und 2, während Station 3 und 4 frei bleiben."""
    matches = cup()
    draw(matches, "LB:2")
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"))
    shown = nexts(view)
    assert set(shown) == {"E", "F", "LA", "LB"}
    assert all(entry["ready"] for entry in shown.values())
    assert len(callable_stations(view)) == 4
    assert_ready_first(view)


def test_with_one_station_the_waiting_heats_queue_behind_the_ready_ones():
    """Eine Station: E und F (bereit) zuerst, LA/LB (warten auf das Los) dahinter - auch wenn vor E noch Zeit wäre."""
    matches = cup()
    view = queue(matches, 1, busy=sofort_cup(matches, "E", "F"))
    station = view["stations"][0]
    assert station["next"]["match_key"] in {"E", "F"} and station["next"]["ready"]
    assert station["after"]["match_key"] in {"E", "F"} and station["after"]["ready"]
    assert_ready_first(view)
    entries = {entry["match_key"]: entry for entry in view["matches"].values()}
    last_ready_end = max(entries[key]["ends_at"] for key in ("E", "F"))
    assert entries["LA"]["forecast_at"] >= last_ready_end and entries["LB"]["forecast_at"] >= last_ready_end


def test_the_planner_puts_ready_heats_before_waiting_ones_at_every_station():
    """Derselbe Plan im Matchplan: „Planen“ legt keinen wartenden Lauf vor einen bereiten an dieselbe Station."""
    matches = cup()
    plan = plan_schedule(tournament(), matches, stations(2), stages=[stage("ffa")], now=T0,
                         busy_elsewhere=sofort_cup(matches, "E", "F"), participant_keys=participant_keys(matches))
    lanes: dict[str, list[dict]] = {}
    for item in plan["assignments"]:
        lanes.setdefault(item["station_id"], []).append(item)
    for lane in lanes.values():
        lane.sort(key=lambda item: item["scheduled_at"])
        waiting = [index for index, item in enumerate(lane) if item.get("waiting_for")]
        ready = [index for index, item in enumerate(lane) if not item.get("waiting_for")]
        assert not waiting or not ready or max(ready) < min(waiting), [(item["match_key"], item.get("waiting_for")) for item in lane]
    assert {item["match_key"]: item.get("waiting_for") for item in plan["assignments"]}["LA"] == "draw"


# ---------------------------------------------------------------- Duelle genauso


def test_duels_waiting_for_the_draw_leave_free_stations_to_the_ready_duels():
    matches = cup("duel")
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"), match_type="duel")
    shown = nexts(view)
    assert set(shown) == {"E", "F", "LA", "LB"}
    assert shown["E"]["ready"] and shown["F"]["ready"]
    assert shown["LA"]["waiting_for"] == "draw" and shown["LB"]["waiting_for"] == "draw"
    assert len(callable_stations(view)) == 2
    assert_ready_first(view)


def test_four_ready_duels_get_all_four_free_stations():
    matches = cup("duel")
    draw(matches, "LB:2")
    view = queue(matches, 4, busy=sofort_cup(matches, "E", "F"), match_type="duel")
    assert set(nexts(view)) == {"E", "F", "LA", "LB"}
    assert len(callable_stations(view)) == 4
