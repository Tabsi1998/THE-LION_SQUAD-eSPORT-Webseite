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
       ["GET /api/tournaments", "GET /api/tournaments/{slug_or_id}"], [ENGINE_NEUTRAL]),
    _c("tournament.create", "Turnier anlegen",
       ["POST /api/tournaments"], [ENGINE_NEUTRAL]),
    _c("tournament.edit", "Turnier bearbeiten",
       ["PUT /api/tournaments/{tid}", "PATCH /api/tournaments/{tid}"], [ENGINE_NEUTRAL]),
    _c("tournament.delete", "Turnier löschen",
       ["DELETE /api/tournaments/{tid}"], [ENGINE_NEUTRAL]),
    _c("tournament.lock", "Turnier sperren und entsperren",
       ["POST /api/tournaments/{tid}/lock", "POST /api/tournaments/{tid}/unlock"], [ENGINE_NEUTRAL]),
    _c("tournament.status", "Turnierstatus wechseln",
       ["POST /api/tournaments/{tid}/status"], [ENGINE_NEUTRAL],
       note="Löst bei check_in und live zusätzlich Strukturarbeit aus."),
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
    _c("planning.check", "Planungsprüfung und Spielplan-Export",
       ["GET /api/tournaments/{tid}/planning-check", "GET /api/tournaments/{tid}/match-plan.csv"], [CLASSIC, GRAPH]),

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
       note="Block 3: auch im Graph-System. Zwei übereinstimmende Meldungen entscheiden, "
            "eine einzelne nie - sonst könnte sich jemand allein weiterschreiben."),
    _c("result.dispute", "Ergebnis anfechten",
       ["POST /api/matches/{match_id}/dispute"], [CLASSIC, GRAPH],
       note="Block 3: derselbe Endpunkt bedient beide Speicher."),
    _c("result.forfeit", "Aufgabe eintragen",
       ["POST /api/matches/{match_id}/forfeit"], [CLASSIC, GRAPH],
       note="Block 3: im Graph-System als gewöhnliche Platzierung mit dem Aufgebenden auf dem "
            "letzten Platz - dadurch brauchen Weiterleitung, Tabelle und Export keinen Sonderfall."),
    _c("result.recalculate", "Weiterleitung neu berechnen",
       ["POST /api/tournaments/{tid}/matches-v2/recalculate-advancement"], [GRAPH]),
)


CAPABILITIES_BY_KEY = {capability.key: capability for capability in CAPABILITIES}


def declared_endpoints() -> set[str]:
    return {endpoint for capability in CAPABILITIES for endpoint in capability.endpoints}


def capabilities_for_engine(engine: str) -> tuple[Capability, ...]:
    return tuple(c for c in CAPABILITIES if engine in c.engines or ENGINE_NEUTRAL in c.engines)


def open_gaps() -> tuple[Capability, ...]:
    """Capabilities that exist in one engine only and block the consolidation."""
    return tuple(c for c in CAPABILITIES if c.is_gap)
