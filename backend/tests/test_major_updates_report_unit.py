"""Bericht über größere Updates (#1739): erkennt neue Hauptversionen, ohne das Netz zu fragen."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "major_updates_report", Path(__file__).resolve().parents[2] / "scripts/major-updates-report.py"
)
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def test_versions_are_read_from_npm_and_pip_specs():
    assert report.parse_version("^1.2.3") == (1, 2, 3)
    assert report.parse_version("~57.0.30") == (57, 0, 30)
    assert report.parse_version("9") == (9, 0, 0)
    assert report.parse_version("latest") is None


def test_only_a_new_major_counts_and_below_one_a_new_minor():
    assert report.is_breaking_jump((1, 2, 3), (2, 0, 0))
    assert not report.is_breaking_jump((1, 2, 3), (1, 9, 0))
    assert not report.is_breaking_jump((2, 0, 0), (1, 9, 0))
    assert report.is_breaking_jump((0, 12, 0), (0, 13, 0))
    assert not report.is_breaking_jump((0, 12, 0), (0, 12, 5))


def test_expo_sdk_packages_are_reported_as_one_sdk_update():
    assert report.is_expo_managed("expo-camera")
    assert report.is_expo_managed("@expo/vector-icons")
    assert report.is_expo_managed("react-native")
    assert not report.is_expo_managed("axios")
    latest = {"expo": "58.0.1"}.get
    assert report.expo_sdk_update({"expo": "~57.0.30"}, latest) == ("SDK 57", "SDK 58 (58.0.1)")
    assert report.expo_sdk_update({"expo": "~58.0.0"}, latest) is None


def test_pinned_requirements_with_extras_are_read(tmp_path):
    requirements = tmp_path / "requirements.txt"
    requirements.write_text("# Kommentar\nfastapi==0.143.0\nuvicorn[standard]==0.40.0  # Server\n-r other.txt\n", encoding="utf-8")
    assert report.pip_requirements([requirements]) == {"fastapi": "0.143.0", "uvicorn": "0.40.0"}


def test_report_lists_majors_and_counts_them():
    deps = {"vite": "^8.3.4", "axios": "^1.20.0"}
    latest = {"vite": "9.0.0", "axios": "1.30.0"}.get
    rows = report.find_majors(deps, latest)
    assert rows == [("vite", "^8.3.4", "9.0.0")]
    text, count = report.render([("Website", rows)], None)
    assert count == 1
    assert "| `vite` | ^8.3.4 | 9.0.0 |" in text
    assert report.render([("Website", [])], None) == (report.render([], None)[0], 0)
