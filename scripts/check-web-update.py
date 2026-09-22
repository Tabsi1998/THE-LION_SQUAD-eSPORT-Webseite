"""Read-only checks for release consistency and browser update headers."""
import json
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def fetch(base, path):
    request = Request(base + path, headers={"Cache-Control": "no-cache", "User-Agent": "TLS-Release-Check/1.0"})
    with urlopen(request, timeout=20) as response:
        return response.headers, response.read(2_000_000).decode("utf-8")


def header_line(headers, name):
    """Alle Werte einer Kopfzeile, kommagetrennt - nginx darf Cache-Control mehrfach schicken."""
    values = headers.get_all(name) if hasattr(headers, "get_all") else [headers.get(name)]
    return ", ".join(value for value in (values or []) if value)


def check(base):
    parsed = urlsplit(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("Expected a website origin without credentials, path or query")
    base = base.rstrip("/")
    manifest_headers, manifest = fetch(base, "/version.json")
    version = json.loads(manifest)["version"]
    if not isinstance(version, str) or not re.fullmatch(r"[a-f0-9]{20}", version):
        raise ValueError("Invalid release version")
    worker_headers, worker = fetch(base, "/service-worker.js")
    for headers in (manifest_headers, worker_headers):
        cache = headers.get("Cache-Control", "").lower()
        if "no-store" not in cache or "immutable" in cache:
            raise ValueError("Service worker/version manifest must use Cache-Control: no-store")
    if version not in worker or "javascript" not in worker_headers.get("Content-Type", ""):
        raise ValueError("Service worker does not match release manifest")
    root_assets = None
    for path in ("/", "/login", "/verify-email", "/dashboard"):
        headers, html = fetch(base, path)
        if "text/html" not in headers.get("Content-Type", "") or "no-store" not in headers.get("Cache-Control", "").lower():
            raise ValueError(f"{path}: HTML content or cache policy incorrect")
        assets = sorted(set(re.findall(r'assets/[^"\s<>]+\.(?:js|css)', html)))
        if not assets or (root_assets is not None and assets != root_assets):
            raise ValueError(f"{path}: stale or missing application assets")
        root_assets = assets
    # Jede Skriptdatei, die die Bundles nachladen (auch Worker als .mjs), muss als JavaScript
    # und unveränderlich gecacht kommen. Ein .mjs als octet-stream sah man nur im Browser:
    # „Setting up fake worker failed“, kein PDF (#361). Zwei Ebenen: Einstieg → Chunks → Worker.
    seen, queue, checked = set(), list(root_assets), 0
    while queue and checked < 400:
        asset = queue.pop(0)
        if asset in seen:
            continue
        seen.add(asset)
        headers, body = fetch(base, "/" + asset)
        checked += 1
        content_type = headers.get("Content-Type", "")
        if "text/html" in content_type:
            raise ValueError(f"Missing application asset returned HTML: {asset}")
        if asset.endswith((".js", ".mjs")):
            if "javascript" not in content_type:
                raise ValueError(f"{asset}: served as {content_type or 'unknown'} instead of JavaScript")
            if "immutable" not in header_line(headers, "Cache-Control").lower():
                raise ValueError(f"{asset}: application asset must be cached immutable")
            # Vite schreibt Nachlade-Pfade relativ (`./chunk.js`) und Worker-Adressen absolut (`/assets/x.mjs`);
            # nur Namen mit Vite-Hash zählen - `./pdf.worker.mjs` in pdf.js ist ein interner Ersatzname, keine Datei.
            for name in set(re.findall(r'(?:assets/|\./)([\w.-]+-[\w-]{8}\.(?:js|mjs))', body)):
                ref = "assets/" + name
                if ref not in seen:
                    queue.append(ref)
    return {"origin": base, "version": version, "ok": True, "assets_checked": checked}


def main():
    if len(sys.argv) not in {2, 3}:
        print("Usage: python scripts/check-web-update.py ORIGIN [PUBLIC_ORIGIN]")
        return 2
    try:
        reports = [check(origin) for origin in sys.argv[1:]]
        if len({report["version"] for report in reports}) != 1:
            raise ValueError("Public proxy serves a different release than the local frontend")
        print(json.dumps({"read_only": True, "checks": reports}, indent=2))
        return 0
    except Exception as error:
        print(f"Web release check failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
