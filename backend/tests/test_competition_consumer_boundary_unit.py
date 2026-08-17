import pathlib
import re


BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
READ_CONSUMERS = (
    "badges.py",
    "pdf_service.py",
    "routes/event_routes.py",
    "routes/extras_routes.py",
    "routes/station_routes.py",
    "services/match_notifications.py",
    "services/match_overview.py",
    "services/match_reminder.py",
    "services/profile_references.py",
)
DIRECT_MATCH_READ = re.compile(
    r"db\.(?:matches|matches_v2)\.(?:find|find_one|count_documents|aggregate|distinct)\s*\("
)


def test_read_consumers_do_not_bypass_competition_projection_boundary():
    violations = []
    for relative_path in READ_CONSUMERS:
        source = (BACKEND_ROOT / relative_path).read_text(encoding="utf-8")
        if DIRECT_MATCH_READ.search(source):
            violations.append(relative_path)

    assert violations == []
