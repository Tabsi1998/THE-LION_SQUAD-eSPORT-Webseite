"""Lädt beim Bau des Images das Modell des zweiten Lesers (siehe Dockerfile).

Die Quelle antwortet ab und zu mit einem Serverfehler; ein einzelner Fehlversuch darf weder den Bau beim Deploy noch die
CI abbrechen. Deshalb mehrere Versuche mit wachsender Pause. Die Prüfsumme ist fest: Eine andere Datei bricht sofort ab,
ein neuer Versuch brächte dieselbe Datei.

Aufruf: python fetch_ocr_model.py <url> <sha256-datei> <ziel>
"""
import hashlib
import sys
import time
import urllib.error
import urllib.request

ATTEMPTS = 5
FIRST_PAUSE_SECONDS = 15
TIMEOUT_SECONDS = 300


def download(url: str, *, attempts: int = ATTEMPTS, first_pause: float = FIRST_PAUSE_SECONDS) -> bytes:
    """Nur Serverfehler (5xx, 429) und Netzfehler zählen als vorübergehend; ein 404 kommt beim nächsten Mal wieder."""
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code < 500 and error.code != 429 or attempt == attempts:
                raise
            reason = f"HTTP {error.code}"
        except OSError as error:
            if attempt == attempts:
                raise
            reason = str(error)
        pause = first_pause * 2 ** (attempt - 1)
        print(f"Modell laden: Versuch {attempt} von {attempts} fehlgeschlagen ({reason}), nächster in {pause:g} s", flush=True)
        time.sleep(pause)
    raise AssertionError("unreachable")


def main(url: str, checksum_file: str, target: str) -> None:
    data = download(url)
    with open(checksum_file, encoding="ascii") as handle:
        expected = handle.read().split()[0]
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit("SHA-256 des Modells passt nicht")
    with open(target, "wb") as handle:
        handle.write(data)


if __name__ == "__main__":
    main(*sys.argv[1:4])
