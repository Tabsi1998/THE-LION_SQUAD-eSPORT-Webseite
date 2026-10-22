"""Zweiter Leser für Ergebnis- und Tabellen-Bilder (#2018): RapidOCR mit dem Erkennungsmodell PP-OCRv6 small (ONNX) -
lokal auf dem eigenen Server, kein externer Dienst.

- **Nur Erkennung:** Die Zellen findet weiter Tesseract (Zeilen, Spalten, Kopf, ``result_image_ocr``); jede Zelle wird
  aus dem Originalbild ausgeschnitten (``cell_image``) und hier nur erkannt - viele Zellen auf einmal (``recognize``).
  Was beide Leser gleich lesen, gilt als sicher (``result_image_match``); widersprechen sie sich, ist die Zelle gelb.
- **Modell fest im Image:** ``Dockerfile`` lädt die Modelldatei beim Bau (Version und SHA-256 gepinnt) nach
  ``MODEL_PATH``. Zur Laufzeit wird nie etwas geladen: fehlt die Datei oder das Paket, ist der Leser aus (``status``).
- **Einstellbar** über die Umgebung (Standard in Klammern): ``RESULT_IMAGE_SECOND_READER`` (``on``; ``off`` schaltet
  ab), ``RESULT_IMAGE_SECOND_READER_MODEL`` (Pfad der Modelldatei), ``RESULT_IMAGE_SECOND_READER_THREADS`` (2).
- **Budget wie Tesseract:** Gelesen wird im Zeitbudget des Bilds (``result_image_ocr._DEADLINE``) - in Stapeln, vor
  jedem Stapel wird die Restzeit geprüft, und ein Stapel darf höchstens die Restzeit dauern (eigener Thread). Je
  Prozess liest der Leser ein Bild zur Zeit (``_gate``). Läuft die Zeit ab oder fällt der Leser aus, fehlen seine
  Lesungen - dann gilt, was ohne ihn gilt (gelb statt grün, #2012).

Lizenz: RapidOCR und die PaddleOCR-Modelle (PP-OCRv6) stehen unter Apache-2.0.
"""
from __future__ import annotations

import importlib.util
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

logger = logging.getLogger("tls-arena.result-image")

MODE = os.environ.get("RESULT_IMAGE_SECOND_READER", "on").strip().lower()
MODEL_PATH = os.environ.get("RESULT_IMAGE_SECOND_READER_MODEL", "/opt/ocr-models/PP-OCRv6_rec_small.onnx")
MODEL_NAME = "PP-OCRv6 small"


def _threads() -> int:
    try:
        value = int(os.environ.get("RESULT_IMAGE_SECOND_READER_THREADS", "2"))
    except (TypeError, ValueError):
        return 2
    return value if value >= 1 else 2


THREADS = _threads()
# Zellen je Aufruf des Modells: einzeln ist auf 2 CPUs am schnellsten und braucht am wenigsten Speicher (gemessen #2018:
# 48 Zellen 0,34 s und +47 MB, im Stapel zu 6 0,43 s und +142 MB) - und liest wie die Messung aus #2012.
BATCH = 1
MIN_CALL_SECONDS = 0.3  # weniger Restzeit lohnt keinen Stapel mehr


@dataclass
class SecondRead:
    """Eine Lesung des zweiten Lesers: Text und Sicherheit (0-1)."""
    text: str
    score: float


@dataclass
class Result:
    """Lesungen je Zelle (``None``: nicht gelesen) und wie es lief: ``ok``, ``off``, ``missing`` (Paket oder Modell
    fehlt), ``failed`` (Fehler beim Laden oder Lesen) oder ``out_of_time``."""
    reads: list[SecondRead | None]
    status: str


_load_lock = threading.Lock()
_gate = threading.BoundedSemaphore(1)
_engine = None
_state = {"status": "", "reason": ""}  # nach dem ersten Laden: ok, off, missing oder failed


def enabled() -> bool:
    return MODE not in ("off", "0", "false", "no", "aus")


def reset() -> None:
    """Vergessen, ob und wie geladen wurde (für Tests und nach einem Wechsel der Einstellung)."""
    global _engine
    with _load_lock:
        _engine = None
        _state.update(status="", reason="")


def _load():
    """Das Modell einmal je Prozess laden - nie herunterladen. Liefert die Engine oder ``None`` (Grund: ``_state``)."""
    global _engine
    if _engine is not None or _state["status"] in ("off", "missing", "failed"):
        return _engine
    with _load_lock:
        if _engine is not None or _state["status"] in ("off", "missing", "failed"):
            return _engine
        if not enabled():
            _state.update(status="off", reason="abgeschaltet (RESULT_IMAGE_SECOND_READER=off)")
            return None
        if not Path(MODEL_PATH).is_file():
            _state.update(status="missing", reason="Modelldatei fehlt")
            logger.warning("[result-image] second reader: model file missing")
            return None
        try:
            import numpy as np
            from rapidocr import EngineType, LangRec, ModelType, OCRVersion, RapidOCR
        except ImportError:
            _state.update(status="missing", reason="Paket rapidocr fehlt")
            logger.warning("[result-image] second reader: package rapidocr missing")
            return None
        try:
            started = time.monotonic()
            engine = RapidOCR(params={
                "Global.log_level": "warning",
                # Nur Erkennung; die Modelldatei ist fest - RapidOCR lädt so nichts nach.
                "Global.model_root_dir": str(Path(MODEL_PATH).parent),
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.ocr_version": OCRVersion.PPOCRV6,
                "Rec.model_type": ModelType.SMALL,
                "Rec.lang_type": LangRec.EN,
                "Rec.model_path": MODEL_PATH,
                "Rec.rec_batch_num": 6,  # höchstens - die Stapel bildet ``recognize`` (``BATCH``)
                "EngineConfig.onnxruntime.intra_op_num_threads": THREADS,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            })
            # Gleich einmal lesen: ein Fehler zeigt sich beim Laden, nicht mitten im Bild.
            engine.recognize_txt([np.full((48, 96, 3), 255, dtype=np.uint8)])
        except Exception as exc:  # noqa: BLE001 - jeder Fehler beim Laden heißt: ohne zweiten Leser
            _state.update(status="failed", reason="Modell lässt sich nicht laden")
            logger.warning("[result-image] second reader could not be loaded: %s", type(exc).__name__)
            return None
        _engine = engine
        _state.update(status="ok", reason="")
        logger.info("[result-image] second reader %s loaded in %.1fs", MODEL_NAME, time.monotonic() - started)
        return _engine


def status() -> dict:
    """``{status: ok|off|missing|failed, reason, model}`` - lädt das Modell, wenn nötig."""
    _load()
    return {"status": _state["status"] or "failed", "reason": _state["reason"], "model": MODEL_NAME}


def presence() -> dict:
    """Für den Betrieb (``ops_checks``), ohne das Modell zu laden - das kostet Speicher, solange niemand ein Bild liest:
    eingeschaltet, Paket und Modelldatei da? Wurde schon geladen, gilt dessen Ergebnis. Form wie ``status``."""
    if _state["status"]:
        return {"status": _state["status"], "reason": _state["reason"], "model": MODEL_NAME}
    if not enabled():
        return {"status": "off", "reason": "abgeschaltet (RESULT_IMAGE_SECOND_READER=off)", "model": MODEL_NAME}
    if not Path(MODEL_PATH).is_file():
        return {"status": "missing", "reason": "Modelldatei fehlt", "model": MODEL_NAME}
    if importlib.util.find_spec("rapidocr") is None:
        return {"status": "missing", "reason": "Paket rapidocr fehlt", "model": MODEL_NAME}
    return {"status": "ok", "reason": "", "model": MODEL_NAME}


def available() -> bool:
    return _load() is not None


def cell_image(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Eine Zelle aus dem Originalbild für den zweiten Leser: hellster Farbkanal, Kontrast nur dieser Zelle gestreckt,
    dunkle Schrift auf hellem Grund (wie ``result_image_ocr._cell_reads``) - so liest er farbige Schrift und dunkelgraue
    Schrift auf dunklem Grund wie jede andere."""
    red, green, blue = img.convert("RGB").crop(box).split()
    cell = ImageOps.autocontrast(ImageChops.lighter(ImageChops.lighter(red, green), blue), cutoff=1)
    pixels = cell.tobytes()
    if sum(1 for value in pixels if value > 127) * 2 < len(pixels):
        cell = ImageOps.invert(cell)
    return cell.convert("RGB")


_executor: ThreadPoolExecutor | None = None


def _pool() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="second-reader")
    return _executor


def _run(engine, images: list) -> list[SecondRead]:
    out = engine.recognize_txt(images)
    return [SecondRead(str(text or "").strip(), float(score or 0.0)) for text, score in zip(out.txts, out.scores)]


def recognize(images: list[Image.Image], deadline: float | None = None) -> Result:
    """Die Zellen (``cell_image``) lesen - in Stapeln zu ``BATCH``, im Zeitbudget ``deadline`` (``time.monotonic``).
    Was nicht mehr gelesen wird, bleibt ``None``; ein Fehler beim Lesen lässt alle Lesungen weg."""
    reads: list[SecondRead | None] = [None] * len(images)
    if not images:
        return Result(reads, "ok")
    engine = _load()
    if engine is None:
        return Result(reads, _state["status"] or "failed")
    import numpy as np  # erst hier: ohne zweiten Leser braucht das Lesen kein numpy

    def left() -> float | None:
        return None if deadline is None else deadline - time.monotonic()

    remaining = left()
    got = _gate.acquire(timeout=max(0.0, remaining)) if remaining is not None else _gate.acquire()
    if not got:
        return Result(reads, "out_of_time")
    try:
        # Ähnlich breite Zellen zusammen: so füllt ein Stapel weniger mit leerem Rand auf (wie RapidOCR es sortiert).
        order = sorted(range(len(images)), key=lambda index: images[index].width / max(1, images[index].height))
        for start in range(0, len(order), BATCH):
            remaining = left()
            if remaining is not None and remaining < MIN_CALL_SECONDS:
                return Result(reads, "out_of_time")
            chunk = order[start:start + BATCH]
            arrays = [np.asarray(images[index].convert("RGB")) for index in chunk]
            future = _pool().submit(_run, engine, arrays)
            try:
                found = future.result(timeout=remaining)
            except FutureTimeout:
                logger.warning("[result-image] second reader ran out of time")
                return Result(reads, "out_of_time")
            except Exception as exc:  # noqa: BLE001 - ein Fehler im Modell heißt: ohne zweiten Leser
                logger.warning("[result-image] second reader failed: %s", type(exc).__name__)
                return Result([None] * len(images), "failed")
            for index, item in zip(chunk, found):
                reads[index] = item
        return Result(reads, "ok")
    finally:
        _gate.release()
