"""Wächter für Code-Scanning-Muster (#1408): ein assert mit Wirkung im Backend und neue unbenutzte Namen in
geänderten Dateien. Die Beispiele stehen als Text im Test - als echte Datei würde das Code-Scanning sie selbst
bemängeln."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_code_patterns", ROOT / "scripts/check-code-patterns.py")
patterns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patterns)

BAD = '''import io
import subprocess

from PIL import Image


async def test_bad(flow, db, items):
    assert (await flow.delete("/api/x")).status_code == 200
    assert Image.open(io.BytesIO(b"")).size == (1, 1)
    assert len((await flow.client.delete("/api/y")).json()["entries"]) == 1
    assert (await db.items.insert_one({"a": 1})).acknowledged
    assert items, items.pop()
    assert subprocess.check_output(["git", "status"])
'''

GOOD = '''async def test_good(flow, items):
    deleted = await flow.delete("/api/x")
    assert deleted.status_code == 200
    assert (await flow.post("/api/x", json={})).status_code == 200
    assert (await flow.get("/api/x")).json() == {}
    assert "delete" in str(items) and items.count(1) == 0
'''


def backend_file(root: Path, name: str, text: str) -> None:
    path = root / "backend" / "tests" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_an_assert_with_an_effect_is_found_with_file_line_and_name(tmp_path):
    backend_file(tmp_path, "test_bad.py", BAD)
    backend_file(tmp_path, "test_good.py", GOOD)
    found = [(item.path, item.line, item.name) for item in patterns.side_effect_asserts(tmp_path)]
    assert found == [
        ("backend/tests/test_bad.py", 8, "delete"),
        ("backend/tests/test_bad.py", 9, "open"),
        ("backend/tests/test_bad.py", 10, "delete"),
        ("backend/tests/test_bad.py", 11, "insert_one"),
        ("backend/tests/test_bad.py", 12, "pop"),
        ("backend/tests/test_bad.py", 13, "subprocess.check_output"),
    ]


def test_the_report_names_place_rule_and_fix_in_german(tmp_path, capsys):
    backend_file(tmp_path, "test_bad.py", BAD)
    assert patterns.main(["--root", str(tmp_path), "--skip-lint"]) == 1
    out = capsys.readouterr().out
    assert "backend/tests/test_bad.py:8: assert mit Wirkung („delete“) - CodeQL py/side-effect-in-assert" in out
    assert "zuerst aufrufen, dann prüfen" in out


def test_calling_first_and_checking_after_passes(tmp_path):
    backend_file(tmp_path, "test_good.py", GOOD)
    assert patterns.main(["--root", str(tmp_path), "--skip-lint"]) == 0


def test_the_backend_has_no_assert_with_an_effect():
    # Regel 1 gilt hart für das ganze Backend - im CI über diesen Test, lokal zusätzlich im Schritt code-patterns.
    assert patterns.side_effect_asserts(ROOT) == []


SHOP_ROUTES = '''from fastapi import APIRouter, Depends

from auth import get_current_user, require_area

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])
public = APIRouter(prefix="/api", tags=["shop"])


@router.get("/products")
async def guarded(me: dict = Depends(require_area("finance"))):
    return {}


@router.post("/products")
async def wrong_area(me: dict = Depends(require_area("finance", "content"))):
    return {}


@router.get("/orders")
async def unguarded():
    return {}


@public.get("/shop/products")
async def visible(me: dict = Depends(get_current_user)):
    return {}


@public.get("/workshops")
async def not_the_shop():
    return {}
'''


def test_shop_routes_need_the_finance_area_and_none_are_public(tmp_path):
    path = tmp_path / "backend" / "routes" / "shop_test_routes.py"
    path.parent.mkdir(parents=True)
    path.write_text(SHOP_ROUTES, encoding="utf-8")
    found = [(item.path, item.line, item.name) for item in patterns.shop_route_guards(tmp_path)]
    assert found == [
        ("backend/routes/shop_test_routes.py", 14, "POST /api/admin/shop/products ohne require_area(\"finance\")"),
        ("backend/routes/shop_test_routes.py", 19, "GET /api/admin/shop/orders ohne require_area(\"finance\")"),
        ("backend/routes/shop_test_routes.py", 24, "GET /api/shop/products ist öffentlich"),
    ]
    assert patterns.main(["--root", str(tmp_path), "--skip-lint"]) == 1


def test_the_real_shop_routes_are_guarded():
    # Regel 3 gilt hart: jede Shop-Route der Anwendung hängt an „Finanzen“ (#1704) - außer den einzeln freigegebenen.
    assert patterns.shop_route_guards(ROOT) == []
    routes = patterns.shop_routes(ROOT)
    assert routes, "die Suche findet die Shop-Routen"
    public = {(route.method, route.url, route.path) for route in routes
              if not route.url.startswith(patterns.SHOP_ADMIN_PREFIX + "/")}
    assert public == set(patterns.PUBLIC_SHOP_ROUTES), "jede Ausnahme gibt es wirklich, und es gibt keine weitere"


PRINT_FILE_ROUTES = '''from fastapi import APIRouter

router = APIRouter(prefix="/api/shop/print-files", tags=["shop"])


@router.get("/{public_id}/{filename}")
async def print_file(public_id: str, filename: str):
    return {}


@router.get("/{public_id}")
async def listing(public_id: str):
    return {}


@router.post("/{public_id}/{filename}")
async def replace(public_id: str, filename: str):
    return {}
'''


def test_the_print_file_exception_holds_only_for_its_method_path_and_file(tmp_path):
    # Die öffentliche Adresse für Printful (#1708) ist bewusst erlaubt - aber nur genau diese eine Route in genau dieser
    # Datei. Eine Liste daneben, ein Schreibzugriff oder dieselbe Route in einer anderen Datei bleiben Fehler.
    reason = patterns.PUBLIC_SHOP_ROUTES[("GET", "/api/shop/print-files/{public_id}/{filename}",
                                          "backend/routes/shop_print_file_routes.py")]
    assert "Printful" in reason and "Zufallsschlüssel" in reason
    routes = tmp_path / "backend" / "routes"
    routes.mkdir(parents=True)
    (routes / "shop_print_file_routes.py").write_text(PRINT_FILE_ROUTES, encoding="utf-8")
    (routes / "shop_copy_routes.py").write_text(PRINT_FILE_ROUTES, encoding="utf-8")
    found = sorted((item.path.rsplit("/", 1)[1], item.name) for item in patterns.shop_route_guards(tmp_path))
    base = "/api/shop/print-files/{public_id}"
    assert found == [
        ("shop_copy_routes.py", f"GET {base} ist öffentlich"),
        ("shop_copy_routes.py", f"GET {base}/{{filename}} ist öffentlich"),
        ("shop_copy_routes.py", f"POST {base}/{{filename}} ist öffentlich"),
        ("shop_print_file_routes.py", f"GET {base} ist öffentlich"),
        ("shop_print_file_routes.py", f"POST {base}/{{filename}} ist öffentlich"),
    ]


def test_only_unused_names_a_change_brings_in_count(tmp_path):
    before, now = tmp_path / "vorher", tmp_path / "jetzt"
    for folder, text in ((before, "import os\n\n\ndef f():\n    wert = 1\n"),
                         (now, "import json\nimport os\n\n\ndef f():\n    wert = 1\n    neu = 2\n")):
        (folder / "backend").mkdir(parents=True)
        (folder / "backend" / "modul.py").write_text(text, encoding="utf-8")
    old = patterns.lint(sys.executable, before, ["backend/modul.py"])
    new = patterns.lint(sys.executable, now, ["backend/modul.py"])
    assert {(code, text) for _, _, code, text in old} == {
        ("F401", "'os' imported but unused"), ("F841", "local variable 'wert' is assigned to but never used")}
    fresh = patterns.new_findings(new, old)
    assert [(path, line, code) for path, line, code, _ in fresh] == [
        ("backend/modul.py", 1, "F401"), ("backend/modul.py", 7, "F841")]
