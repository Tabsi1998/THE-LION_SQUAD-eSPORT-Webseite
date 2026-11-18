"""Der gemeinsame Helfer ``still_rate_limit_clock`` (#2512): Die Uhr der Drosselung steht, alle anderen laufen weiter."""
from datetime import datetime as real_datetime
from datetime import timedelta, timezone

import pytest

import rate_limit_clock


class Ticking(real_datetime):
    """Jeder Blick auf die Uhr ist einen Tag und eine Minute später - jedes Fenster bis zu einem Tag wechselt."""

    calls = 0

    @classmethod
    def now(cls, tz=None):
        cls.calls += 1
        return (real_datetime(2026, 12, 16, 11, 59, 30, tzinfo=timezone.utc)
                + timedelta(days=cls.calls, minutes=cls.calls)).astimezone(tz)


class FakeRequest:
    client = None


class Counters:
    """So viel von ``db.rate_limits``, wie ``enforce_rate_limit`` braucht."""

    def __init__(self):
        self.rows = {}

    async def find_one_and_update(self, query, update, **_options):
        row = self.rows.setdefault(query["_id"], {**update["$setOnInsert"], "count": 0})
        row["count"] += update["$inc"]["count"]
        return row


class Db:
    def __init__(self):
        self.rate_limits = Counters()


async def calls_until_refused(rate_limit, limit: int, window_seconds: int) -> list[int]:
    from fastapi import HTTPException

    codes = []
    for _ in range(limit + 1):
        try:
            await rate_limit.enforce_rate_limit(FakeRequest(), "probe", limit, window_seconds, subject="eins")
            codes.append(200)
        except HTTPException as refused:
            codes.append(refused.status_code)
            retry_after = int(refused.headers["Retry-After"])
            assert 0 < retry_after <= window_seconds
    return codes


@pytest.fixture
def ticking_rate_limit_clock(monkeypatch):
    from services import rate_limit

    Ticking.calls = 0
    monkeypatch.setattr(rate_limit, "datetime", Ticking)
    db = Db()
    monkeypatch.setattr(rate_limit, "get_db", lambda: db)
    return rate_limit


@pytest.mark.asyncio
@pytest.mark.parametrize("window_seconds", [60, 900, 3600, 86400])
async def test_without_the_helper_a_window_change_lets_the_last_call_through(ticking_rate_limit_clock, window_seconds):
    """Die Gegenprobe zum Helfer: Läuft die Uhr über einen Fensterwechsel, bleibt die erwartete 429 aus."""
    assert await calls_until_refused(ticking_rate_limit_clock, 3, window_seconds) == [200] * 4


@pytest.mark.asyncio
@pytest.mark.parametrize("window_seconds", [60, 900, 3600, 86400])
async def test_with_the_helper_the_real_limit_refuses_the_next_call(ticking_rate_limit_clock, monkeypatch, window_seconds):
    rate_limit_clock.hold_still(monkeypatch)
    assert await calls_until_refused(ticking_rate_limit_clock, 3, window_seconds) == [200, 200, 200, 429]


def test_the_clock_stands_mid_minute_at_the_real_now():
    from services import rate_limit

    patch = pytest.MonkeyPatch()
    try:
        before = real_datetime.now(timezone.utc)
        moment = rate_limit_clock.hold_still(patch)
        assert rate_limit.datetime.now(timezone.utc) == moment == rate_limit.datetime.now(timezone.utc)
        assert (moment.second, moment.microsecond) == (30, 0), "mitten im Minutenfenster"
        assert abs((moment - before).total_seconds()) <= 60, "beim echten Jetzt - die Ablaufzeit der Zähler stimmt"
        assert rate_limit.datetime.now() == moment.astimezone().replace(tzinfo=None), "ohne Zeitzone: Ortszeit wie sonst"
        assert rate_limit.datetime.fromtimestamp(0, tz=timezone.utc) == real_datetime(1970, 1, 1, tzinfo=timezone.utc)
    finally:
        patch.undo()
    assert rate_limit.datetime is real_datetime, "monkeypatch stellt die Uhr nach dem Test zurück"


def test_other_modules_keep_their_own_clock(still_rate_limit_clock):
    import datetime as datetime_module

    from services import auth_settings, rate_limit

    assert datetime_module.datetime is real_datetime
    assert auth_settings.datetime is real_datetime, "nur services.rate_limit sieht die stehende Uhr"
    assert rate_limit.datetime is not real_datetime and issubclass(rate_limit.datetime, real_datetime)
    assert rate_limit.datetime.now(timezone.utc) == still_rate_limit_clock
