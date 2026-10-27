"""Generalprobe für das Vor-Ort-Event am 31.10. (#2033): ein ganzer Abend über die echten Routen.

Kein Docker, kein Server: der Flow-Harness (``flow_harness.make_flow``) lässt die Anwendung gegen eine Datenbank im
Speicher laufen. Die Server-Jobs (Check-in-Ende, Ergebnis-Fenster, Fristen, Show-Auslosung, Lauf-Umbau-Warteschlange)
stößt der Test an - genau die Funktionen, die der Scheduler am Abend aufruft.

Wie am Abend (Vorgabe des Obmanns): ein Läufe-Cup für **16 Plätze**, es kommen aber nur **9 oder 10**. Durchgespielt in
den Weiterkommen-Modi fest, sofort zufällig und Show-Auslosung, je mit dem Baum aus dem Format (Läufe zu viert, die
zwei Besten weiter) und mit dem Schema des Probelauf-Cups (Winner, Loser Bracket, Finale):

- Anlegen: Event, Cup im Event, Vorschau-Baum, vier Stationen, ein Helfer (Schiedsrichter) im Einsatz.
- Anmeldung mit Warteliste, Check-in vor Ort: der Rest ist nicht erschienen, die Warteliste rückt nach, ein
  Nachzügler kommt nach dem Check-in-Ende.
- Läufe an Stationen aufrufen und starten, Ergebnisse (auch „Rückgängig“), Warteschlange, TV mit Anzeige-Schlüssel.
- Störungen: Aufruf zurücknehmen, Station wechseln, zwei Stationen melden gleichzeitig, Ergebnis korrigieren, nicht
  erschienen im Lauf, Austritt nach einem gefahrenen Lauf (der Dritte rückt nach), Disqualifikation, Austritt im
  laufenden Lauf - das Feld fällt dabei auf 7 bis 8.
- Ende: genau ein Finale, ein Sieger, kein Lauf über der Laufgröße, kein gefahrener Lauf mit einem Fahrer, Graph gültig,
  keine verwaisten Weiterleitungen, kein hängender Lauf-Umbau, nichts offen bei der Turnierleitung, Protokoll lückenlos,
  Jahreswertung vergeben. Dazu Fast Lap am Simulator.

Nach jedem Schritt prüft ``Abend.check`` die Invarianten. Die Befunde der ersten Probe (#2044: ein Loser-Lauf als
„ohne Teilnehmer“ abgesagt, bevor das Zusammenlegen ihm Fahrer brachte; #2045: ausgeglichene Läufe lehnten das
Ergebnis ab) sind unten fest nachgestellt und seit dem Fix grün.
"""
import asyncio
import pathlib
import random
import sys
import zlib
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402

DONE = {"completed", "forfeit", "bye", "cancelled"}
HEAT_SIZE = 4
QUOTA = 2
PLACES = 16
SHOW_MINUTES = 3

# Erfundene Namen - keine echten Personen.
NAMES = [
    "Kurven-Kai", "Turbo-Tina", "Drift-Dana", "Bremser-Bo", "Pilz-Pia", "Banane-Ben", "Panzer-Paula", "Blitz-Bruno",
    "Rampe-Rita", "Schild-Sami", "Stern-Stella", "Muschel-Moritz", "Feder-Fiona", "Raketen-Ron", "Kiesel-Kira",
    "Wolke-Willi", "Zick-Zoe", "Nebel-Nils", "Spur-Svenja", "Gummi-Gus", "Lenker-Lotta", "Hupe-Hannes",
    "Tacho-Tara", "Wende-Wanja", "Funken-Frida", "Auspuff-Arne", "Kupplung-Kim", "Zielflagge-Zara",
]

# Der Probelauf-Cup (scripts/probelauf_mitspieler.py): 16 Plätze, Läufe zu viert, Winner und Loser Bracket, Finale.
LB_CUP = """[WB]
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

TREES = {"format": None, "lb": LB_CUP}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    # Der TV-Baum zeigt den Vor-Ort-QR; dessen Code ist mit dem Server-Geheimnis signiert (am Abend gesetzt).
    monkeypatch.setenv("JWT_SECRET", "generalprobe-secret-with-at-least-32-characters")
    # Wie in der echten Datenbank: die Turnier-Sperre ist eindeutig - gleichzeitige Meldungen warten aufeinander.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def seed_draw(monkeypatch, seed: int) -> random.Random:
    """Das Los mit Startwert (wie test_bracket_generator_sim_unit): an jeder Importstelle von ``DRAW_RNG``."""
    rng = random.Random(seed)
    for name, module in list(sys.modules.items()):
        if name.startswith("services.") and hasattr(module, "DRAW_RNG"):
            monkeypatch.setattr(module, "DRAW_RNG", rng)
    return rng


@pytest.fixture(autouse=True)
def seeded_draw(request, monkeypatch) -> random.Random:
    """Jeder Abend lost mit festem Startwert aus seiner Kennung: derselbe Fall gibt immer dasselbe Los."""
    return seed_draw(monkeypatch, zlib.crc32(request.node.nodeid.encode("utf-8")))


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def seated(match: dict) -> list[str]:
    ordered = sorted(match.get("slots") or [], key=lambda slot: slot.get("slot") or 0)
    return [slot["registration_id"] for slot in ordered if slot.get("registration_id")]


def auto_bye(match: dict) -> bool:
    return (match.get("result_meta") or {}).get("source") == "auto_bye"


class Abend:
    """Ein Turnier am Abend: wer handelt, was es gibt, und die Invarianten nach jedem Schritt."""

    def __init__(self, flow, *, lead: dict, helper: dict, event: dict, tournament: dict, stations: list[dict]):
        self.flow = flow
        self.lead = lead
        self.helper = helper
        self.event = event
        self.t = tournament
        self.tid = tournament["id"]
        self.stations = stations
        self.removed: set[str] = set()
        self.absent: set[str] = set()  # nicht erschienen, sitzen aber noch im Baum
        self.steps: list[str] = []

    # ------------------------------------------------------------------ Lesen
    async def matches(self) -> list[dict]:
        rows = await self.flow.db.matches_v2.find({"tournament_id": self.tid}, {"_id": 0}).to_list(500)
        return [row for row in rows if not row.get("is_preview")]

    async def by_key(self) -> dict[str, dict]:
        return {match["match_key"]: match for match in await self.matches()}

    async def reload(self, match: dict) -> dict:
        return await self.flow.reload(match)

    async def stored(self) -> dict:
        return await self.flow.db.tournaments.find_one({"id": self.tid}, {"_id": 0})

    async def registrations(self) -> dict[str, dict]:
        rows = await self.flow.db.tournament_registrations.find({"tournament_id": self.tid}, {"_id": 0}).to_list(200)
        return {row["id"]: row for row in rows}

    async def queue(self) -> dict:
        self.flow.act_as(self.helper)
        response = await self.flow.get(f"/api/tournaments/{self.tid}/live-queue")
        assert response.status_code == 200, response.text
        return response.json()

    async def state(self) -> str:
        """Der Baum in Kurzform - für Fehlermeldungen: Lauf, Stand, Plätze (Herkunft, Stand, Name), Weiterleitungen."""
        regs = await self.registrations()
        lines = []
        for m in sorted(await self.matches(), key=lambda row: (row.get("round") or 0, row["match_key"])):
            seats = [((s.get("source") or {}).get("raw"), s.get("status"),
                      (regs.get(s.get("registration_id")) or {}).get("display_name")) for s in m["slots"]]
            forwards = [(a.get("flow"), a.get("rank"), a.get("to_match_key"), a.get("to_slot"))
                        for a in m.get("advancement") or []]
            quota = m["settings"].get("qualifiers_per_match")
            lines.append(f"{m['match_key']} {m['status']} q={quota} {seats} -> {forwards}")
        return "\n".join(lines)

    def station(self, station_id: str) -> dict:
        return next(station for station in self.stations if station["id"] == station_id)

    # ------------------------------------------------------------------ Server-Jobs
    async def tick(self, *, draw_timeout: bool = False) -> None:
        """Ein Takt der Server-Jobs: Ergebnis-Fenster abgelaufen, Fristen, Show-Auslosung (mit ``draw_timeout`` nach
        Ablauf der Frist: der Server lost selbst), wartender Lauf-Umbau."""
        from services import draw_show, match_deadline_sweep
        from services.heat_rebuild import process_pending_heat_rebuilds
        from services.result_hold import publish_due_holds

        await publish_due_holds(self.flow.db, now=now_utc() + timedelta(seconds=30))
        await match_deadline_sweep.sweep(self.flow.db, now=now_utc())
        later = now_utc() + timedelta(minutes=2 * SHOW_MINUTES + 1) if draw_timeout else now_utc()
        if draw_timeout:
            await draw_show.sweep(self.flow.db, now=now_utc() + timedelta(minutes=SHOW_MINUTES + 0.5))
        await draw_show.sweep(self.flow.db, now=later)
        await process_pending_heat_rebuilds(self.flow.db)

    # ------------------------------------------------------------------ Handeln
    async def call(self, station: dict, match: dict, *, start: bool = True) -> None:
        self.flow.act_as(self.helper)
        body = {"station_id": station["id"], "match_id": match["id"]}
        called = await self.flow.post(f"/api/tournaments/{self.tid}/live-queue/call", json=body)
        assert called.status_code == 200, (match["match_key"], called.text)
        if start:
            started = await self.flow.post(f"/api/tournaments/{self.tid}/live-queue/start", json=body)
            assert started.status_code == 200, (match["match_key"], started.text)

    async def enter(self, match: dict, ranking: list[str], *, forfeit: set[str] = frozenset(), hold: bool = False,
                    as_user: dict | None = None, force: bool = False, reason: str | None = None):
        self.flow.act_as(as_user or self.helper)
        body = {"results": [{"registration_id": reg, "rank": index + 1, "forfeit": reg in forfeit,
                             "score": max(0, 15 - 3 * index)} for index, reg in enumerate(ranking)], "hold": hold}
        if reason:
            body["reason"] = reason
        return await self.flow.post(f"/api/matches/{match['id']}/result" + ("?force=true" if force else ""), json=body)

    async def remove(self, registration_id: str, kind: str, reason: str = "Generalprobe") -> dict:
        """Austritt oder Disqualifikation: Umbauplan vorschlagen, dann bestätigen - wie die Turnierleitung."""
        self.flow.act_as(self.lead)
        url = f"/api/tournaments/{self.tid}/registrations/{registration_id}/removal"
        proposed = await self.flow.post(url, json={"kind": kind, "reason": reason})
        assert proposed.status_code == 200, proposed.text
        plan = proposed.json()["plan"]
        applied = await self.flow.post(url, json={"kind": kind, "reason": reason, "plan_id": plan["id"]})
        assert applied.status_code == 200, applied.text
        self.removed.add(registration_id)
        return plan

    async def confirm_heat_plan(self) -> bool:
        """Liegt ein Vorschlag „Läufe umbauen“ an der Turnierleitung, bestätigt sie ihn - wie am Handy."""
        plan = (await self.stored()).get("heat_rebuild_plan")
        if not plan:
            return False
        assert plan.get("summary"), "der Vorschlag sagt in Worten, was passiert"
        self.flow.act_as(self.lead)
        response = await self.flow.post(f"/api/tournaments/{self.tid}/heat-rebuild/confirm",
                                        json={"plan_id": plan["id"]})
        assert response.status_code == 200, response.text
        return True

    async def draw_waiting(self) -> int:
        """Show-Auslosung: „Jetzt auslosen“ für jede Runde, die bereit ist."""
        self.flow.act_as(self.lead)
        groups = {(row["stage_id"], row["settings"].get("draw_group")) for row in await self.matches()
                  if isinstance(row.get("draw_ready"), dict) and row["status"] != "cancelled"
                  and not isinstance(row.get("draw"), dict)}
        for stage_id, group in sorted(groups):
            response = await self.flow.post(f"/api/tournaments/{self.tid}/stages/{stage_id}/draw",
                                            json={"group": group})
            assert response.status_code == 200, (group, response.text)
        if groups:
            await self.after_step("Jetzt auslosen")
        return len(groups)

    async def after_step(self, label: str) -> None:
        await self.tick()
        await self.confirm_heat_plan()
        await self.check(label)

    async def call_ready(self, *, start: bool = True) -> list[dict]:
        """Wie die Helfer: an jeder freien Station „Als Nächstes“ aufrufen (und starten)."""
        called = []
        view = await self.queue()
        for row in view["stations"]:
            nxt = row.get("next")
            if row.get("running") or not nxt or not nxt.get("ready") or row.get("status") == "broken":
                continue
            if nxt.get("state") == "called" and not start:
                continue
            match = next(m for m in await self.matches() if m["id"] == nxt["match_id"])
            await self.call(self.station(row["id"]), match, start=start)
            await self.check(f"Aufruf {match['match_key']}")
            called.append(match)
        return called

    async def running(self) -> list[dict]:
        return sorted((row for row in await self.matches() if row.get("started_at") and row["status"] not in DONE
                       and not row.get("pending_result")), key=lambda row: row.get("started_at") or "")

    async def play_ready(self, rng: random.Random, *, hold: bool = False) -> int:
        await self.call_ready()
        played = 0
        for match in await self.running():
            order = seated(match)
            rng.shuffle(order)
            # Wer während des Laufs ausgetreten ist, steht hinten (die Anwesenden fahren ihn zu Ende).
            order.sort(key=lambda reg: (reg in self.absent, reg in self.removed))
            response = await self.enter(match, order, hold=hold, forfeit=self.absent & set(order))
            assert response.status_code == 200, f"{match['match_key']}: {response.text}\n{await self.state()}"
            played += 1
            await self.after_step(f"Ergebnis {match['match_key']}")
        return played

    async def play_to_end(self, rng: random.Random, *, limit: int = 60) -> None:
        for _ in range(limit):
            if all(row["status"] in DONE for row in await self.matches()):
                return
            if await self.play_ready(rng):
                continue
            await self.tick()
            if await self.draw_waiting() or await self.play_ready(rng):
                continue
            open_rows = [(row["match_key"], row["status"], len(seated(row))) for row in await self.matches()
                         if row["status"] not in DONE]
            raise AssertionError(f"Abend hängt - nichts mehr spielbar: {open_rows}")
        raise AssertionError("Abend endet nicht")

    # ------------------------------------------------------------------ Invarianten
    async def check(self, label: str) -> None:
        """Nach jedem Schritt: was am Abend nie passieren darf."""
        from services.competition_graph_validation import validate_competition_graph
        from services.competition_snapshot import build_structure_snapshot

        self.steps.append(label)
        rows = await self.matches()
        by_id = {row["id"]: row for row in rows}
        where = f"nach „{label}“"

        for match in rows:
            key = match["match_key"]
            if match["status"] == "cancelled":
                continue
            expected = [slot for slot in match["slots"] if slot.get("status") in {"filled", "pending"}]
            people = seated(match)
            if match["status"] not in DONE:
                # Laufgröße: Fahrer im Lauf und noch erwartete Plätze zusammen nie über der Laufgröße.
                assert len(expected) <= HEAT_SIZE, \
                    f"{where}: Lauf {key} erwartet {len(expected)} Fahrer (> {HEAT_SIZE})"
                # Was TV, Baum und App zeigen - jeden Platz, ``match_size`` als „N Spieler“ - bleibt die Laufgröße:
                # ruhende Plätze aus einem Zusammenlegen sind keine Plätze, sondern Merkposten (``dormant_slots``).
                assert len(match["slots"]) <= HEAT_SIZE, f"{where}: Lauf {key} zeigt {len(match['slots'])} Plätze"
                assert int((match.get("settings") or {}).get("match_size") or 0) <= HEAT_SIZE, \
                    f"{where}: Lauf {key} hat Laufgröße {(match.get('settings') or {}).get('match_size')}"
                # Kein Lauf zum Aufrufen mit nur einem Fahrer, der nichts mehr erwartet.
                if match["status"] in {"ready", "scheduled", "in_progress"}:
                    assert len(expected) != 1, f"{where}: Lauf {key} wartet mit einem einzigen Fahrer"
            else:
                assert len(match.get("results") or []) <= HEAT_SIZE, f"{where}: Lauf {key} zu groß gewertet"
            assert len(people) == len(set(people)), f"{where}: {key} hat jemanden doppelt"
            # Verwaiste Weiterleitungen: jede zeigt auf einen Lauf und Platz, den es gibt; in einen abgesagten Lauf nur,
            # wenn dieser Platz gar nicht vorkommen kann (zwei Fahrer, beide weiter: kein Verlierer-Platz).
            # Wer noch weiterkommen kann: Ausgeschiedene nicht, auf dem Sieger-Weg auch nicht, wer nicht erschienen ist.
            present = [row for row in match.get("results") or [] if row["registration_id"] not in self.removed]
            drivers = len(present) if match["status"] in DONE else len(expected)
            winners = len([row for row in present if not row.get("forfeit")]) if match["status"] in DONE else drivers
            settings = match.get("settings") or {}
            quota = int(match.get("qualifiers_effective") or settings.get("qualifiers_per_match") or 0)
            for forward in match.get("advancement") or []:
                target = by_id.get(forward.get("to_match_id"))
                assert target, f"{where}: {key} leitet ins Leere ({forward})"
                rank = int(forward.get("rank") or 0)
                if target["status"] == "cancelled":
                    winner = forward.get("flow") == "W"
                    reachable = rank <= min(quota, winners) if winner else quota + rank <= drivers
                    place, gone = f"{forward.get('flow')}{rank}", target["match_key"]
                    assert not reachable, f"{where}: {key} schickt Platz {place} in den abgesagten Lauf {gone}"
                    continue
                slot = next((s for s in target["slots"] if s.get("slot") == forward.get("to_slot")), None)
                assert slot, f"{where}: {key} leitet auf einen Platz in {target['match_key']}, den es nicht gibt"
            # Ausgeschiedene sitzen in keinem Lauf, der noch nicht aufgerufen ist.
            if match["status"] not in DONE and not match.get("called_at") and not match.get("started_at"):
                assert not set(people) & self.removed, f"{where}: Ausgeschiedene in {key}"

        ready_seats = Counter(reg for row in rows if row["status"] in {"ready", "scheduled"} for reg in seated(row))
        doubled = [reg for reg, count in ready_seats.items() if count > 1]
        assert not doubled, f"{where}: zugleich in zwei offenen Läufen: {doubled}"

        report = validate_competition_graph(build_structure_snapshot(self.tid, stage_matches=rows))
        errors = [issue for issue in report["issues"] if issue.get("severity") == "error"]
        assert report["valid"] and not errors, f"{where}: Graph ungültig: {errors}"

        stations = await self.flow.db.stations.find({"tournament_id": self.tid}, {"_id": 0}).to_list(50)
        held = Counter(row.get("current_match_id") for row in stations if row.get("current_match_id"))
        assert all(count == 1 for count in held.values()), f"{where}: ein Spiel an zwei Stationen"
        for row in stations:
            current = by_id.get(row.get("current_match_id") or "")
            if current:
                assert current["status"] not in DONE, f"{where}: {row['name']} hält das fertige {current['match_key']}"

        doc = await self.stored()
        assert not doc.get("heat_rebuild_incomplete"), f"{where}: Lauf-Umbau hängt: {doc['heat_rebuild_incomplete']}"

        # Die Warteschlange nennt in den offenen Läufen jede Person höchstens einmal.
        if doc.get("status") == "live":
            view = await self.queue()
            names = Counter(name for entry in (view.get("matches") or {}).values() if entry["state"] != "running"
                            for name in entry.get("names") or [])
            assert not [name for name, count in names.items() if count > 1], f"{where}: Warteschlange doppelt {names}"

    async def check_end(self) -> dict:
        """Ende des Abends: genau ein Finale, ein Sieger, nichts hängt."""
        rows = await self.matches()
        open_rows = [row["match_key"] for row in rows if row["status"] not in DONE]
        assert not open_rows, f"am Ende noch offen: {open_rows}"
        finals = [row for row in rows
                  if row["status"] == "completed" and not row.get("advancement") and not auto_bye(row)]
        assert len(finals) == 1, f"genau ein Finale: {[(row['match_key'], row.get('round')) for row in finals]}"
        final = finals[0]
        assert 2 <= len(final["results"]) <= HEAT_SIZE
        assert final["results"][0]["registration_id"] not in self.removed, "ein Ausgeschiedener gewinnt nie"
        for row in rows:
            if row["status"] == "completed" and not auto_bye(row):
                assert len(row["results"]) >= 2, f"{row['match_key']} mit {len(row['results'])} Fahrer gefahren"
        doc = await self.stored()
        assert not doc.get("heat_rebuild_pending"), f"Lauf-Umbau eingereiht: {doc['heat_rebuild_pending']}"
        assert not doc.get("heat_rebuild_incomplete"), f"Lauf-Umbau unvollständig: {doc['heat_rebuild_incomplete']}"
        assert not doc.get("heat_rebuild_plan"), "ein Vorschlag „Läufe umbauen“ liegt noch offen"
        assert not doc.get("participant_removal_plan"), "ein Umbauplan Austritt/Disqualifikation liegt noch offen"
        stations = await self.flow.db.stations.find({"tournament_id": self.tid}, {"_id": 0}).to_list(50)
        assert not [row["name"] for row in stations if row.get("current_match_id")], "eine Station hält noch ein Spiel"
        return final


# ---------------------------------------------------------------------------------------------- Aufbau


async def event_evening(flow, *, title: str = "Kart-Cup 31.10.", registered: int = PLACES, waitlist: int = 1,
                        tree: str = "format", mode: str = "fixed", heat_rebuild_mode: str | None = None) -> Abend:
    """Event und Cup wie für den 31.10.: Event live, Cup im Event (vor Ort, nur Mitglieder, 16 Plätze, Läufe zu viert,
    die zwei Besten weiter), Vorschau-Baum, vier Stationen, ein Helfer, Anmeldungen und Warteliste."""
    lead = await flow.add_staff(name="Leitung Lea")
    helper = await flow.add_user(name="Helfer Hugo")
    flow.act_as(lead)
    game = {"id": new_id(), "name": "Mario Kart 8 Deluxe", "slug": f"mk8-{new_id()[:6]}", "setup_minutes": 3,
            "match_modes": [{"mode": "gp4", "label": "Grand Prix 4 Rennen", "minutes": 12, "per_game": False}]}
    await flow.db.games.insert_one(dict(game))
    if not await flow.db.seasons.find_one({"status": "active"}):
        await flow.db.seasons.insert_one({"id": new_id(), "name": "Saison 2026", "year": 2026, "status": "active",
                                          "start_date": "2026-01-01T00:00:00+00:00",
                                          "end_date": "2026-12-31T23:59:59+00:00"})
    now = now_utc()
    event = await flow.post("/api/events", json={
        "name": "Vereinsabend Generalprobe", "status": "live", "visibility": "public", "location": "Vereinsheim",
        "start_date": iso(now - timedelta(hours=1)), "end_date": iso(now + timedelta(hours=8)),
        "discord_skip": True, "discord_registration": False})
    assert event.status_code == 200, event.text
    event = event.json()
    cup = await flow.post(f"/api/events/{event['id']}/tournaments", json={
        "title": title, "game_id": game["id"], "status": "registration_open",
        "start_date": iso(now - timedelta(minutes=5)), "end_date": iso(now + timedelta(hours=7)),
        "registration_open_from": iso(now - timedelta(hours=1)), "check_in_from": iso(now - timedelta(minutes=30)),
        "max_participants": PLACES, "visibility": "members", "format": "ffa_custom_bracket", "event_mode": "local",
        "schedule_mode": "fixed_by_staff", "result_entry_mode": "staff_only", "advancement_mode": mode,
        "draw_show_minutes": SHOW_MINUTES, "no_show_minutes_on_site": 10,
        "prize_places": [{"group": "overall", "place": 1, "label": "1. Platz", "value": "Pokal"}],
        **({"heat_rebuild_mode": heat_rebuild_mode} if heat_rebuild_mode else {}),
    })
    assert cup.status_code == 200, cup.text
    cup = cup.json()
    settings = {"match_size": HEAT_SIZE, "qualifiers_per_match": QUOTA, "min_players": 2}
    if TREES[tree]:
        settings["schema"] = TREES[tree]
    built = await flow.post(f"/api/tournaments/{cup['id']}/bracket/from-format?preview=true", json={
        "name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa", "settings": settings})
    assert built.status_code == 200, built.text
    stations = []
    for index in range(1, 5):
        response = await flow.post("/api/stations", json={"name": f"Station {index}", "device_type": "switch2",
                                                          "tournament_id": cup["id"]})
        assert response.status_code in (200, 201), response.text
        stations.append(response.json())
    staff = await flow.post(f"/api/tournaments/{cup['id']}/staff", json={"user_id": helper["id"], "role": "referee"})
    assert staff.status_code in (200, 201), staff.text
    for index in range(registered + waitlist):
        user = await flow.add_user(name=NAMES[index])
        response = await flow.post(f"/api/tournaments/{cup['id']}/registrations", json={
            "user_id": user["id"], "display_name": user["display_name"],
            "status": "approved" if index < registered else "waitlist", "seed": index + 1})
        assert response.status_code == 200, response.text
    return Abend(flow, lead=lead, helper=helper, event=event, tournament=cup, stations=stations)


async def check_in(abend: Abend, rng: random.Random, *, present: int, late: int = 0) -> dict:
    """Check-in vor Ort: die Leitung öffnet ihn, der Helfer am Einlass checkt ein. Wer nicht kommt, wird „nicht
    erschienen“ - beim ersten rückt die Warteliste nach (und ist da). ``late`` kommen erst nach dem Check-in-Ende.
    Danach sind ``present`` Fahrer im Baum."""
    flow = abend.flow
    flow.act_as(abend.lead)
    opened = await flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": "check_in"})
    assert opened.status_code == 200, opened.text
    approved = [row for row in (await abend.registrations()).values() if row["status"] == "approved"]
    rng.shuffle(approved)
    cut = present - 1
    here, late_ones, absent = approved[:cut], approved[cut:cut + late], approved[cut + late:]
    flow.act_as(abend.helper)
    for row in here:
        response = await flow.post(f"/api/tournaments/{abend.tid}/registrations/{row['id']}/checkin",
                                   json={"status": "checked_in"})
        assert response.status_code == 200, response.text
    moved_up = []
    for row in absent:
        response = await flow.post(f"/api/tournaments/{abend.tid}/registrations/{row['id']}/checkin",
                                   json={"status": "no_show"})
        assert response.status_code == 200, response.text
        moved_up += response.json()["waitlist_moved_up"]
    assert len(moved_up) == 1, "die Warteliste rückt beim ersten Nicht-Erschienenen nach"
    response = await flow.post(f"/api/tournaments/{abend.tid}/registrations/{moved_up[0]}/checkin",
                               json={"status": "checked_in"})
    assert response.status_code == 200, response.text
    # Check-in-Ende zur eingestellten Zeit: der Server baut den festen Baum aus den Eingecheckten.
    await flow.db.tournaments.update_one({"id": abend.tid}, {"$set": {
        "check_in_until": iso(now_utc() - timedelta(minutes=1))}})
    assert await scheduler._close_due_checkins(flow.db, datetime.now(timezone.utc)) == 1
    await abend.check("Check-in-Ende")
    await abend.confirm_heat_plan()
    await abend.check("Läufe nach dem Check-in")
    in_tree = {reg for row in await abend.matches() for reg in seated(row)}
    assert len(in_tree) == present, f"{len(in_tree)} statt {present} Fahrer im Baum"
    return {"late": late_ones, "absent": absent}


async def let_late_in(abend: Abend, late_ones: list[dict]) -> list[dict]:
    """Nachzügler nach dem Check-in-Ende: der Helfer checkt ein. Gibt es einen freien Platz (Freilos), sitzt er im Baum;
    sonst sagt die Antwort „kein freier Platz“ - dann baut die Leitung das Feld vor dem ersten Start neu auf."""
    placements = []
    for row in late_ones:
        abend.flow.act_as(abend.helper)
        response = await abend.flow.post(f"/api/tournaments/{abend.tid}/registrations/{row['id']}/checkin",
                                         json={"status": "checked_in"})
        assert response.status_code == 200, response.text
        placements.append(response.json().get("placement") or {})
        await abend.after_step(f"Nachzügler {row['display_name']}")
    if any(not placement.get("ok") for placement in placements):
        assert all(placement.get("reason") == "no_free_place" for placement in placements if not placement.get("ok"))
        abend.flow.act_as(abend.lead)
        rebuilt = await abend.flow.post(f"/api/tournaments/{abend.tid}/bracket/from-format?preview=false&force=true")
        assert rebuilt.status_code == 200, rebuilt.text
        await abend.after_step("Feld neu aufbauen")
    in_tree = {reg for row in await abend.matches() for reg in seated(row)}
    assert {row["id"] for row in late_ones} <= in_tree, "jeder Nachzügler fährt mit"
    return placements


async def go_live(abend: Abend) -> None:
    abend.flow.act_as(abend.lead)
    response = await abend.flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": "live", "force": True})
    assert response.status_code == 200, response.text
    assert (await abend.stored())["status"] == "live"
    await abend.after_step("Turnier starten")


async def tv_keys(abend: Abend) -> tuple[str, str]:
    abend.flow.act_as(abend.lead)
    tournament_key = await abend.flow.post("/api/tv/keys", json={"tournament_id": abend.tid, "label": "Beamer Baum"})
    assert tournament_key.status_code == 200, tournament_key.text
    event_key = await abend.flow.post("/api/tv/keys", json={"event_id": abend.event["id"], "label": "Aufruf-Tafel"})
    assert event_key.status_code == 200, event_key.text
    return tournament_key.json()["token"], event_key.json()["token"]


async def look_at_tv(abend: Abend, tournament_key: str, event_key: str, label: str) -> None:
    """Die Bildschirme ohne Anmeldung, nur mit Schlüssel: Baum, Warteschlange, Hallen- und Aufruf-Tafel."""
    flow = abend.flow
    flow.act_as(None)
    tree = await flow.get(f"/api/tournaments/{abend.tid}/bracket/display", params={"key": tournament_key})
    assert tree.status_code == 200, f"{label}: {tree.text}"
    queue = await flow.get(f"/api/tournaments/{abend.tid}/live-queue", params={"key": tournament_key})
    assert queue.status_code == 200, f"{label}: {queue.text}"
    hall = await flow.get(f"/api/events/{abend.event['id']}/display", params={"key": event_key})
    assert hall.status_code == 200, f"{label}: {hall.text}"
    shown = {row["id"] for row in hall.json()["event"]["tournaments"]}
    assert abend.tid in shown, f"{label}: der Cup „Nur Mitglieder“ fehlt an der Hallen-Tafel"
    text = tree.text + queue.text + hall.text
    assert "user_id" not in text and "email" not in text, f"{label}: Konten am TV"
    called = [row for row in await abend.matches() if row.get("called_at") and row["status"] not in DONE]
    for match in called:
        station = next((row for row in hall.json()["stations"] if row.get("current_match_id") == match["id"]), None)
        assert station, f"{label}: Aufruf {match['match_key']} fehlt an der Aufruf-Tafel"


# ---------------------------------------------------------------------------------------------- Der Abend


async def stoerungen_runde_1(abend: Abend, rng: random.Random) -> None:
    """Runde 1 mit allem, was am Abend schiefgehen kann."""
    first, second = abend.stations[0], abend.stations[1]
    called = await abend.call_ready(start=False)
    assert len(called) >= 2, "mindestens zwei Läufe gleich aufrufbar"
    held_by = {row["station_id"]: row for row in [await abend.reload(m) for m in called]}

    # Aufruf zurücknehmen: Station 1 freigeben - der Lauf ist wieder „als Nächstes“, der Aufruf weg.
    taken_back = held_by[first["id"]]
    abend.flow.act_as(abend.helper)
    cleared = await abend.flow.post(f"/api/stations/{first['id']}/clear")
    assert cleared.status_code == 200, cleared.text
    assert not (await abend.reload(taken_back)).get("called_at"), "Aufruf zurückgenommen"
    await abend.after_step("Aufruf zurücknehmen")

    # Station wechseln: der Lauf an Station 2 wandert an Station 1 (Station 2 hat ein Problem).
    moved = held_by[second["id"]]
    abend.flow.act_as(abend.lead)
    patched = await abend.flow.patch(f"/api/matches/{moved['id']}", json={"station_id": first["id"]})
    assert patched.status_code == 200, patched.text
    assert (await abend.flow.db.stations.find_one({"id": second["id"]}))["current_match_id"] is None
    await abend.after_step("Station wechseln")

    # Weiter: der zurückgenommene Lauf an Station 2, der gewechselte an Station 1, die anderen starten.
    await abend.call(second, await abend.reload(taken_back))
    await abend.call(first, await abend.reload(moved))
    for row in called:
        fresh = await abend.reload(row)
        if not fresh.get("started_at"):
            await abend.call(abend.station(fresh["station_id"]), fresh)
    await abend.check("Läufe gestartet")

    # „Rückgängig“: eingetragen und sofort zurück - nichts rückt weiter.
    heat = await abend.reload(taken_back)
    held = await abend.enter(heat, seated(heat), hold=True)
    assert held.status_code == 200, held.text
    abend.flow.act_as(abend.helper)
    undone = await abend.flow.post(f"/api/matches/{heat['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    assert (await abend.reload(heat))["status"] not in DONE
    await abend.after_step("Rückgängig")

    # Zwei Stationen melden gleichzeitig (Helfer und Leitung).
    others = [row for row in await abend.running() if row["id"] not in {taken_back["id"], moved["id"]}]
    pair = [await abend.reload(m) for m in [moved, *others][:2]]
    results = await asyncio.gather(*[abend.enter(m, seated(m), as_user=user)
                                     for m, user in zip(pair, (abend.helper, abend.lead))])
    assert [r.status_code for r in results] == [200] * len(pair), [r.text for r in results]
    await abend.after_step("zwei Meldungen gleichzeitig")

    # Ergebnis korrigieren: im gemeldeten Lauf mit mindestens drei Fahrern Platz 2 und 3 tauschen.
    fix = next((m for m in pair if len(seated(m)) >= 3), None)
    fix = await abend.reload(fix) if fix else None
    if fix:
        order = [row["registration_id"] for row in fix["results"]]
        swapped = [order[0], order[2], order[1], *order[3:]]
        corrected = await abend.enter(fix, swapped, as_user=abend.lead, force=True, reason="Zielfoto geprüft")
        assert corrected.status_code == 200, corrected.text
        await abend.after_step("Ergebnis korrigiert")
        fresh = await abend.reload(fix)
        assert [row["registration_id"] for row in fresh["results"]] == swapped
        assert fresh["result_meta"].get("correction_reason") == "Zielfoto geprüft"

    # Der zurückgenommene Lauf: eingetragen, der Letzte „nicht erschienen“ (bei drei und mehr Fahrern).
    heat = await abend.reload(taken_back)
    order = seated(heat)
    response = await abend.enter(heat, order, forfeit={order[-1]} if len(order) >= 3 else set())
    assert response.status_code == 200, response.text
    await abend.after_step("Ergebnis mit nicht erschienen")

    # Austritt eines Fahrers aus einem gefahrenen Lauf: der Zweite aus ``fix`` geht - der Dritte rückt nach.
    played = await abend.reload(fix or pair[0])
    ranking = [row["registration_id"] for row in played["results"] if not row.get("forfeit")]
    leaver = ranking[1] if len(ranking) >= 3 else ranking[-1]
    plan = await abend.remove(leaver, "withdrawn", "muss früher heim")
    assert plan["summary"], "der Umbauplan sagt in Worten, was passiert"
    await abend.after_step("Austritt nach gefahrenem Lauf")
    if len(ranking) >= 3 and abend.t.get("advancement_mode") != "draw_show":
        onward = {slot["registration_id"] for row in await abend.matches() if row["status"] not in DONE
                  for slot in row["slots"] if (slot.get("source_result") or {}).get("from_match_id") == played["id"]
                  and (slot.get("source_result") or {}).get("flow") == "W"}
        assert leaver not in onward, "wer ausgetreten ist, rückt nirgends ein"
        assert ranking[2] in onward or played.get("qualifiers_effective") == 1, "der Dritte rückt nach"

    await abend.play_ready(rng)


async def stoerungen_spaeter(abend: Abend, rng: random.Random) -> None:
    """Später am Abend: Disqualifikation eines Wartenden, Austritt im laufenden Lauf."""
    await abend.tick(draw_timeout=True)  # Show-Auslosung: einmal lost der Server nach der Frist selbst
    await abend.check("Auslosung nach der Frist")
    waiting = [row for row in await abend.matches() if row["status"] in {"ready", "scheduled", "pending"}
               and not row.get("called_at") and seated(row)]
    if waiting:
        await abend.remove(seated(waiting[0])[0], "disqualified", "Unsportliches Verhalten")
        await abend.after_step("Disqualifikation")
    started = await abend.call_ready()
    big = next((m for m in [await abend.reload(m) for m in started] if len(seated(m)) >= 3), None)
    if big:
        leaver = seated(big)[-1]
        await abend.remove(leaver, "withdrawn", "Zug fährt")
        assert leaver in seated(await abend.reload(big)), "der laufende Lauf bleibt, wie er ist"
        await abend.after_step("Austritt im laufenden Lauf")


async def finish_and_publish(abend: Abend, final: dict) -> None:
    """Beendet, veröffentlicht: Jahreswertung für alle, die gefahren sind, der Sieger vorne, Ausgeschiedene und Nicht-
    Erschienene ohne Punkte; Protokoll lückenlos; bei der Turnierleitung ist nichts mehr offen."""
    flow = abend.flow
    flow.act_as(abend.lead)
    for status in ("completed", "results_published"):
        response = await flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": status})
        assert response.status_code == 200, response.text
    regs = await abend.registrations()
    points = await flow.db.season_points.find({"source_id": abend.tid}, {"_id": 0}).to_list(200)
    by_user = {row["user_id"]: row for row in points}
    champion = regs[final["results"][0]["registration_id"]]["user_id"]
    assert champion in by_user, "der Sieger bekommt Punkte für die Jahreswertung"
    best = max(row["total_points"] for row in points)
    assert by_user[champion]["total_points"] == best, "der Sieger hat die meisten Punkte"
    assert not {regs[reg]["user_id"] for reg in abend.removed} & set(by_user), "Ausgeschiedene ohne Punkte"
    assert not {row["user_id"] for row in regs.values() if row["status"] == "no_show"} & set(by_user)

    audit = await flow.db.audit_logs.find({}, {"_id": 0}).to_list(5000)
    played = [row for row in await abend.matches() if row["status"] == "completed" and not auto_bye(row)]
    logged = {(row.get("data") or {}).get("match_id") for row in audit if str(row["action"]).startswith("match.result")}
    assert not [row["match_key"] for row in played if row["id"] not in logged], "Ergebnis ohne Protokoll"
    started = {(row.get("data") or {}).get("match_id") for row in audit if row["action"] == "match.started"}
    assert not [row["match_key"] for row in played if row.get("started_at") and row["id"] not in started]
    actions = Counter(row["action"] for row in audit)
    assert actions["tournament.status.change"] >= 4
    assert actions["tournament.registration.checkin_status"] >= 9

    lead = await flow.get(f"/api/tournaments/{abend.tid}/lead")
    assert lead.status_code == 200, lead.text
    assert not lead.json().get("attention"), f"nach dem Ende ist noch etwas offen: {lead.json().get('attention')}"
    assert not await flow.db.notifications.count_documents({"kind": "tournament_heat_rebuild",
                                                           "title": "Lauf-Umbau wartet", "read": {"$ne": True}})


def evening_cases():
    return [pytest.param(tree, mode, present, id=f"{tree}-{mode}-{present}")
            for tree in ("format", "lb") for mode in ("fixed", "instant", "draw_show") for present in (9, 10)]


@pytest.mark.asyncio
@pytest.mark.parametrize("tree,mode,present", evening_cases())
async def test_abend_16_plaetze_9_oder_10_kommen(flow, seeded_draw, tree, mode, present):
    """16 Anmeldungen und einer auf der Warteliste, es kommen 9 bzw. 10 (der Rest nicht erschienen), einer davon erst
    nach dem Check-in-Ende. Dann der ganze Abend mit Störungen bis zum Sieger; das Feld fällt auf 7 bzw. 8."""
    rng = random.Random(seeded_draw.random())
    abend = await event_evening(flow, tree=tree, mode=mode)
    checkin = await check_in(abend, rng, present=present - 1, late=1)
    regs = await abend.registrations()
    assert sum(row["status"] == "no_show" for row in regs.values()) == PLACES + 1 - present
    rounds = Counter(row.get("round") for row in await abend.matches() if row["status"] != "cancelled")
    assert rounds, "ein Baum steht"
    await let_late_in(abend, checkin["late"])
    first_round = [row for row in await abend.matches() if row.get("round") == 1 and row["status"] != "cancelled"]
    assert all(2 <= len(seated(row)) <= HEAT_SIZE for row in first_round if not auto_bye(row)), \
        [(row["match_key"], len(seated(row))) for row in first_round]

    await go_live(abend)
    tournament_key, event_key = await tv_keys(abend)
    await stoerungen_runde_1(abend, rng)
    await look_at_tv(abend, tournament_key, event_key, "nach Runde 1")
    await stoerungen_spaeter(abend, rng)
    await look_at_tv(abend, tournament_key, event_key, "später am Abend")
    await abend.play_to_end(rng)
    final = await abend.check_end()
    await finish_and_publish(abend, final)


# ---------------------------------------------------------------------------------------------- Baum vor dem Check-in


@pytest.mark.asyncio
@pytest.mark.parametrize("tree,way", [(tree, way) for tree in ("format", "lb")
                                      for way in ("austritt", "neu_aufbauen", "im_lauf")])
async def test_baum_steht_vor_dem_checkin_dann_fehlen_sechs(flow, seeded_draw, tree, way):
    """Der Baum ist schon fest (die Leitung startet, bevor klar ist, wer kommt): 16 Plätze, 6 fehlen. Drei Wege der
    Turnierleitung: je Person „Austritt“ (Umbauplan mit Bestätigung), „Feld neu aufbauen“ vor dem ersten Start, oder
    gar nichts tun und im Lauf „nicht erschienen“ setzen. Jeder Weg führt ohne Hängen zu einem Sieger."""
    rng = random.Random(seeded_draw.random())
    abend = await event_evening(flow, tree=tree, waitlist=0)
    abend.flow.act_as(abend.lead)
    response = await abend.flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": "live", "force": True})
    assert response.status_code == 200, response.text
    assert len({reg for row in await abend.matches() for reg in seated(row)}) == PLACES
    await abend.check("Baum mit 16 fest")
    regs = list((await abend.registrations()).values())
    rng.shuffle(regs)
    absent = regs[:6]
    abend.flow.act_as(abend.helper)
    for row in absent:
        marked = await abend.flow.post(f"/api/tournaments/{abend.tid}/registrations/{row['id']}/checkin",
                                       json={"status": "no_show"})
        assert marked.status_code == 200, marked.text
    if way == "austritt":
        for row in absent:
            await abend.remove(row["id"], "withdrawn", "nicht gekommen")
            await abend.after_step(f"Austritt {row['display_name']}")
    elif way == "neu_aufbauen":
        abend.flow.act_as(abend.lead)
        rebuilt = await abend.flow.post(f"/api/tournaments/{abend.tid}/bracket/from-format?preview=false&force=true")
        assert rebuilt.status_code == 200, rebuilt.text
        assert rebuilt.json()["participant_count"] == PLACES - 6
        await abend.after_step("Feld neu aufbauen")
        assert not {row["id"] for row in absent} & {reg for row in await abend.matches() for reg in seated(row)}
    else:
        abend.absent = {row["id"] for row in absent}
    await abend.play_to_end(rng)
    final = await abend.check_end()
    finalists = {row["registration_id"] for row in final["results"] if not row.get("forfeit")}
    assert not {row["id"] for row in absent} & finalists, "wer fehlt, fährt nicht im Finale"


# ---------------------------------------------------------------------------------------------- Nebenfall: großes Feld


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["fixed", "instant"])
async def test_nebenfall_grosses_feld(flow, seeded_draw, mode, monkeypatch):
    """Nebenfall: 24 Plätze, 22 kommen (einer davon nach dem Check-in-Ende), derselbe Abend mit Störungen."""
    monkeypatch.setattr(sys.modules[__name__], "PLACES", 24)
    rng = random.Random(seeded_draw.random())
    abend = await event_evening(flow, registered=24, mode=mode)
    checkin = await check_in(abend, rng, present=21, late=1)
    await let_late_in(abend, checkin["late"])
    await go_live(abend)
    await stoerungen_runde_1(abend, rng)
    await stoerungen_spaeter(abend, rng)
    await abend.play_to_end(rng)
    final = await abend.check_end()
    await finish_and_publish(abend, final)


# ---------------------------------------------------------------------------------------------- Laufgröße für 7-12


@pytest.mark.parametrize("count", range(7, 13))
def test_laeufe_zu_viert_zwei_weiter_passen_fuer_kleine_felder(count):
    """Vorgabe Läufe zu viert, die zwei Besten weiter: für 7-12 Fahrer ein Baum ohne Lauf mit einem Fahrer, ohne Lauf
    über der Laufgröße, Läufe einer Runde höchstens um einen Fahrer verschieden, genau ein Finale mit höchstens vier."""
    from services.custom_bracket import ffa_heat_plan

    levels = ffa_heat_plan(count, HEAT_SIZE, QUOTA)
    assert levels[-1] and len(levels[-1]) == 1 and levels[-1][0][0] <= HEAT_SIZE
    for level in levels:
        sizes = [size for size, _quota in level]
        assert min(sizes) >= 2 and max(sizes) <= HEAT_SIZE and max(sizes) - min(sizes) <= 1, (count, levels)
    assert len(levels) <= 3, f"{count} Fahrer: {len(levels)} Runden"


# ---------------------------------------------------------------------------------------------- Fast Lap am Simulator


@pytest.mark.asyncio
async def test_fast_lap_am_abend_mit_gaesten_versuchen_und_jahreswertung(flow):
    """Fast Lap im Event: Helfer am Simulator, Gäste ohne Konto und Mitglieder, „Am Start / Als Nächstes“, drei Versuche
    (eine ungültige Runde zählt mit, der vierte Versuch geht nicht), Rangliste ohne Anmeldung, Veröffentlichen:
    Jahreswertung nur für Konten, der Schnellste vorne."""
    abend = await event_evening(flow, registered=0, waitlist=0)
    lead, helper = abend.lead, abend.helper
    flow.act_as(lead)
    now = now_utc()
    created = await flow.post(f"/api/events/{abend.event['id']}/fastlaps", json={
        "title": "Fast Lap Generalprobe", "status": "live", "visibility": "public", "max_attempts": 3,
        "start_date": iso(now - timedelta(hours=1)), "end_date": iso(now + timedelta(hours=6))})
    assert created.status_code == 200, created.text
    cid = created.json()["id"]
    assert (await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "live"})).status_code == 200
    track = await flow.post(f"/api/f1/challenges/{cid}/tracks",
                            json={"name": "Spielberg", "country": "Österreich", "order_index": 0})
    assert track.status_code == 200, track.text
    tid = track.json()["id"]
    staff = await flow.post(f"/api/f1/challenges/{cid}/staff", json={"user_id": helper["id"], "role": "scorekeeper"})
    assert staff.status_code == 200, staff.text

    members = [await flow.add_user(name=name) for name in ("Pole-Pepe", "Reifen-Rosa")]
    flow.act_as(helper)
    guest = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": "Gast Gundi"})
    assert guest.status_code == 200, guest.text
    guest = guest.json()
    drivers = [{"user_id": members[0]["id"]}, {"user_id": members[1]["id"]}, {"guest_id": guest["id"]}]
    times = {0: [84_512, 83_990], 1: [85_100], 2: [83_101]}
    for index, who in enumerate(drivers):
        entry = await flow.post(f"/api/f1/challenges/{cid}/queue",
                                json={**who, "track_id": tid, "station": "Simulator 1"})
        assert entry.status_code == 200, entry.text
        started = await flow.post(f"/api/f1/queue/{entry.json()['id']}/start", json={"station": "Simulator 1"})
        assert started.status_code == 200, started.text
        for time_ms in times[index]:
            lap = await flow.post(f"/api/f1/challenges/{cid}/times", json={**who, "track_id": tid, "time_ms": time_ms})
            assert lap.status_code == 200, lap.text
        done = await flow.delete(f"/api/f1/queue/{entry.json()['id']}")
        assert done.status_code == 200, done.text
    # Dritter Versuch ungültig (Strecke verlassen) - zählt mit; der vierte geht nicht mehr.
    invalid = await flow.post(f"/api/f1/challenges/{cid}/times", json={
        **drivers[0], "track_id": tid, "time_ms": 0, "is_invalid": True, "admin_note": "Strecke verlassen"})
    assert invalid.status_code == 200, invalid.text
    fourth = await flow.post(f"/api/f1/challenges/{cid}/times", json={**drivers[0], "track_id": tid, "time_ms": 82_000})
    assert fourth.status_code == 400 and "Versuche" in fourth.json()["detail"]

    flow.act_as(None)
    board = await flow.get(f"/api/f1/challenges/{cid}/leaderboard", params={"track_id": tid})
    assert board.status_code == 200, board.text
    entries = board.json()["entries"]
    assert [row["display_name"] for row in entries] == ["Gast Gundi", "Pole-Pepe", "Reifen-Rosa"]
    assert entries[0]["is_guest"] is True and entries[0]["rank"] == 1

    flow.act_as(lead)
    published = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "results_published"})
    assert published.status_code == 200, published.text
    points = await flow.db.season_points.find({"source_type": "fastlap"}, {"_id": 0}).to_list(20)
    by_user = {row["user_id"]: row for row in points}
    assert set(by_user) == {members[0]["id"], members[1]["id"]}, "Jahreswertung nur für Konten, nie für Gäste"
    assert by_user[members[0]["id"]]["rank"] == 1, "unter den Konten ist Pole-Pepe der Schnellste"
    assert by_user[members[0]["id"]]["total_points"] > by_user[members[1]["id"]]["total_points"]


# ------------------------------------------------------------------------------------ Befunde, fest nachgestellt


@pytest.mark.asyncio
async def test_befund_loser_bracket_ausgleich_nach_austritten_vor_dem_start(flow):
    """Nachgestellt (#2045): Loser-Bracket-Cup, Baum mit 16 fest. Aus Lauf B treten drei aus (einer bleibt): der Umbau
    gleicht A und B auf 3 und 2 Plätze aus. Das Ergebnis von A muss sich eintragen lassen und die Verlierer kommen ins
    Loser Bracket."""
    abend = await event_evening(flow, tree="lb", waitlist=0)
    abend.flow.act_as(abend.lead)
    response = await abend.flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": "live", "force": True})
    assert response.status_code == 200, response.text
    heat_b = (await abend.by_key())["B"]
    for reg in seated(heat_b)[1:]:
        await abend.remove(reg, "withdrawn", "nicht gekommen")
        await abend.after_step("Austritt aus B")
    by_key = await abend.by_key()
    assert sorted([len(seated(by_key["A"])), len(seated(by_key["B"]))]) == [2, 3], await abend.state()
    for key in ("A", "B"):
        heat = (await abend.by_key())[key]
        response = await abend.enter(heat, seated(heat), as_user=abend.lead)
        assert response.status_code == 200, f"{key}: {response.text}\n{await abend.state()}"
        await abend.after_step(f"Ergebnis {key}")


@pytest.mark.asyncio
async def test_befund_loser_bracket_verlierer_des_sammellaufs_fahren_keine_zweite_chance(flow):
    """Nachgestellt (#2044): Loser-Bracket-Cup mit 16 Plätzen, es checken 10 ein (Sitzplätze 1-10). Nach dem
    Check-in-Ende und dem Zusammenlegen von C und D müssen die Verlierer des Sammellaufs C im Loser Bracket
    weiterfahren."""
    abend = await event_evening(flow, tree="lb", waitlist=0)
    abend.flow.act_as(abend.lead)
    opened = await abend.flow.post(f"/api/tournaments/{abend.tid}/status", json={"status": "check_in"})
    assert opened.status_code == 200, opened.text
    regs = sorted((await abend.registrations()).values(), key=lambda row: row["seed"])
    abend.flow.act_as(abend.helper)
    for row in regs:
        status = "checked_in" if row["seed"] <= 10 else "no_show"
        response = await abend.flow.post(f"/api/tournaments/{abend.tid}/registrations/{row['id']}/checkin",
                                         json={"status": status})
        assert response.status_code == 200, response.text
    await abend.flow.db.tournaments.update_one({"id": abend.tid}, {"$set": {
        "check_in_until": iso(now_utc() - timedelta(minutes=1))}})
    assert await scheduler._close_due_checkins(abend.flow.db, datetime.now(timezone.utc)) == 1
    await abend.confirm_heat_plan()
    await go_live(abend)
    collector = (await abend.by_key())["C"]
    assert len(seated(collector)) == 4, await abend.state()
    order = seated(collector)
    response = await abend.enter(collector, order, as_user=abend.lead)
    assert response.status_code == 200, response.text
    await abend.tick()
    second_chance = [row for row in await abend.matches() if row.get("section") == "LB" and row["status"] != "cancelled"
                     and set(order[2:]) & set(seated(row))]
    assert second_chance, f"die Verlierer von C fahren im Loser Bracket weiter\n{await abend.state()}"
