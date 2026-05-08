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
