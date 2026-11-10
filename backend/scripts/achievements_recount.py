#!/usr/bin/env python3
"""Neuberechnung der Erfolge (#2340): Stand, Probelauf und Abschluss von der Kommandozeile.

Ohne Schalter zeigt das Werkzeug den Stand: ob der stille Modus an ist und wie weit der Abschluss ist.

- ``--probelauf`` (auch ``--dry-run``) rechnet für alle Konten aus, welche Stufen neu dazukämen - je Stufe die Zahl und die
  Zahl der Personen. Er vergibt nichts, schreibt keine XP und keine Zähler, nur sein Ergebnis für die Verwaltung.
- ``--abschliessen`` (auch ``--finish``) wertet alle Konten still aus, beendet den stillen Modus und schickt je Person
  mit nachgerechneten Stufen EINE Sammel-Nachricht (Postfach, Push, kein Discord). Fertig ist fertig; ein abgebrochener
  Lauf geht beim Stand weiter, doppelt geschickt wird nichts.
- ``--starten`` (auch ``--start``) schaltet den stillen Modus ein, falls Migration 22 ihn nicht gesetzt hat (etwa auf
  einem lokalen Stand, der beim Start noch leer war). Ein abgeschlossener Lauf bleibt abgeschlossen.

Am Server, im Backend-Container:
    docker compose exec backend python -m scripts.achievements_recount --probelauf
    docker compose exec backend python -m scripts.achievements_recount --abschliessen

Umgebung: dieselben MONGO_URL und DB_NAME wie das Backend.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Neuberechnung der Erfolge (#2340): Stand, Probelauf, Abschluss.")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--probelauf", "--dry-run", dest="dry_run", action="store_true", help="nur zählen, nichts vergeben")
    action.add_argument("--abschliessen", "--finish", dest="finish", action="store_true", help="still auswerten, Sammel-Nachricht, stiller Modus aus")
    action.add_argument("--starten", "--start", dest="start", action="store_true", help="stillen Modus einschalten, falls er fehlt")
    return parser.parse_args(argv)


def _load_environment() -> None:
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    from services.bootstrap import ensure_wiring

    ensure_wiring()  # Anmeldungen beim Import (#1420), siehe services/bootstrap.py


def render_status(state: dict) -> str:
    if not state.get("exists"):
        return "Keine Neuberechnung angelegt (Migration 22 lief auf einem leeren Stand) - mit --starten einschalten.\n"
    run = state.get("finish") or {}
    lines = [f"Stiller Modus: {'an' if state.get('active') else 'aus'} (seit {state.get('started_at') or '–'})"]
    if run.get("done"):
        lines.append(f"Abgeschlossen am {run.get('finished_at')}: {run.get('awarded') or 0} Stufen still vergeben, "
                     f"{run.get('notified') or 0} Sammel-Nachrichten.")
    elif run.get("phase"):
        what = "läuft" if run.get("running") else "unterbrochen - mit --abschliessen fortsetzen"
        lines.append(f"Abschluss {what}: Schritt {run.get('phase')}, {run.get('evaluated') or 0} von {run.get('users_total') or 0} "
                     f"Konten ausgewertet, {run.get('notified') or 0} Sammel-Nachrichten.")
    else:
        lines.append("Noch nicht abgeschlossen.")
    recounted = state.get("recounted") or {}
    lines.append(f"Schon still vergeben: {recounted.get('awards') or 0} Stufen an {recounted.get('users') or 0} Personen.")
    for row in recounted.get("tiers") or []:
        group = f" ({row['group_name']})" if row.get("group_name") else ""
        lines.append(f"  {row['count']:>6}  {row['name']}{group}")
    return "\n".join(lines) + "\n"


async def main(argv: list[str] | None = None, *, out=None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    out = out or sys.stdout
    from services import achievement_recount as recount

    def progress(text: str) -> None:
        out.write(text + "\n")
        out.flush()

    if args.start:
        out.write(await recount.begin() + "\n")
    elif args.dry_run:
        result = await recount.dry_run(progress=progress)
        if result.get("status") != "done":
            out.write(f"Probelauf nicht fertig: {result.get('status')}\n")
            return 1
        out.write(recount.render_dry_run(result))
        return 0
    elif args.finish:
        result = await recount.finish(progress=progress)
        out.write(f"Abschluss: {result.get('status')}\n")
        if result.get("status") not in ("done",):
            return 1
    out.write(render_status(await recount.status()))
    return 0


if __name__ == "__main__":
    _load_environment()
    raise SystemExit(asyncio.run(main()))
