"""Läuft der Scheduler, und welche Jobs hat er? (#1420: aus services/scheduler.py herausgelöst)

services/scheduler.py meldet beim Start und Stopp den laufenden Scheduler hier an. Die Betriebs-Checks
(services/ops_checks.py) lesen den Stand, ohne den Scheduler zu importieren - der führt die Checks nämlich aus.
"""
from __future__ import annotations

_running = None


def set_running(scheduler) -> None:
    global _running
    _running = scheduler


def get_scheduler_status() -> dict:
    if not _running:
        return {"running": False, "jobs": []}
    jobs = []
    for job in _running.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {"running": _running.running, "jobs": jobs}
