import pathlib
import sys
import types
from datetime import datetime, timezone
from uuid import uuid4

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

models_stub = types.ModuleType("models")
models_stub.new_id = lambda: str(uuid4())
models_stub.now_utc = lambda: datetime.now(timezone.utc)
sys.modules.setdefault("models", models_stub)

from bracket_engine import generate_bracket


def test_legacy_preview_bracket_uses_seed_placeholders():
    tournament = {
        "id": "t1",
        "format": "single_elim",
        "best_of": 1,
        "bronze_match": False,
        "seeding_mode": "manual",
        "match_duration_minutes": 12,
    }
    registrations = [
        {"id": f"preview-seed-{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 9)
    ]

    matches = generate_bracket(tournament, registrations, preview=True)

    assert len(matches) == 7
    assert {match["status"] for match in matches} == {"preview"}
    assert all(match["is_preview"] for match in matches)
    assert all(match["duration_minutes"] == 12 for match in matches)
    assert matches[0]["participant_a_id"].startswith("preview-seed-")
