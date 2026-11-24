"""Erreichbarkeit (#1657): der Job prüft auch dann, wenn die Sperre wegen fehlender Datenbank nicht zu holen ist."""
import pytest

from services import scheduler


@pytest.mark.asyncio
async def test_the_job_runs_without_lease_when_the_database_is_gone(monkeypatch):
    import services.maintenance as maintenance
    import services.mutation_lock as mutation_lock

    runs = []

    async def run():
        runs.append(1)

    async def no_pause(db):
        raise RuntimeError("keine Datenbank")

    def broken_lock(*args, **kwargs):
        raise RuntimeError("keine Datenbank")

    monkeypatch.setattr(scheduler, "_safe_ops_reachability", run)
    monkeypatch.setattr(maintenance, "active_state", no_pause)
    monkeypatch.setattr(mutation_lock, "mutation_lock", broken_lock)
    await scheduler._ops_reachability_job()
    assert runs == [1]


@pytest.mark.asyncio
async def test_the_job_pauses_during_the_backup_write_pause(monkeypatch):
    import services.maintenance as maintenance

    runs = []

    async def run():
        runs.append(1)

    async def paused(db):
        return {"reason": "backup"}

    monkeypatch.setattr(scheduler, "_safe_ops_reachability", run)
    monkeypatch.setattr(maintenance, "active_state", paused)
    await scheduler._ops_reachability_job()
    assert runs == []
