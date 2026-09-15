"""Prüft am laufenden Stack, dass nginx die öffentlichen Uploads selbst liefert (#232).

Legt ein kleines PNG direkt ins Upload-Volume (docker compose cp), holt es über
die Webseite und liest den Kopf X-TLS-Media: "nginx" heißt von der Platte,
"backend" heißt durch den API-Prozess. Die kleinere Fassung (?w=400) darf beim
ersten Abruf vom Backend kommen - es baut sie dann - und muss beim zweiten von
nginx kommen. Nur Standardbibliothek, damit es auf jedem Runner läuft.
"""
import json
import secrets
import struct
import subprocess
import sys
import zlib
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def png_bytes(width: int, height: int) -> bytes:
    """Ein einfarbiges PNG ohne Pillow - der Runner hat keins."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    row = b"\x00" + bytes((40, 120, 200)) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


def fetch(base: str, path: str, headers: dict | None = None):
    request = Request(base + path, headers={"User-Agent": "TLS-Media-Check/1.0", **(headers or {})})
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, b""


def compose(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", "compose", *args], check=check, capture_output=True, text=True)


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def check(base: str, service: str, upload_dir: str) -> dict:
    base = base.rstrip("/")
    name = f"tls-media-check-{secrets.token_hex(6)}.png"
    local = f"/tmp/{name}" if sys.platform != "win32" else name
    with open(local, "wb") as handle:
        handle.write(png_bytes(900, 600))
    remote = f"{upload_dir}/public/{name}"
    compose("cp", local, f"{service}:{remote}")
    try:
        status, headers, body = fetch(base, f"/api/static/uploads/{name}")
        expect(status == 200, f"Original: Status {status}")
        expect(headers.get("X-TLS-Media") == "nginx", f"Original kommt nicht von nginx: {headers.get('X-TLS-Media')!r}")
        expect("image/png" in headers.get("Content-Type", ""), f"Original: Content-Type {headers.get('Content-Type')!r}")
        expect("max-age" in headers.get("Cache-Control", ""), f"Original ohne Browser-Cache: {headers.get('Cache-Control')!r}")
        expect(len(body) > 100, "Original: leere Antwort")

        status, headers, body = fetch(base, f"/api/static/uploads/{name}", {"Range": "bytes=0-99"})
        expect(status == 206 and len(body) == 100, f"Bereichsanfrage: Status {status}, {len(body)} Bytes")

        status, headers, _ = fetch(base, f"/api/static/uploads/{name}?w=400")
        expect(status == 200, f"Fassung 400, erster Abruf: Status {status}")
        expect("image/webp" in headers.get("Content-Type", ""), f"Fassung 400: Content-Type {headers.get('Content-Type')!r}")
        first = headers.get("X-TLS-Media")
        expect(first in {"backend", "nginx"}, f"Fassung 400: unbekannte Quelle {first!r}")

        status, headers, _ = fetch(base, f"/api/static/uploads/{name}?w=400")
        expect(status == 200 and headers.get("X-TLS-Media") == "nginx", f"Fassung 400, zweiter Abruf: Status {status}, Quelle {headers.get('X-TLS-Media')!r} - nginx kann den Ordner variants nicht lesen?")
        expect("max-age" in headers.get("Cache-Control", ""), f"Fassung ohne Browser-Cache: {headers.get('Cache-Control')!r}")

        status, headers, _ = fetch(base, "/api/static/uploads/gibt-es-nicht.png")
        expect(status == 404, f"Fehlende Datei: Status {status}")
        expect("max-age" not in headers.get("Cache-Control", ""), "Ein 404 darf nicht 30 Tage im Cache liegen")

        status, _, _ = fetch(base, "/api/static/uploads/../chat/gibt-es-nicht.png")
        expect(status != 200, f"Pfad mit ..: Status {status}")
    finally:
        compose("exec", "-T", service, "sh", "-c", f"rm -f {remote} {upload_dir}/public/variants/{name[:-4]}-*.webp", check=False)
    return {"origin": base, "first_variant_from": first, "ok": True}


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/check-media-serving.py ORIGIN [SERVICE] [UPLOAD_DIR]")
        return 2
    base = sys.argv[1]
    service = sys.argv[2] if len(sys.argv) > 2 else "backend"
    upload_dir = sys.argv[3] if len(sys.argv) > 3 else "/app/backend/uploads"
    try:
        print(json.dumps({"read_only": False, "check": check(base, service, upload_dir)}, indent=2))
        return 0
    except (ValueError, subprocess.CalledProcessError, OSError) as error:
        detail = getattr(error, "stderr", "") or ""
        print(f"Media serving check failed: {type(error).__name__}: {error} {detail}".strip(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
