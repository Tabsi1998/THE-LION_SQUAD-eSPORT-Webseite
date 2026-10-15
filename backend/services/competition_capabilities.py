"""Inventory of everything a tournament can do today, and in which engine.

This file exists for one reason: the platform runs two competition write models
side by side (``classic`` on ``matches``, ``graph`` on ``matches_v2``), and they
are supposed to become one. During that consolidation the honest question after
every step is "did anything a user could do yesterday stop working today?".

An inventory answers that question only if it is checked by a test rather than
maintained by good intentions, so ``test_tournament_capability_inventory.py``
verifies three things against the running application:

  * every endpoint listed here still exists,
  * every endpoint of the competition routers appears in exactly one capability,
  * the engine support recorded here matches what is actually wired up.

That makes the file fail loudly when a route is removed, when a new one is added
without being classified, and when a gap is closed - the last one on purpose:
closing a gap should require saying so here.
"""
from __future__ import annotations

from dataclasses import dataclass, field


CLASSIC = "classic"
GRAPH = "graph"
ENGINE_NEUTRAL = "neutral"


@dataclass(frozen=True)
class Capability:
    """One thing a member, staffer or admin can do with a competition."""

    key: str
    label: str
    endpoints: tuple[str, ...]
    engines: tuple[str, ...]
    note: str = ""
    gap: str = field(default="")

    @property
    def is_gap(self) -> bool:
        return bool(self.gap)


def _c(key, label, endpoints, engines, note="", gap=""):
    return Capability(key=key, label=label, endpoints=tuple(endpoints), engines=tuple(engines), note=note, gap=gap)


# Endpoints are written exactly as FastAPI reports them: "METHOD /full/path".
CAPABILITIES: tuple[Capability, ...] = (
    # ---------- Turnier-Lebenszyklus (engine-neutral) ----------
    _c("tournament.browse", "Turniere ansehen",
       ["GET /api/tournaments", "GET /api/tournaments/{slug_or_id}", "GET /api/tournaments/{slug_or_id}/streams"], [ENGINE_NEUTRAL]),
    _c("tournament.create", "Turnier anlegen",
       ["POST /api/tournaments"], [ENGINE_NEUTRAL]),
    _c("tournament.edit", "Turnier bearbeiten",
       ["PUT /api/tournaments/{tid}", "PATCH /api/tournaments/{tid}"], [ENGINE_NEUTRAL]),
    _c("tournament.delete", "Turnier löschen",
       ["DELETE /api/tournaments/{tid}"], [ENGINE_NEUTRAL]),
    _c("tournament.lock", "Turnier sperren und entsperren",
       ["POST /api/tournaments/{tid}/lock", "POST /api/tournaments/{tid}/unlock"], [ENGINE_NEUTRAL]),
    _c("tournament.status", "Turnierstatus wechseln",
       ["POST /api/tournaments/{tid}/status", "PUT /api/tournaments/{tid}/pause"], [ENGINE_NEUTRAL],
       note="Löst bei check_in und live zusätzlich Strukturarbeit aus. „Pause bis“ (#1123) gehört zum Status "
            "„Pausiert“ und lässt sich während der Pause ändern."),
    _c("tournament.round_sponsors", "Sponsor je Runde für den TV wählen",
       ["PUT /api/tournaments/{tid}/round-sponsors"], [ENGINE_NEUTRAL],
       note="„Runde 2 präsentiert von“ (#1125) - nur Sponsoren mit „TV / Anzeige“."),
    _c("tournament.chat", "Turnier-Chat",
       ["GET /api/tournaments/{tid}/chat", "POST /api/tournaments/{tid}/chat"], [ENGINE_NEUTRAL]),

    # ---------- Teilnahme ----------
    _c("registration.list", "Anmeldungen einsehen",
       ["GET /api/tournaments/{tid}/registrations", "GET /api/tournaments/{tid}/assignable-users"], [ENGINE_NEUTRAL]),
    _c("registration.self", "Selbst anmelden",
       ["POST /api/tournaments/{tid}/register"], [ENGINE_NEUTRAL]),
    _c("registration.manage", "Anmeldung anlegen, ändern, entfernen",
       ["POST /api/tournaments/{tid}/registrations",
        "PUT /api/tournaments/{tid}/registrations/{reg_id}",
        "PATCH /api/tournaments/{tid}/registrations/{reg_id}",
        "DELETE /api/tournaments/{tid}/registrations/{reg_id}"], [ENGINE_NEUTRAL]),
    _c("registration.checkin", "Check-in",
       ["POST /api/tournaments/{tid}/registrations/{reg_id}/checkin",
        "POST /api/tournaments/{tid}/checkin"], [ENGINE_NEUTRAL]),
    _c("staff.manage", "Turnier-Team verwalten",
       ["GET /api/tournaments/{tid}/staff", "POST /api/tournaments/{tid}/staff",
        "PATCH /api/tournaments/{tid}/staff/{assignment_id}",
        "PUT /api/tournaments/{tid}/staff/{assignment_id}",
        "DELETE /api/tournaments/{tid}/staff/{assignment_id}"], [ENGINE_NEUTRAL]),

    # ---------- Struktur erzeugen ----------
    _c("structure.from_format", "Struktur aus Format aufbauen",
       ["POST /api/tournaments/{tid}/bracket/from-format"], [GRAPH],
       note="Block 8: der klassische Generator-Endpunkt ist mit seiner Engine entfallen. "
            "Was er konnte, kann dieser hier - für jedes Format, das einen Generator hat."),
    _c("structure.reset", "Struktur zurücksetzen",
       ["POST /api/tournaments/{tid}/reset-bracket"], [CLASSIC, GRAPH]),
    _c("structure.plan_apply", "Struktur planen und anwenden",
       ["POST /api/tournaments/{tid}/bracket/plan", "POST /api/tournaments/{tid}/bracket/apply"], [GRAPH],
       note="Entscheidung aus Block 1: bleibt und wird in Block 4 der gemeinsame Schreibweg. "
            "Plant erst und zeigt dabei, wie viele Matches ein Umbau ersetzen würde - genau die "
            "Absicherung, die das Überführen des Bestands braucht. Bis dahin bewusst ohne Aufrufer."),
    _c("structure.stages", "Abschnitte verwalten",
       ["GET /api/tournaments/{tid}/stages", "POST /api/tournaments/{tid}/stages",
        "PATCH /api/tournaments/{tid}/stages/{stage_id}", "PUT /api/tournaments/{tid}/stages/{stage_id}",
        "DELETE /api/tournaments/{tid}/stages/{stage_id}",
        "POST /api/tournaments/{tid}/stages/{stage_id}/generate"], [GRAPH]),
    _c("structure.swiss", "Schweizer Runde erzeugen",
       ["POST /api/tournaments/{tid}/swiss/next-round"], [CLASSIC, GRAPH],
       note="Block 3: bewusst ohne Schema. Wer in Runde 3 gegen wen spielt, hängt an Runde 2 - "
            "die Struktur wächst also Runde für Runde. Ein Freilos wird als entschiedenes Match "
            "mit einem Teilnehmer geschrieben, damit der Punkt dafür in der Tabelle ankommt."),
    _c("structure.groups", "Gruppen erzeugen",
       ["POST /api/tournaments/{tid}/groups/generate", "GET /api/tournaments/{tid}/groups"], [CLASSIC, GRAPH],
       note="Block 3: Gruppen stehen im Voraus fest und passen deshalb ins Schema. Die "
            "Gruppenzuteilung läuft im Schlangensystem, damit die stärksten Setzplätze nicht "
            "in derselben Gruppe landen."),

    # ---------- Struktur lesen ----------
    _c("structure.read", "Turnierbaum und Abschnitte lesen",
       ["GET /api/tournaments/{tid}/bracket", "GET /api/tournaments/{tid}/bracket/display",
        "GET /api/tournaments/{tid}/matches-v2"], [CLASSIC, GRAPH],
       note="Liefert bereits die gemeinsame Struktur mit; das Frontend liest sie noch nicht."),
    _c("standings.read", "Tabelle lesen",
       ["GET /api/tournaments/{tid}/standings"], [CLASSIC, GRAPH]),
    _c("matchday.read", "Spielwochen und geltende Termine lesen",
       ["GET /api/tournaments/{tid}/matchdays"], [GRAPH],
       note="Nur Liga, Round Robin und Gruppen spielen in Wochen; andere Formate "
            "antworten mit applies=false. Rein lesend, die Termine werden berechnet."),
    _c("access.onsite", "Vor-Ort-Zugang per QR: einlösen, Einstellung, erneuern",
       ["POST /api/tournaments/onsite/redeem", "GET /api/tournaments/{tid}/onsite-access",
        "PUT /api/tournaments/{tid}/onsite-access", "POST /api/tournaments/{tid}/onsite-access/renew"], [CLASSIC, GRAPH],
       note="#1592: Begleitpersonen melden sich vor Ort auch bei Mitglieder-Turnieren an; Einlösen nur im Zeitfenster, "
            "Einstellung und Erneuern nur für die Turnierleitung."),
    _c("planning.check", "Planungsprüfung und Spielplan-Export",
       ["GET /api/tournaments/{tid}/planning-check", "GET /api/tournaments/{tid}/match-plan.csv"], [CLASSIC, GRAPH]),
    _c("planning.schedule", "Spielplan planen (Vorschau) und übernehmen",
       ["POST /api/tournaments/{tid}/schedule/plan", "POST /api/tournaments/{tid}/schedule/apply",
        "POST /api/tournaments/{tid}/schedule/release"], [GRAPH],
       note="Der Spielplaner (#1552) schreibt Zeit und Station zusammen mit schedule_source; die Vorschau "
            "schreibt nichts, Übernehmen alles auf einmal. Online nie Stationen."),
    _c("planning.deadlines", "Fristen je Spiel lesen (Matchplan online und Liga)",
       ["GET /api/tournaments/{tid}/schedule/deadlines"], [GRAPH],
       note="Matchplan-Seite (#1557): offen seit, „nicht erschienen“ ab, Ergebnis gilt ab - gerechnet von "
            "services/match_deadlines, rein lesend, nur für das Team des Turniers."),

    # ---------- Matches lesen ----------
    _c("match.read", "Match ansehen",
       ["GET /api/matches/{match_id}", "GET /api/matches/{match_id}/page",
        "GET /api/matches/upcoming", "GET /api/matches/operations"], [CLASSIC, GRAPH]),
    _c("match.chat", "Match-Chat",
       ["GET /api/matches/{match_id}/chat", "POST /api/matches/{match_id}/chat"], [CLASSIC, GRAPH]),
    _c("match.schedule", "Termin vorschlagen und entscheiden",
       ["GET /api/matches/{match_id}/schedule-proposals",
        "POST /api/matches/{match_id}/schedule-proposals",
        "POST /api/matches/{match_id}/schedule-proposals/{proposal_id}/decision"], [CLASSIC, GRAPH]),

    # ---------- Ergebnisse schreiben ----------
    _c("result.staff_entry", "Ergebnis durch Turnierleitung eintragen",
       ["PUT /api/matches/{match_id}", "PATCH /api/matches/{match_id}"], [CLASSIC, GRAPH],
       note="Verzweigt intern nach Engine; im Graph-Zweig werden Score-Felder verworfen."),
    _c("result.submit", "Ergebnis melden",
       ["POST /api/matches/{match_id}/result"], [GRAPH]),
    _c("result.report", "Ergebnis im Einvernehmen bestätigen",
       ["POST /api/matches/{match_id}/report"], [CLASSIC, GRAPH],
       note="Block 3: auch im Graph-System. Zwei übereinstimmende Meldungen entscheiden; eine einzelne erst, "
            "wenn die Gegenseite bis zur Frist nicht widerspricht (#1551: online 15 Min., Liga 48 h)."),
    _c("result.dispute", "Ergebnis anfechten",
       ["POST /api/matches/{match_id}/dispute"], [CLASSIC, GRAPH],
       note="Block 3: derselbe Endpunkt bedient beide Speicher."),
    _c("result.forfeit", "Aufgabe eintragen",
       ["POST /api/matches/{match_id}/forfeit"], [CLASSIC, GRAPH],
       note="Block 3: im Graph-System als gewöhnliche Platzierung mit dem Aufgebenden auf dem "
            "letzten Platz - dadurch brauchen Weiterleitung, Tabelle und Export keinen Sonderfall."),
    _c("result.recalculate", "Weiterleitung neu berechnen",
       ["POST /api/tournaments/{tid}/matches-v2/recalculate-advancement"], [GRAPH]),
    _c("result.dispute_decision", "Dispute entscheiden",
       ["POST /api/matches/{match_id}/dispute/decision"], [GRAPH],
       note="#1158: „Ergebnis bleibt“ mit einem Tipp; „Ergebnis ändern“ läuft über das Ergebnis-Fenster."),
    _c("result.undo", "Ergebnis zurücknehmen",
       ["POST /api/matches/{match_id}/result/undo"], [GRAPH],
       note="#1156: nur der letzte Eintrag. Liegt das Ergebnis noch 10 Sekunden bereit, fällt es weg; sonst nimmt der "
            "Server auch das Weiterrücken zurück oder lehnt ab, wenn das nächste Spiel schon begonnen hat."),
    _c("lead.read", "Turnierleitung am Handy",
       ["GET /api/tournaments/{tid}/lead"], [GRAPH],
       note="#1156: offene Spiele für die Turnierleitung des Turniers - zuerst, was fehlt, dann nach Station."),
    _c("lead.live_queue", "Live-Warteschlange je Station: ansehen, aufrufen, starten",
       ["GET /api/tournaments/{tid}/live-queue", "GET /api/tournaments/{tid}/live-queue/me",
        "POST /api/tournaments/{tid}/live-queue/call", "POST /api/tournaments/{tid}/live-queue/start"], [GRAPH],
       note="#1556: je Station „läuft / als Nächstes / danach“ mit Prognose aus dem Planer; Aufrufen und Starten "
            "unter der Turnier-Sperre, nur mit Stations-Recht; lesen öffentlich wie der Turnierbaum."),
    _c("lead.no_show", "„Nicht erschienen“ nach Frist entscheiden",
       ["POST /api/tournaments/{tid}/lead/no-show/{match_id}"], [GRAPH],
       note="#1551: nach der Frist schlägt der Server „kampflos verloren“ vor; die Turnierleitung bestätigt "
            "(Forfeit-Weg) oder verlängert."),
    _c("structure.heat_rebuild", "FFA-Läufe zusammenlegen, ausgleichen, abkürzen",
       ["POST /api/tournaments/{tid}/heat-rebuild/check", "POST /api/tournaments/{tid}/heat-rebuild/confirm",
        "POST /api/tournaments/{tid}/heat-rebuild/reject"], [GRAPH],
       note="#1550: Prüfung läuft nach Baubau und Ergebnis von selbst; im Modus „Vorschlag“ bestätigt oder lehnt "
            "die Turnierleitung hier ab."),
    _c("participants.removal", "Disqualifikation und Austritt mit Umbauplan",
       ["POST /api/tournaments/{tid}/registrations/{reg_id}/removal",
        "POST /api/tournaments/{tid}/registrations/{reg_id}/removal/reject"], [GRAPH],
       note="#1553: Ereignis → Umbauplan (Format × Ereignis) → Vorschlag → Bestätigung der Turnierleitung; K.-o. "
            "kampflos weiter ohne Loser-Bracket, Liga/Gruppen 50-Prozent-Regel, Swiss nicht mehr paaren, Läufe rücken auf."),
    _c("structure.redraw", "Gegner der nächsten Runde neu auslosen",
       ["POST /api/tournaments/{tid}/stages/{stage_id}/redraw"], [GRAPH],
       note="#1548: gemischt lost der Server nach jeder fertigen Runde von selbst aus; die Turnierleitung lost eine "
            "Runde (oder bei der Liga die Spieltage) neu aus, bis eines der Spiele beginnt. Sofort zufällig (#1590): "
            "nur die Spiele, die noch nicht begonnen haben."),
    _c("structure.draw_show", "Show-Auslosung: Jetzt auslosen",
       ["POST /api/tournaments/{tid}/stages/{stage_id}/draw"], [GRAPH],
       note="#1590: Weiterkommen in vier Modi (fest, Auslosung nach der Runde, Show, sofort zufällig). Bei der Show "
            "steht der Topf, bis die Turnierleitung mit Aufbau-Recht lost; nach der Frist lost der Server selbst "
            "(services/draw_show)."),
)


CAPABILITIES_BY_KEY = {capability.key: capability for capability in CAPABILITIES}


def declared_endpoints() -> set[str]:
    return {endpoint for capability in CAPABILITIES for endpoint in capability.endpoints}


def capabilities_for_engine(engine: str) -> tuple[Capability, ...]:
    return tuple(c for c in CAPABILITIES if engine in c.engines or ENGINE_NEUTRAL in c.engines)


def open_gaps() -> tuple[Capability, ...]:
    """Capabilities that exist in one engine only and block the consolidation."""
    return tuple(c for c in CAPABILITIES if c.is_gap)
