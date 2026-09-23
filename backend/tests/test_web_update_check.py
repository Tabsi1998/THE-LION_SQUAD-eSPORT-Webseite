import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("web_update_check", Path(__file__).resolve().parents[2] / "scripts/check-web-update.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


@pytest.mark.parametrize("problem", [None, "immutable_worker", "different_worker", "cached_html", "old_route", "missing_asset", "mjs_octet_stream", "chunk_not_immutable", "assetlinks_html"])
def test_release_check_detects_real_update_failure_modes(monkeypatch, problem):
    version = "a" * 20

    def fetch(_base, path):
        headers = {"Content-Type": "text/html", "Cache-Control": "no-store"}
        body = '<script src="/assets/index-new.js"></script>'
        if path == "/version.json":
            headers["Content-Type"] = "application/json"
            body = json.dumps({"version": version})
        elif path == "/.well-known/assetlinks.json":
            # Passkeys in der App (#217): die Datei muss als JSON kommen, nicht als SPA-Seite.
            if problem != "assetlinks_html":
                headers["Content-Type"] = "application/json"
                body = json.dumps([{"target": {"namespace": "android_app", "package_name": "at.lionsquad.app"}}])
        elif path == "/service-worker.js":
            headers["Content-Type"] = "application/javascript"
            body = f'const version="{version}";'
            if problem == "immutable_worker":
                headers["Cache-Control"] = "public, immutable, max-age=31536000"
            if problem == "different_worker":
                body = 'const version="old";'
        elif path.startswith("/assets/"):
            if problem != "missing_asset":
                headers["Content-Type"] = "application/javascript"
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
                # Der Einstieg lädt einen Chunk nach, der Chunk nennt den Worker (#361).
                body = 'import("./viewer-Ab12Cd34.js");' if path == "/assets/index-new.js" else 'const w=`/assets/pdf.worker.min-Ef56Gh78.mjs`;'
            if path.endswith(".mjs") and problem == "mjs_octet_stream":
                headers["Content-Type"] = "application/octet-stream"
            if path == "/assets/viewer-Ab12Cd34.js" and problem == "chunk_not_immutable":
                headers["Cache-Control"] = "no-store"
        elif path == "/verify-email":
            if problem == "cached_html":
                headers["Cache-Control"] = "public, max-age=3600"
            if problem == "old_route":
                body = '<script src="/assets/index-old.js"></script>'
        return headers, body

    monkeypatch.setattr(checker, "fetch", fetch)
    if problem:
        with pytest.raises(ValueError):
            checker.check("https://club.example")
    else:
        assert checker.check("https://club.example")["version"] == version
