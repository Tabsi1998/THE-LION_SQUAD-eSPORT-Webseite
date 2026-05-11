import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

pytest.importorskip("email_validator")

from models import F1ChallengeUpdate, TournamentUpdate


def test_tournament_update_accepts_empty_stream_platform_as_none():
    model = TournamentUpdate(stream_platform="")

    assert model.stream_platform is None


def test_f1_update_accepts_empty_stream_platform_as_none():
    model = F1ChallengeUpdate(stream_platform="")

    assert model.stream_platform is None


def test_f1_update_accepts_reference_time_settings():
    model = F1ChallengeUpdate(
        block_club_member_results=True,
        allow_club_reference_times=True,
        show_club_reference_times=False,
    )

    assert model.block_club_member_results is True
    assert model.allow_club_reference_times is True
    assert model.show_club_reference_times is False
