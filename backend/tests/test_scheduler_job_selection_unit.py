"""Nur ausgewählte Hintergrund-Jobs (#1609): ``SCHEDULER_JOBS`` legt nur die genannten an - der Abnahme-Stand braucht
gehaltene Ergebnisse und die Show-Auslosung, aber keine Mails, Erinnerungen oder Discord."""
import logging
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import scheduler  # noqa: E402


@pytest.fixture
def fresh_scheduler(monkeypatch):
    monkeypatch.setattr(scheduler, "_scheduler", None)
    yield
    scheduler.stop_scheduler()


def test_without_a_selection_every_job_is_planned(monkeypatch):
    monkeypatch.delenv("SCHEDULER_JOBS", raising=False)
    assert scheduler.allowed_jobs() is None
    monkeypatch.setenv("SCHEDULER_JOBS", " , ")
    assert scheduler.allowed_jobs() is None


def test_the_selection_is_read_as_a_comma_list(monkeypatch):
    monkeypatch.setenv("SCHEDULER_JOBS", " result_holds, draw_show ,")
    assert scheduler.allowed_jobs() == {"result_holds", "draw_show"}


@pytest.mark.asyncio
async def test_only_the_selected_jobs_run_and_unknown_names_are_reported(monkeypatch, fresh_scheduler, caplog):
    monkeypatch.setenv("SCHEDULER_JOBS", "result_holds,draw_show,gibt_es_nicht")
    with caplog.at_level(logging.WARNING, logger=scheduler.logger.name):
        sched = scheduler.start_scheduler()
    assert {job.id for job in sched.get_jobs()} == {"result_holds", "draw_show"}
    assert "gibt_es_nicht" in caplog.text


@pytest.mark.asyncio
async def test_without_a_selection_the_mail_queue_and_the_result_holds_both_run(monkeypatch, fresh_scheduler):
    monkeypatch.delenv("SCHEDULER_JOBS", raising=False)
    ids = {job.id for job in scheduler.start_scheduler().get_jobs()}
    assert {"mail_queue", "result_holds", "draw_show", "match_deadlines"} <= ids
    assert len(ids) > 20
