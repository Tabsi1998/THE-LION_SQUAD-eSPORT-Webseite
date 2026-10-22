"""Zeichnet ein bereinigtes SVG als PNG - als eigener Prozess, gestartet von ``services.svg_logo._render`` (#1952).

Aufruf: ``python -I svg_raster_worker.py <breite> <speicher-mb> <rechenzeit-s>``; das SVG kommt über stdin, das PNG
geht über stdout. Unter Linux setzt der Prozess sich selbst Grenzen für Speicher und Rechenzeit, bevor er etwas liest -
ein zu aufwendiges Bild endet hier, nicht im Server. Rückgabe 3: resvg konnte das Dokument nicht lesen; 4: Speicher zu
Ende. Bewusst ohne Import aus dem Backend (``-I``: kein Suchpfad außer den installierten Paketen).
"""
import sys


def _limit(memory_mb: int, cpu_seconds: int) -> None:
    try:
        import resource
    except ImportError:  # Windows: nur die Zeitgrenze des aufrufenden Prozesses
        return
    memory = memory_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))


def main() -> int:
    width, memory_mb, cpu_seconds = (int(value) for value in sys.argv[1:4])
    _limit(memory_mb, cpu_seconds)
    data = sys.stdin.buffer.read()
    try:
        import resvg_py

        png = resvg_py.svg_to_bytes(svg_string=data.decode("utf-8"), width=width)
    except MemoryError:
        return 4
    except Exception:  # noqa: BLE001 - jede andere Störung: Dokument nicht lesbar
        return 3
    sys.stdout.buffer.write(bytes(png))
    return 0


if __name__ == "__main__":
    sys.exit(main())
