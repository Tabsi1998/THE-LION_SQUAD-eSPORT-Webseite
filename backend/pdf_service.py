"""PDF export service using reportlab. Brand-consistent THE LION SQUAD PDFs."""
import io
import os
import re
from pathlib import Path
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)
from PIL import Image

# Bildschirmfarben der Plattform. Sie bleiben als schmale Linien und Akzente,
# tragen aber keinen Text auf hellem Grund.
CYAN = colors.HexColor("#29B6E8")
GOLD = colors.HexColor("#D6B45F")
BLACK = colors.HexColor("#0A0A0A")
WHITE = colors.white

# Druckfarben. Diese Dateien landen auf Papier: heller Grund, dunkle Schrift,
# Akzente als schmale Linien statt als Flächen. Eine ganzseitig schwarze A4
# kostet eine Menge Toner und liest sich ausgedruckt schlechter, nicht besser.
PAPER = colors.white
INK = colors.HexColor("#14181D")
INK_SOFT = colors.HexColor("#5A6472")
INK_FAINT = colors.HexColor("#8B95A3")
RULE = colors.HexColor("#D7DDE4")
TINT = colors.HexColor("#F3F6F9")
# Das Cyan des Bildschirms hat auf hellem Grund zu wenig Kontrast: Text nimmt
# die dunklere Variante, Linien weiter die helle.
CYAN_INK = colors.HexColor("#10688A")
GOLD_INK = colors.HexColor("#8A6D22")
MUTED = INK_SOFT
DARK = TINT
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_BRAND_DIR = REPO_ROOT / "frontend" / "public" / "assets" / "brand"


# Die Liste ging bisher von einem Feld "tag" aus, das Teams gar nicht führen -
# die Spalte blieb deshalb immer leer. Name zuerst, Kürzel als Rückfall.
def _team_label(team) -> str:
    if not isinstance(team, dict):
        return "—"
    for key in ("name", "tag", "title"):
        value = (team.get(key) or "").strip() if isinstance(team.get(key), str) else team.get(key)
        if value:
            return str(value)
    return "—"


# Auf einer ausgedruckten Liste stand bisher "checked_in".
REGISTRATION_STATUS_LABELS = {
    "pending": "Offen",
    "approved": "Bestätigt",
    "rejected": "Abgelehnt",
    "waitlist": "Warteliste",
    "checked_in": "Eingecheckt",
    "no_show": "Nicht erschienen",
    "cancelled": "Abgemeldet",
    "registered": "Angemeldet",
}


def _registration_status_label(status) -> str:
    key = str(status or "").strip()
    if not key:
        return "—"
    return REGISTRATION_STATUS_LABELS.get(key, key.replace("_", " ").capitalize())


# Im Matchplan stand die Uhrzeit als roher ISO-Zeitstempel
# ("2026-09-13T19:30:00+00:00"). Der ist doppelt so breit wie die Spalte und
# lief deshalb in die Nachbarspalte - eine der Ueberlappungen, die gemeldet
# wurden. Gespeichert wird in UTC; gedruckt wird die Zeit des Vereins.
MATCH_STATUS_LABELS = {
    "pending": "Offen",
    "ready": "Bereit",
    "scheduled": "Angesetzt",
    "in_progress": "Läuft",
    "waiting_result": "Wartet auf Ergebnis",
    "disputed": "Strittig",
    "completed": "Beendet",
    "forfeit": "Gewertet",
    "cancelled": "Abgesagt",
}


def _match_status_label(status) -> str:
    key = str(status or "").strip()
    if not key:
        return "—"
    return MATCH_STATUS_LABELS.get(key, key.replace("_", " ").capitalize())


def _pdf_datetime_label(value, tz_name: str | None = None) -> str:
    """Ein Termin, wie er auf Papier lesbar ist: 13.09.2026 21:30."""
    if not value:
        return "—"
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return _normalize_pdf_text(str(value))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_timezone.utc)
    try:
        moment = moment.astimezone(ZoneInfo(tz_name or "Europe/Vienna"))
    except Exception:
        moment = moment.astimezone(dt_timezone.utc)
    return moment.strftime("%d.%m.%Y %H:%M")


def _base_styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle(name="TLSTitle", fontName="Helvetica-Bold", fontSize=20,
                          textColor=INK, leading=24, spaceAfter=8))
    s.add(ParagraphStyle(name="TLSSubtitle", fontName="Helvetica-Bold", fontSize=8.5,
                          textColor=CYAN_INK, leading=12, letterSpacing=1, spaceAfter=10))
    s.add(ParagraphStyle(name="TLSSection", fontName="Helvetica-Bold", fontSize=12,
                          textColor=CYAN_INK, leading=16, spaceBefore=12, spaceAfter=6))
    s.add(ParagraphStyle(name="TLSBody", fontName="Helvetica", fontSize=9,
                          textColor=INK, leading=12))
    s.add(ParagraphStyle(name="TLSFoot", fontName="Helvetica", fontSize=7,
                          textColor=INK_SOFT, leading=9))
    return s


def _header(story, styles, subtitle: str, title: str):
    story.append(Paragraph(escape(_normalize_pdf_text(f"THE LION SQUAD eSports · {subtitle}")), styles["TLSSubtitle"]))
    story.append(Paragraph(escape(_normalize_pdf_text(title)), styles["TLSTitle"]))
    story.append(Spacer(1, 10))


def _normalize_pdf_text(text: str | None, *, strip_trailing_separator: bool = True) -> str:
    value = str(text or "").replace("\u00a0", " ").strip()
    value = re.sub(r"\s*•\s*", " • ", value)
    value = re.sub(r"\s*\|\s*", " | ", value)
    value = re.sub(r"\s+", " ", value).strip()
    if strip_trailing_separator:
        value = re.sub(r"(?:[•|]\s*)+$", "", value).strip()
    return value


def _page_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], fill=1, stroke=0)
    # Schmale Akzentlinie oben statt einer schwarzen Fläche über die ganze Seite.
    canvas.setFillColor(CYAN)
    canvas.rect(0, doc.pagesize[1] - 3, doc.pagesize[0], 3, fill=1, stroke=0)
    _draw_brand_header(canvas, doc, getattr(doc, "tls_pdf_branding", {}))
    _draw_sponsor_footer(canvas, doc, getattr(doc, "tls_pdf_sponsors", []))
    # Footer
    canvas.setFillColor(INK_FAINT)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(2 * cm, 0.72 * cm, "THE LION SQUAD eSports - Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    canvas.drawRightString(doc.pagesize[0] - 2 * cm, 0.72 * cm, f"Page {doc.page}")
    canvas.restoreState()


def _local_upload_path(url: str | None) -> Path | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    path = urlparse(raw).path or raw
    if not path.startswith(("/api/static/uploads/", "/static/uploads/", "/uploads/")):
        return None
    filename = Path(path).name
    for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
        candidate = base / filename
        if candidate.is_file():
            return candidate
    return None


def _brand_asset_path(url: str | None) -> Path | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    path = urlparse(raw).path or raw
    if path.startswith("/assets/brand/"):
        candidate = FRONTEND_BRAND_DIR / Path(path).name
        return candidate if candidate.is_file() else None
    return _local_upload_path(raw)


def _draw_logo(canvas, path: Path, x: float, y: float, max_w: float, max_h: float, crop_transparent: bool = False) -> bool:
    try:
        if crop_transparent:
            with Image.open(str(path)).convert("RGBA") as source:
                bbox = source.getchannel("A").getbbox()
                if bbox:
                    left, top, right, bottom = bbox
                    pad = max(2, int(max(right - left, bottom - top) * 0.03))
                    crop_box = (
                        max(0, left - pad),
                        max(0, top - pad),
                        min(source.width, right + pad),
                        min(source.height, bottom + pad),
                    )
                    img = ImageReader(source.crop(crop_box))
                else:
                    img = ImageReader(source)
        else:
            img = ImageReader(str(path))
        width, height = img.getSize()
        if not width or not height:
            return False
        ratio = min(max_w / width, max_h / height)
        draw_w = width * ratio
        draw_h = height * ratio
        canvas.drawImage(img, x + (max_w - draw_w) / 2, y + (max_h - draw_h) / 2, draw_w, draw_h, mask="auto")
        return True
    except Exception:
        return False


# Der Branding-Bereich führt jedes Logo doppelt: eine Fassung für dunklen und
# eine für hellen Hintergrund. PDFs landen auf Papier und sind hell, brauchen
# also die helle Fassung. Ein Logo "für dunklen Hintergrund" ist meist weiß und
# auf Papier schlicht unsichtbar - genau das war beim Maskottchen der Fall.
def _light_brand_path(branding: dict | None, *extra_urls) -> Path | None:
    branding = branding or {}
    # Bewusst ohne Maskottchen und QR-Logo: beide sind auf den dunklen Auftritt
    # gezeichnet und meist rein hell. Findet sich keine passende Fassung, malt
    # der Aufrufer lieber den Schriftzug als ein Logo, das auf Papier verschwindet.
    for url in (
        *extra_urls,
        branding.get("pdf_logo_url"),
        branding.get("logo_light_url"),
        branding.get("favicon_light_url"),
        branding.get("logo_url"),
    ):
        path = _brand_asset_path(url)
        if path:
            return path
    return None


def _draw_brand_header(canvas, doc, branding: dict | None):
    branding = branding or {}
    page_w, page_h = doc.pagesize
    logo_path = _light_brand_path(branding) or _brand_asset_path("/assets/brand/tls-wordmark.png")
    x = 2 * cm
    y = page_h - 1.85 * cm
    if not (logo_path and _draw_logo(canvas, logo_path, x, y, 4.8 * cm, 1.1 * cm)):
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(x, y + 0.42 * cm, "THE LION SQUAD")
        canvas.setFillColor(CYAN_INK)
        canvas.setFont("Helvetica-Bold", 6)
        canvas.drawString(x, y + 0.16 * cm, "E-SPORTS")

    domain = str(branding.get("domain") or "lionsquad.at").replace("https://", "").replace("http://", "").strip("/")
    canvas.setFillColor(INK_SOFT)
    canvas.setFont("Helvetica-Bold", 6)
    canvas.drawRightString(page_w - 2 * cm, y + 0.48 * cm, domain.upper())
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, page_h - 2.08 * cm, page_w - 2 * cm, page_h - 2.08 * cm)


def _draw_cover_image(canvas, path: Path, page_w: float, page_h: float, opacity: float = 0.13) -> bool:
    try:
        img = ImageReader(str(path))
        width, height = img.getSize()
        if not width or not height:
            return False
        scale = max(page_w / width, page_h / height)
        draw_w = width * scale
        draw_h = height * scale
        canvas.saveState()
        if hasattr(canvas, "setFillAlpha"):
            canvas.setFillAlpha(opacity)
        canvas.drawImage(img, (page_w - draw_w) / 2, (page_h - draw_h) / 2, draw_w, draw_h, mask="auto")
        canvas.restoreState()
        return True
    except Exception:
        return False


def _watermark_shape(path: Path, tint=(118, 130, 143)):
    """Die Silhouette einer Vorlage, eingefärbt und auf ihren Inhalt beschnitten.

    Die Farbe der Vorlage spielt keine Rolle: das Maskottchen ist reinweiß und
    auf Papier sonst unsichtbar.
    """
    with Image.open(str(path)).convert("RGBA") as source:
        alpha = source.getchannel("A")
        bbox = alpha.getbbox()
        if bbox:
            alpha = alpha.crop(bbox)
        shape = Image.new("RGBA", alpha.size, tuple(tint) + (0,))
        shape.putalpha(alpha)
        return ImageReader(shape)


def _draw_tiled_watermark(canvas, path: Path, page_w: float, page_h: float, *,
                          size: float = 3.4 * cm, gap: float = 2.4 * cm,
                          opacity: float = 0.055, angle: float = 18.0) -> bool:
    """Das Maskottchen als versetztes Muster über die ganze Seite.

    Ein Turnierbanner taugt schlecht als Wasserzeichen: es trägt meist selbst
    Schrift, und die liest sich quer über der Urkunde als zweiter Text. Ein
    wiederholtes Zeichen trägt keine Bedeutung und stört deshalb nicht - es
    bleibt Papier mit Muster.

    Jede zweite Reihe ist versetzt, damit kein Gitter entsteht.
    """
    try:
        reader = _watermark_shape(path)
        width, height = reader.getSize()
        if not width or not height:
            return False
        ratio = min(size / width, size / height)
        tile_w, tile_h = width * ratio, height * ratio
        step_x = tile_w + gap
        step_y = tile_h + gap

        canvas.saveState()
        if hasattr(canvas, "setFillAlpha"):
            canvas.setFillAlpha(opacity)
        canvas.translate(page_w / 2, page_h / 2)
        canvas.rotate(angle)
        # Gedreht wird um die Seitenmitte, deshalb muss das Muster über die
        # Diagonale hinausreichen, damit keine Ecke leer bleibt.
        reach = (page_w + page_h) / 1.6
        row = 0
        y = -reach
        while y < reach:
            offset = (step_x / 2) if row % 2 else 0.0
            x = -reach + offset
            while x < reach:
                canvas.drawImage(reader, x, y, tile_w, tile_h, mask="auto")
                x += step_x
            y += step_y
            row += 1
        canvas.restoreState()
        return True
    except Exception:
        return False


def _draw_watermark_logo(canvas, path: Path, center_x: float, center_y: float,
                         max_size: float, opacity: float = 0.12,
                         tint=(118, 130, 143)) -> bool:
    """Zeichnet nur die Form eines Logos als flächige Tönung.

    Das Vereinsmaskottchen ist reinweiß - gezeichnet für den dunklen Auftritt
    am Bildschirm. Auf hellem Papier wäre es bei jeder Deckkraft unsichtbar.
    Für ein Wasserzeichen zählt deshalb die Silhouette, nicht die Farbe der
    Vorlage; ein echtes Spiel-Banner bringt seine eigenen Farben mit und wird
    unverändert gezeichnet.
    """
    try:
        with Image.open(str(path)).convert("RGBA") as source:
            alpha = source.getchannel("A")
            bbox = alpha.getbbox()
            if bbox:
                alpha = alpha.crop(bbox)
            shape = Image.new("RGBA", alpha.size, tuple(tint) + (0,))
            shape.putalpha(alpha)
            reader = ImageReader(shape)
        width, height = reader.getSize()
        if not width or not height:
            return False
        ratio = min(max_size / width, max_size / height)
        draw_w, draw_h = width * ratio, height * ratio
        canvas.saveState()
        if hasattr(canvas, "setFillAlpha"):
            canvas.setFillAlpha(opacity)
        canvas.drawImage(reader, center_x - draw_w / 2, center_y - draw_h / 2,
                         draw_w, draw_h, mask="auto")
        canvas.restoreState()
        return True
    except Exception:
        return False


def _draw_alpha_rect(canvas, x: float, y: float, width: float, height: float, color, opacity: float) -> None:
    canvas.saveState()
    if hasattr(canvas, "setFillAlpha"):
        canvas.setFillAlpha(opacity)
    canvas.setFillColor(color)
    canvas.rect(x, y, width, height, fill=1, stroke=0)
    canvas.restoreState()


def _draw_alpha_logo(
    canvas,
    path: Path,
    x: float,
    y: float,
    max_w: float,
    max_h: float,
    opacity: float,
    crop_transparent: bool = False,
) -> bool:
    canvas.saveState()
    if hasattr(canvas, "setFillAlpha"):
        canvas.setFillAlpha(opacity)
    drawn = _draw_logo(canvas, path, x, y, max_w, max_h, crop_transparent=crop_transparent)
    canvas.restoreState()
    return drawn


def _draw_sponsor_footer(canvas, doc, sponsors: list | None):
    sponsors = [s for s in (sponsors or []) if s.get("name") or s.get("logo_url")]
    if not sponsors:
        return
    page_w = doc.pagesize[0]
    max_items = 8 if page_w > 22 * cm else 6
    sponsors = sponsors[:max_items]
    band_top = 2.85 * cm
    canvas.setFillColor(TINT)
    canvas.rect(0, 0.95 * cm, page_w, band_top - 0.95 * cm, fill=1, stroke=0)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, band_top, page_w - 2 * cm, band_top)
    canvas.setFillColor(CYAN_INK)
    canvas.setFont("Helvetica-Bold", 6)
    canvas.drawCentredString(page_w / 2, 2.46 * cm, "PRESENTED BY OUR PARTNERS")
    gap = 4 * mm
    available_w = page_w - 4 * cm
    slot_w = min(4.8 * cm, (available_w - gap * (len(sponsors) - 1)) / max(1, len(sponsors)))
    slot_h = 9.5 * mm
    start_x = (page_w - (slot_w * len(sponsors) + gap * (len(sponsors) - 1))) / 2
    y = 1.38 * cm
    for index, sponsor in enumerate(sponsors):
        x = start_x + index * (slot_w + gap)
        logo_path = _local_upload_path(sponsor.get("logo_url"))
        drawn = bool(logo_path and _draw_logo(canvas, logo_path, x, y, slot_w, slot_h))
        if not drawn:
            canvas.setFillColor(INK)
            canvas.setFont("Helvetica-Bold", 6.5)
            canvas.drawCentredString(x + slot_w / 2, y + 3.5 * mm, str(sponsor.get("name") or "")[:28])


def _placement_label(rank: int | str | None) -> str:
    try:
        value = int(rank or 0)
    except (TypeError, ValueError):
        value = 0
    return {
        1: "1. Platz",
        2: "2. Platz",
        3: "3. Platz",
        4: "4. Platz",
    }.get(value, f"{value}. Platz" if value else "Platzierung")


def _certificate_title(rank: int | str | None) -> str:
    try:
        value = int(rank or 0)
    except (TypeError, ValueError):
        value = 0
    return {
        1: "Siegerurkunde",
        2: "Urkunde zum 2. Platz",
        3: "Urkunde zum 3. Platz",
        4: "Urkunde zum 4. Platz",
    }.get(value, "Teilnahmeurkunde")


def _doc(buffer, title: str, orientation="portrait", sponsors: list | None = None, branding: dict | None = None):
    size = landscape(A4) if orientation == "landscape" else A4
    doc = SimpleDocTemplate(buffer, pagesize=size, title=_normalize_pdf_text(title),
                              leftMargin=2 * cm, rightMargin=2 * cm,
                              topMargin=3.0 * cm, bottomMargin=3.35 * cm)
    doc.tls_pdf_sponsors = sponsors or []
    doc.tls_pdf_branding = branding or {}
    return doc


def _table_style():
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TINT),
        ("TEXTCOLOR", (0, 0), (-1, 0), CYAN_INK),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        # Zeilenwechsel als ganz helle Tönung: am Bildschirm erkennbar, im Druck
        # sparsam. Ein Vollton je zweiter Zeile ist beides nicht.
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PAPER, TINT]),
        ("LINEBELOW", (0, 0), (-1, 0), 1, CYAN_INK),
        ("GRID", (0, 1), (-1, -1), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ])


def pdf_participants(tournament: dict, registrations: list, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Teilnehmer - {tournament.get('title','')}", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, "Teilnehmerliste", tournament.get("title", ""))
    data = [["#", "Spieler", "Discord", "Team", "Status"]]
    for i, r in enumerate(registrations, 1):
        data.append([
            str(i),
            r.get("display_name") or r.get("ingame_name") or "—",
            r.get("discord") or "—",
            _team_label(r.get("team")),
            _registration_status_label(r.get("status")),
        ])
    t = Table(data, colWidths=[1.2 * cm, 7 * cm, 4 * cm, 2.5 * cm, 3 * cm], repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()


def pdf_f1_leaderboard(challenge: dict, track: dict, entries: list, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"F1 {challenge.get('title','')} - {track.get('name','') if track else ''}", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, f"F1 Fast Lap · {track.get('name','')}", challenge.get("title", ""))
    data = [["Rang", "Fahrer", "Beste Zeit", "Abstand", "Versuche"]]
    for e in entries:
        data.append([str(e.get("rank", "")),
                     e.get("display_name", "—"),
                     e.get("time_str", "—"),
                     e.get("gap_str") or ("Leader" if e.get("rank") == 1 else ""),
                     str(e.get("attempts", ""))])
    t = Table(data, colWidths=[1.5 * cm, 7 * cm, 3.5 * cm, 3 * cm, 2.5 * cm], repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()


def _pdf_registration_name(registration: dict | None) -> str:
    return str(
        (registration or {}).get("display_name")
        or (registration or {}).get("ingame_name")
        or "TBD"
    )


def _pdf_slot_position(slot: dict) -> int:
    try:
        return int(slot.get("position") or slot.get("slot") or 999)
    except (TypeError, ValueError):
        return 999


def _pdf_match_slots(match: dict) -> list[dict]:
    if match.get("slots"):
        return sorted(
            match.get("slots") or [],
            key=_pdf_slot_position,
        )
    return [
        {"position": 1, "registration_id": match.get("participant_a_id")},
        {"position": 2, "registration_id": match.get("participant_b_id")},
    ]


def _pdf_result_value(result: dict | None, *, include_rank: bool = False) -> str:
    if not result:
        return ""
    value = result.get("points")
    suffix = " P"
    if value is None:
        value = result.get("score")
        suffix = ""
    if value is None and result.get("time_ms") is not None:
        value = f"{result['time_ms']} ms"
        suffix = ""
    rank = result.get("rank")
    if value is not None and include_rank and rank is not None:
        return f"#{rank} · {value}{suffix}"
    if value is not None:
        return f"{value}{suffix}"
    return f"#{rank}" if rank is not None else ""


def _pdf_duel_row(match: dict, reg_map: dict) -> list[str]:
    slots = _pdf_match_slots(match)
    slot_a = slots[0] if slots else {}
    slot_b = slots[1] if len(slots) > 1 else {}
    result_map = {
        result.get("registration_id"): result
        for result in match.get("results") or []
        if result.get("registration_id")
    }
    registration_a = slot_a.get("registration_id")
    registration_b = slot_b.get("registration_id")
    score_a = _pdf_result_value(result_map.get(registration_a))
    score_b = _pdf_result_value(result_map.get(registration_b))
    if not match.get("slots"):
        score_a = str(match.get("score_a", 0))
        score_b = str(match.get("score_b", 0))
    return [
        match.get("round_name") or f"R{match.get('round')}",
        _pdf_registration_name(reg_map.get(registration_a)),
        f"{score_a or '—'} : {score_b or '—'}",
        _pdf_registration_name(reg_map.get(registration_b)),
        _pdf_datetime_label(match.get("scheduled_at")),
        match.get("station_label") or match.get("station_name") or match.get("station_id") or "—",
        _match_status_label(match.get("status")),
    ]


def _pdf_multi_slot_rows(match: dict, reg_map: dict) -> list[list[str]]:
    result_map = {
        result.get("registration_id"): result
        for result in match.get("results") or []
        if result.get("registration_id")
    }
    rows = []
    slots = _pdf_match_slots(match)
    for index, slot in enumerate(slots):
        registration_id = slot.get("registration_id")
        name = _pdf_registration_name(reg_map.get(registration_id))
        value = _pdf_result_value(result_map.get(registration_id), include_rank=True)
        rows.append([
            (match.get("round_name") or f"R{match.get('round')}") if index == 0 else "",
            f"{name} ({value})" if value else name,
            _pdf_datetime_label(match.get("scheduled_at")) if index == 0 else "",
            (match.get("station_label") or match.get("station_name") or match.get("station_id") or "—") if index == 0 else "",
            _match_status_label(match.get("status")) if index == 0 else "",
        ])
    return rows or [[
        match.get("round_name") or f"R{match.get('round')}",
        "TBD",
        _pdf_datetime_label(match.get("scheduled_at")),
        match.get("station_label") or match.get("station_name") or match.get("station_id") or "—",
        _match_status_label(match.get("status")),
    ]]


# ReportLab bricht einfache Zeichenketten in einer Tabelle nicht um: ein langer
# Name lief deshalb aus seiner Spalte in die Nachbarspalte. Das war eine der
# gemeldeten Kollisionen - sichtbar erst bei Namen, die lang genug sind.
def _fit_rows_to_columns(rows: list[list[str]], widths: list[float],
                         padding: float = 16.0, font_name: str = "Helvetica",
                         font_size: int = 9) -> list[list[str]]:
    fitted = []
    for row in rows:
        fitted.append([
            _truncate_to_width(str(cell), max(10.0, widths[index] - padding), font_name, font_size)
            if index < len(widths) else str(cell)
            for index, cell in enumerate(row)
        ])
    return fitted


def _pdf_match_table(matches: list, reg_map: dict) -> tuple[list[str], list[list[str]], list]:
    multi_slot = any(len(_pdf_match_slots(match)) > 2 for match in matches)
    if multi_slot:
        headers = ["Runde", "Teilnehmer / Ergebnis", "Zeit", "Station", "Status"]
        rows = [row for match in matches for row in _pdf_multi_slot_rows(match, reg_map)]
        widths = [3 * cm, 13 * cm, 3.25 * cm, 3 * cm, 3.25 * cm]
    else:
        headers = ["Runde", "Teilnehmer A", "vs", "Teilnehmer B", "Zeit", "Station", "Status"]
        rows = [_pdf_duel_row(match, reg_map) for match in matches]
        # Die Zeitspalte muss "13.09.2026 21:30" ganz fassen; mit 3 cm blieb
        # davon "13.09.2026 21:..." stehen.
        widths = [3 * cm, 5.7 * cm, 2.2 * cm, 5.7 * cm, 3.7 * cm, 2.6 * cm, 3.2 * cm]
    return headers, _fit_rows_to_columns(rows, widths), widths


def pdf_matches(tournament: dict, matches: list, reg_map: dict, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Matchplan - {tournament.get('title','')}", "landscape", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, "Matchplan", tournament.get("title", ""))
    headers, rows, widths = _pdf_match_table(matches, reg_map)
    t = Table([headers, *rows], colWidths=widths, repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()


def pdf_standings(tournament: dict, rows: list, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Standings - {tournament.get('title','')}", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, "Standings", tournament.get("title", ""))
    data = [["Rang", "Spieler", "Siege", "Niederlagen", "Punkte"]]
    for r in rows:
        data.append([str(r.get("rank", "")),
                     r.get("display_name", "—"),
                     str(r.get("won") or r.get("wins") or 0),
                     str(r.get("lost") or r.get("losses") or 0),
                     str(r.get("points") or r.get("furthest_round") or 0)])
    t = Table(data, colWidths=[1.5 * cm, 8 * cm, 2.5 * cm, 3 * cm, 2.5 * cm], repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()


def pdf_checkin(tournament: dict, registrations: list, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Check-in - {tournament.get('title','')}", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, "Check-in Liste", tournament.get("title", ""))
    data = [["#", "Spieler", "Discord", "Check-in", "Unterschrift"]]
    for i, r in enumerate(registrations, 1):
        checked = "☑" if r.get("status") == "checked_in" else "☐"
        data.append([str(i), r.get("display_name", "—"), r.get("discord") or "—", checked, "________________"])
    t = Table(data, colWidths=[1.2 * cm, 6 * cm, 4 * cm, 2 * cm, 5 * cm], repeatRows=1)
    t.setStyle(_table_style())
    story.append(t)
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    return buf.getvalue()


def _fit_font_size(text: str, max_width: float, font_name: str = "Helvetica-Bold", start: int = 72, minimum: int = 28) -> int:
    value = str(text or "").strip() or "Station"
    size = start
    while size > minimum and stringWidth(value, font_name, size) > max_width:
        size -= 2
    return size


def _truncate_to_width(text: str, max_width: float, font_name: str, font_size: int) -> str:
    value = str(text or "").strip()
    if stringWidth(value, font_name, font_size) <= max_width:
        return value
    suffix = "..."
    while value and stringWidth(value + suffix, font_name, font_size) > max_width:
        value = value[:-1].rstrip()
    return (value + suffix) if value else suffix


def _wrap_to_width(text: str, max_width: float, font_name: str, font_size: int, max_lines: int) -> list[str]:
    words = str(text or "").strip().split()
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
            continue
        lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if lines:
        lines[-1] = _truncate_to_width(lines[-1], max_width, font_name, font_size)
    return lines


# Helvetica ragt rund 0,76 der Schriftgröße über die Grundlinie und 0,24
# darunter. Wer Blöcke stapelt, muss damit rechnen.
TEXT_ASCENT = 0.76
TEXT_DESCENT = 0.24


def _fit_lines(text: str, max_width: float, font_name: str, start_size: int,
               min_size: int, max_lines: int) -> tuple[list[str], int]:
    """Zeilen und Schriftgröße - dieselbe Rechnung, die auch gezeichnet wird."""
    value = str(text or "").strip()
    size = start_size
    lines = [value]
    while size > min_size:
        lines = _wrap_to_width(value, max_width, font_name, size, max_lines)
        if len(lines) <= max_lines and all(stringWidth(line, font_name, size) <= max_width for line in lines):
            break
        size -= 1
    return _wrap_to_width(value, max_width, font_name, size, max_lines), size


def text_block(top: float, text: str, *, max_width: float, start_size: int, min_size: int,
               font_name: str = "Helvetica-Bold", max_lines: int = 2,
               leading_factor: float = 1.1, gap_before: float = 0.0) -> dict:
    """Ein Textblock, gestapelt an seiner Oberkante statt an der Grundlinie.

    Genau hier steckte der Fehler auf der Urkunde: der Code rückte um einen
    festen Abstand weiter und setzte dort die *Grundlinie* der nächsten Zeile.
    Bei 35 pt ragt die Versalhöhe aber 0,86 cm über die Grundlinie, während der
    Abstand 0,72 cm betrug - die Überschrift lief zwangsläufig in die Zeile
    darüber. Ein Block kennt jetzt Oberkante, Höhe und Unterkante, und ein
    Stapel daraus kann sich nicht mehr selbst überlappen.
    """
    lines, size = _fit_lines(text, max_width, font_name, start_size, min_size, max_lines)
    block_top = top - gap_before
    leading = size * leading_factor
    height = size * TEXT_ASCENT + leading * (len(lines) - 1) + size * TEXT_DESCENT
    return {
        "lines": lines,
        "size": size,
        "font": font_name,
        "leading": leading,
        "top": block_top,
        "first_baseline": block_top - size * TEXT_ASCENT,
        "bottom": block_top - height,
        "height": height,
    }


def _draw_text_block(canvas, block: dict, center_x: float, color) -> float:
    canvas.setFillColor(color)
    canvas.setFont(block["font"], block["size"])
    y = block["first_baseline"]
    for line in block["lines"]:
        canvas.drawCentredString(center_x, y, line)
        y -= block["leading"]
    return block["bottom"]


def _certificate_stack_at(page_w: float, top: float, scale: float, *, subtitle: str,
                          headline: str, recipient: str, occasion: str) -> list[dict]:
    blocks = [text_block(
        top, subtitle.upper(), max_width=page_w - 5.2 * cm,
        start_size=9, min_size=7, max_lines=1, leading_factor=1.2, gap_before=0)]
    blocks.append(text_block(
        blocks[-1]["bottom"], headline.upper(), max_width=page_w - 4.6 * cm,
        start_size=max(19, int(34 * scale)), min_size=19, max_lines=2,
        leading_factor=1.10, gap_before=0.42 * cm * scale))
    blocks.append(text_block(
        blocks[-1]["bottom"], "AUSGEZEICHNET WIRD", max_width=page_w - 5.2 * cm,
        start_size=8.5, min_size=7, max_lines=1, leading_factor=1.2, gap_before=0.52 * cm * scale))
    blocks.append(text_block(
        blocks[-1]["bottom"], recipient, max_width=page_w - 4.0 * cm,
        start_size=max(18, int(36 * scale)), min_size=18, max_lines=2,
        leading_factor=1.06, gap_before=0.34 * cm * scale))
    blocks.append(text_block(
        blocks[-1]["bottom"], "für die Leistung bei", max_width=page_w - 5.2 * cm,
        font_name="Helvetica", start_size=9.5, min_size=8, max_lines=1,
        leading_factor=1.2, gap_before=0.62 * cm * scale))
    blocks.append(text_block(
        blocks[-1]["bottom"], occasion, max_width=page_w - 4.6 * cm,
        start_size=max(9, int(15 * scale)), min_size=9, max_lines=3,
        leading_factor=1.16, gap_before=0.26 * cm * scale))
    return blocks


def certificate_text_stack(page_w: float, top: float, *, subtitle: str, headline: str,
                           recipient: str, occasion: str, min_bottom: float = 0.0) -> list[dict]:
    """Der Kopf der Urkunde als Stapel: Untertitel, Titel, Hinweis, Name, Anlass.

    Als eigene Funktion, weil sie ohne Zeichenfläche auskommt und damit prüfbar
    ist. Zwei Zusagen hält sie ein, egal wie lang ein Name oder ein Turniertitel
    ist: kein Block ragt in den darüberliegenden, und der Stapel endet oberhalb
    von ``min_bottom`` - dort beginnt die Medaille, und dort war vorher kein
    Anschlag.
    """
    scale = 1.0
    blocks = _certificate_stack_at(page_w, top, scale, subtitle=subtitle, headline=headline,
                                   recipient=recipient, occasion=occasion)
    while blocks[-1]["bottom"] < min_bottom and scale > 0.55:
        scale -= 0.05
        blocks = _certificate_stack_at(page_w, top, scale, subtitle=subtitle, headline=headline,
                                       recipient=recipient, occasion=occasion)
    return blocks


def _draw_centered_wrapped(canvas, text: str, center_x: float, first_baseline_y: float, max_width: float,
                           font_name: str = "Helvetica-Bold", start_size: int = 30, min_size: int = 15,
                           max_lines: int = 2, leading_factor: float = 1.18) -> float:
    value = str(text or "").strip()
    size = start_size
    lines = [value]
    while size > min_size:
        lines = _wrap_to_width(value, max_width, font_name, size, max_lines)
        if len(lines) <= max_lines and all(stringWidth(line, font_name, size) <= max_width for line in lines):
            break
        size -= 1
    lines = _wrap_to_width(value, max_width, font_name, size, max_lines)
    canvas.setFont(font_name, size)
    y = first_baseline_y
    leading = size * leading_factor
    for line in lines:
        canvas.drawCentredString(center_x, y, line)
        y -= leading
    return y


def pdf_station_signs(
    tournament: dict,
    stations: list,
    pdf_sponsors: list | None = None,
    pdf_branding: dict | None = None,
    orientation: str = "portrait",
) -> bytes:
    """One print-friendly page per station for event signage."""
    buf = io.BytesIO()
    page_size = landscape(A4) if orientation == "landscape" else A4
    c = pdf_canvas.Canvas(buf, pagesize=page_size, pageCompression=1)
    page_w, page_h = page_size

    class _Doc:
        pagesize = page_size
        page = 1

    doc = _Doc()
    branding = pdf_branding or {}
    sponsors = pdf_sponsors or []
    rows = stations or [{"name": "Station", "device_type": "", "notes": ""}]

    for page, station in enumerate(rows, 1):
        doc.page = page
        c.setFillColor(PAPER)
        c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
        c.setFillColor(CYAN)
        c.rect(0, page_h - 4, page_w, 4, fill=1, stroke=0)
        _draw_brand_header(c, doc, branding)

        content_top = page_h - 2.90 * cm
        content_bottom = 3.35 * cm
        content_h = content_top - content_bottom
        center_y = content_bottom + content_h * (0.54 if orientation == "landscape" else 0.52)

        c.setStrokeColor(RULE)
        c.setLineWidth(1.2)
        c.roundRect(1.65 * cm, content_bottom, page_w - 3.3 * cm, content_h, 8, stroke=1, fill=0)

        station_name = _normalize_pdf_text(station.get("name") or station.get("label") or station.get("id") or "Station")
        device = _normalize_pdf_text(station.get("device_type") or "")
        notes = _normalize_pdf_text(station.get("notes") or "")
        tournament_title = _normalize_pdf_text(tournament.get("title") or "THE LION SQUAD Event")

        c.setFillColor(CYAN_INK)
        c.setFont("Helvetica-Bold", 13 if orientation == "landscape" else 11)
        c.drawCentredString(page_w / 2, content_top - 1.05 * cm, "SPIELSTATION")

        c.setFillColor(INK)
        name_font_size = _fit_font_size(
            station_name.upper(),
            page_w - 4.2 * cm,
            start=104 if orientation == "landscape" else 82,
            minimum=40 if orientation == "landscape" else 32,
        )
        c.setFont("Helvetica-Bold", name_font_size)
        c.drawCentredString(page_w / 2, center_y + (0.95 * cm if orientation == "landscape" else 1.90 * cm), station_name.upper())

        if device:
            c.setFillColor(CYAN_INK)
            c.setFont("Helvetica-Bold", 28 if orientation == "landscape" else 23)
            c.drawCentredString(page_w / 2, center_y - (0.75 * cm if orientation == "landscape" else 0.05 * cm), device.upper())

        c.setFillColor(INK)
        _draw_centered_wrapped(
            c,
            tournament_title,
            page_w / 2,
            center_y - (1.88 * cm if orientation == "landscape" else 1.32 * cm),
            page_w - 5.2 * cm,
            start_size=16 if orientation == "landscape" else 15,
            min_size=10,
            max_lines=2,
            leading_factor=1.16,
        )

        if notes:
            c.setFillColor(INK_SOFT)
            c.setFont("Helvetica", 12)
            c.drawCentredString(
                page_w / 2,
                center_y - (3.05 * cm if orientation == "landscape" else 2.52 * cm),
                _truncate_to_width(notes, page_w - 5.6 * cm, "Helvetica", 12),
            )

        c.setStrokeColor(CYAN_INK)
        c.setLineWidth(1.5)
        c.line(3.8 * cm, content_bottom + 1.55 * cm, page_w - 3.8 * cm, content_bottom + 1.55 * cm)

        # Sass vorher genau auf der Rahmenlinie. Innerhalb des Rahmens ist Platz,
        # und unterhalb davon beginnt bereits das Sponsorenband.
        c.setFillColor(INK_SOFT)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(page_w / 2, content_bottom + 0.62 * cm, "THE LION SQUAD eSPORTS")

        _draw_sponsor_footer(c, doc, sponsors)
        c.setFillColor(INK_FAINT)
        c.setFont("Helvetica", 7)
        c.drawString(2 * cm, 0.72 * cm, "THE LION SQUAD eSports - Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
        c.drawRightString(page_w - 2 * cm, 0.72 * cm, f"Station {page}/{len(rows)}")
        c.showPage()

    c.save()
    return buf.getvalue()


def _certificate_page(canvas, doc, certificate: dict, branding: dict | None, sponsors: list | None) -> None:
    page_w, page_h = doc.pagesize
    branding = branding or {}
    source = certificate.get("source") or {}
    row = certificate.get("row") or {}
    rank = row.get("rank") or certificate.get("rank")
    title = _normalize_pdf_text(source.get("title") or "THE LION SQUAD")
    recipient = _normalize_pdf_text(row.get("display_name") or certificate.get("display_name") or "Teilnehmer")
    category = _normalize_pdf_text(certificate.get("category") or "Gesamtwertung")
    subtitle = _normalize_pdf_text(certificate.get("subtitle") or source.get("subtitle") or "eSports")
    # Ein eigenes Urkundenbild bleibt möglich; ohne das wird gekachelt.
    watermark_path = (
        _brand_asset_path(source.get("certificate_watermark_url"))
        or _brand_asset_path((branding or {}).get("mascot_url"))
        or _brand_asset_path((branding or {}).get("qr_logo_url"))
        or _brand_asset_path("/assets/brand/tls-mascot.png")
    )
    # Beim Wasserzeichen darf es das Maskottchen sein: gezeichnet wird dort nur
    # seine Form, die Farbe der Vorlage spielt keine Rolle.
    mascot_path = (
        _light_brand_path(branding)
        or _brand_asset_path((branding or {}).get("mascot_url"))
        or _brand_asset_path("/assets/brand/tls-mascot.png")
    )

    # Heller Grund, darauf das Banner des Spiels als Wasserzeichen über die
    # ganze Seite. Vorher lag darüber ein Schleier mit 76 % Deckkraft: das
    # Banner war praktisch unsichtbar und die Urkunde eine schwarze Fläche.
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    # Das Maskottchen als versetztes Muster über die ganze Seite. Ein
    # Turnierbanner als Wasserzeichen sah quer über der Urkunde nach einem
    # zweiten Text aus - man las Fragmente wie "BEWEISE DEIN KÖNNEN" mitten
    # durch den Namen. Ein wiederholtes Zeichen trägt keine Bedeutung und
    # bleibt deshalb Hintergrund.
    if watermark_path:
        _draw_tiled_watermark(canvas, watermark_path, page_w, page_h)
    canvas.setFillColor(CYAN)
    canvas.rect(0, page_h - 4, page_w, 4, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, page_h - 6.2, page_w, 1.2, fill=1, stroke=0)

    _draw_brand_header(canvas, doc, branding)

    border_x = 1.25 * cm
    border_y = 3.22 * cm
    border_w = page_w - 2.5 * cm
    border_h = page_h - 6.30 * cm
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(1.2)
    canvas.roundRect(border_x, border_y, border_w, border_h, 8, stroke=1, fill=0)
    canvas.setStrokeColor(GOLD_INK)
    canvas.setLineWidth(0.9)
    canvas.roundRect(border_x + 0.24 * cm, border_y + 0.24 * cm, border_w - 0.48 * cm, border_h - 0.48 * cm, 5, stroke=1, fill=0)
    canvas.setStrokeColor(CYAN)
    canvas.setLineWidth(1.0)
    corner = 1.35 * cm
    for x0, y0, sx, sy in (
        (border_x + 0.52 * cm, border_y + border_h - 0.52 * cm, 1, -1),
        (border_x + border_w - 0.52 * cm, border_y + border_h - 0.52 * cm, -1, -1),
        (border_x + 0.52 * cm, border_y + 0.52 * cm, 1, 1),
        (border_x + border_w - 0.52 * cm, border_y + 0.52 * cm, -1, 1),
    ):
        canvas.line(x0, y0, x0 + sx * corner, y0)
        canvas.line(x0, y0, x0, y0 + sy * corner)

    canvas.saveState()
    canvas.translate(1.02 * cm, page_h / 2)
    canvas.rotate(90)
    canvas.setFillColor(INK_FAINT)
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.drawCentredString(0, 0, "THE LION SQUAD CERTIFICATE")
    canvas.restoreState()

    # Der Kopf wird gestapelt statt an festen Grundlinien gesetzt. Die
    # Medaillengruppe darunter ist der Anschlag, unter den er nicht rutschen
    # darf - und sie rückt umgekehrt nach oben nach, wenn der Kopf kurz ist,
    # damit in der Mitte kein Loch stehen bleibt.
    medal_floor = 11.15 * cm
    medal_cy = medal_floor
    stack = certificate_text_stack(
        page_w,
        page_h - 3.95 * cm,
        subtitle=_normalize_pdf_text(subtitle),
        headline=_certificate_title(rank),
        recipient=recipient,
        occasion=title,
        min_bottom=medal_floor + 1.7 * cm,
    )
    # Nach oben nachrücken, aber nie so weit, dass die Kennzahlen darunter
    # bedrängt werden.
    medal_cy = min(stack[-1]["bottom"] - 1.75 * cm, 13.9 * cm)
    medal_cy = max(medal_cy, medal_floor)
    _draw_text_block(canvas, stack[0], page_w / 2, CYAN_INK)
    _draw_text_block(canvas, stack[1], page_w / 2, INK)
    _draw_text_block(canvas, stack[2], page_w / 2, GOLD_INK)
    recipient_bottom = _draw_text_block(canvas, stack[3], page_w / 2, INK)
    canvas.setStrokeColor(GOLD_INK)
    canvas.setLineWidth(0.75)
    canvas.line(4.0 * cm, recipient_bottom + 0.16 * cm, page_w - 4.0 * cm, recipient_bottom + 0.16 * cm)
    _draw_text_block(canvas, stack[4], page_w / 2, INK_SOFT)
    _draw_text_block(canvas, stack[5], page_w / 2, INK)

    medal_cx = page_w / 2
    canvas.setFillColor(PAPER)
    canvas.setStrokeColor(GOLD_INK)
    canvas.setLineWidth(1.4)
    canvas.circle(medal_cx, medal_cy, 1.26 * cm, stroke=1, fill=1)
    canvas.setStrokeColor(CYAN_INK)
    canvas.setLineWidth(0.6)
    canvas.circle(medal_cx, medal_cy, 1.04 * cm, stroke=1, fill=0)
    canvas.setFillColor(GOLD_INK)
    canvas.setFont("Helvetica-Bold", 21)
    canvas.drawCentredString(medal_cx, medal_cy + 0.08 * cm, _placement_label(rank).split(" ")[0])
    canvas.setFillColor(INK_SOFT)
    canvas.setFont("Helvetica-Bold", 5.8)
    canvas.drawCentredString(medal_cx, medal_cy - 0.48 * cm, "PLATZIERUNG")

    canvas.setFillColor(CYAN_INK)
    canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(page_w / 2, medal_cy - 1.89 * cm, _placement_label(rank).upper())
    canvas.setFillColor(INK_SOFT)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawCentredString(page_w / 2, medal_cy - 2.49 * cm, _truncate_to_width(category.upper(), page_w - 5.0 * cm, "Helvetica-Bold", 9))

    metrics = [m for m in (certificate.get("metrics") or []) if m and (m.get("value") not in (None, ""))]
    if metrics:
        visible_metrics = metrics[:4]
        slot_w = min(4.15 * cm, (page_w - 4.8 * cm) / max(1, len(visible_metrics)))
        gap = 0.22 * cm
        total_w = slot_w * len(visible_metrics) + gap * (len(visible_metrics) - 1)
        start_x = (page_w - total_w) / 2
        metric_y = 7.18 * cm
        for index, metric in enumerate(visible_metrics):
            x = start_x + index * (slot_w + gap)
            canvas.setStrokeColor(RULE)
            canvas.setFillColor(TINT)
            canvas.roundRect(x, metric_y, slot_w, 1.20 * cm, 5, fill=1, stroke=1)
            canvas.setFillColor(GOLD_INK)
            canvas.setFont("Helvetica-Bold", 5.8)
            canvas.drawCentredString(x + slot_w / 2, metric_y + 0.78 * cm, str(metric.get("label") or "").upper()[:20])
            # "Spielberg | Red Bull Ring" wurde vorher hart auf
            # "Spielberg | Red B..." gekürzt. Erst verkleinern, dann kürzen -
            # ein Streckenname gehört ganz auf die Urkunde.
            value = _normalize_pdf_text(str(metric.get("value")))
            value_size = 11
            while value_size > 7 and stringWidth(value, "Helvetica-Bold", value_size) > slot_w - 0.30 * cm:
                value_size -= 0.5
            canvas.setFillColor(INK)
            canvas.setFont("Helvetica-Bold", value_size)
            canvas.drawCentredString(
                x + slot_w / 2, metric_y + 0.30 * cm,
                _truncate_to_width(value, slot_w - 0.30 * cm, "Helvetica-Bold", value_size))

    issued = _normalize_pdf_text(certificate.get("issued_label") or datetime.now().strftime("%d.%m.%Y"))
    canvas.setStrokeColor(INK_FAINT)
    canvas.setLineWidth(0.6)
    canvas.line(3.0 * cm, 5.05 * cm, 8.05 * cm, 5.05 * cm)
    canvas.line(page_w - 8.05 * cm, 5.05 * cm, page_w - 3.0 * cm, 5.05 * cm)
    canvas.setFillColor(INK_SOFT)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.drawCentredString(5.52 * cm, 4.66 * cm, f"AUSGESTELLT AM {issued}".upper())
    canvas.drawCentredString(page_w - 5.52 * cm, 4.66 * cm, "TURNIERLEITUNG")

    if mascot_path:
        _draw_logo(canvas, mascot_path, (page_w - 1.78 * cm) / 2, 4.15 * cm, 1.78 * cm, 1.78 * cm, crop_transparent=True)

    _draw_sponsor_footer(canvas, doc, sponsors or [])
    canvas.setFillColor(INK_FAINT)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(2 * cm, 0.72 * cm, "THE LION SQUAD eSports - Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    canvas.drawRightString(page_w - 2 * cm, 0.72 * cm, "Urkunde")


def pdf_certificates(
    certificates: list,
    pdf_sponsors: list | None = None,
    pdf_branding: dict | None = None,
) -> bytes:
    """A4 certificate pages for tournament and Fast-Lap placements."""
    buf = io.BytesIO()
    page_size = A4
    c = pdf_canvas.Canvas(buf, pagesize=page_size, pageCompression=1)

    class _Doc:
        pagesize = page_size
        page = 1

    doc = _Doc()
    rows = certificates or []
    if not rows:
        rows = [{"source": {"title": "THE LION SQUAD"}, "row": {"display_name": "Teilnehmer", "rank": None}}]
    for page, certificate in enumerate(rows, 1):
        doc.page = page
        _certificate_page(c, doc, certificate, pdf_branding or {}, pdf_sponsors or [])
        c.showPage()
    c.save()
    return buf.getvalue()


def pdf_certificate(
    source: dict,
    row: dict,
    category: str = "Gesamtwertung",
    metrics: list | None = None,
    pdf_sponsors: list | None = None,
    pdf_branding: dict | None = None,
) -> bytes:
    return pdf_certificates(
        [{"source": source, "row": row, "category": category, "metrics": metrics or []}],
        pdf_sponsors=pdf_sponsors,
        pdf_branding=pdf_branding,
    )


def qr_badge_sources(branding: dict | None) -> tuple[Path | None, Path | None]:
    """Welches Bild in die Mitte eines QR-Codes gehört, und wie gezeichnet wird.

    Der Kreis in der Mitte ist weiß. Die Rückfallkette bestand vorher nur aus
    Bildern für dunklen Hintergrund: war ``qr_logo_url`` nicht gesetzt, blieb
    der Kreis leer, weil ein rein weißes Maskottchen auf Weiß nichts zeigt.

    Zurück kommt entweder ein Bild, das unverändert gezeichnet wird, oder eine
    Vorlage, von der nur die Silhouette gezeichnet wird - so trägt auch ein
    weißes Logo.
    """
    branding = branding or {}
    for key in ("qr_logo_url", "favicon_light_url", "logo_light_url"):
        path = _brand_asset_path(branding.get(key))
        if path:
            return path, None
    for key in ("mascot_url", "logo_url", "logo_dark_url"):
        path = _brand_asset_path(branding.get(key))
        if path:
            return None, path
    return None, _brand_asset_path("/assets/brand/tls-mascot.png")


def _draw_qr_code(canvas, value: str, x: float, y: float, size: float, branding: dict | None = None) -> None:
    widget = qr.QrCodeWidget(value, barLevel="H", barBorder=4)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    canvas.setFillColor(PAPER)
    canvas.roundRect(x - 1.2 * mm, y - 1.2 * mm, size + 2.4 * mm, size + 2.4 * mm, 7, fill=1, stroke=0)
    renderPDF.draw(drawing, canvas, x, y)

    logo_path, silhouette_path = qr_badge_sources(branding)
    badge_size = size * 0.205
    logo_size = badge_size * 0.76
    center_x = x + size / 2
    center_y = y + size / 2
    badge_r = badge_size / 2
    logo_x = center_x - logo_size / 2
    logo_y = center_y - logo_size / 2
    canvas.setFillColor(PAPER)
    canvas.circle(center_x, center_y, badge_r, fill=1, stroke=0)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(max(0.9, size * 0.006))
    canvas.circle(center_x, center_y, badge_r, fill=0, stroke=1)
    if logo_path:
        _draw_logo(canvas, logo_path, logo_x, logo_y, logo_size, logo_size, crop_transparent=True)
    elif silhouette_path:
        _draw_watermark_logo(canvas, silhouette_path, center_x, center_y, logo_size,
                             opacity=1.0, tint=(20, 24, 29))


def pdf_qr_sign(
    title: str,
    url: str,
    subtitle: str = "",
    eyebrow: str = "QR CODE",
    pdf_sponsors: list | None = None,
    pdf_branding: dict | None = None,
) -> bytes:
    """A4 QR sign for registration, check-in, displays, and event wayfinding."""
    buf = io.BytesIO()
    page_size = A4
    c = pdf_canvas.Canvas(buf, pagesize=page_size, pageCompression=1)
    page_w, page_h = page_size

    class _Doc:
        pagesize = page_size
        page = 1

    doc = _Doc()
    branding = pdf_branding or {}

    c.setFillColor(PAPER)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(0, page_h - 4, page_w, 4, fill=1, stroke=0)
    _draw_brand_header(c, doc, branding)

    c.setFillColor(CYAN_INK)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawCentredString(page_w / 2, page_h - 4.25 * cm, _normalize_pdf_text(eyebrow or "QR CODE").upper()[:64])

    display_title = _normalize_pdf_text(title or "THE LION SQUAD").upper()
    c.setFillColor(INK)
    title_bottom = _draw_centered_wrapped(
        c,
        display_title,
        page_w / 2,
        page_h - 5.28 * cm,
        page_w - 4.8 * cm,
        start_size=27,
        min_size=14,
        max_lines=3,
        leading_factor=1.13,
    )

    if subtitle:
        c.setFillColor(colors.HexColor("#CBD5E1"))
        _draw_centered_wrapped(
            c,
            _normalize_pdf_text(subtitle),
            page_w / 2,
            min(title_bottom - 0.42 * cm, page_h - 7.05 * cm),
            page_w - 4.6 * cm,
            start_size=12.5,
            min_size=10,
            max_lines=2,
            leading_factor=1.15,
        )

    qr_size = 10.65 * cm
    qr_x = (page_w - qr_size) / 2
    qr_y = 7.95 * cm
    _draw_qr_code(c, str(url or "https://lionsquad.at"), qr_x, qr_y, qr_size, branding)

    c.setFillColor(CYAN_INK)
    c.setFont("Helvetica-Bold", 14.5)
    c.drawCentredString(page_w / 2, 6.58 * cm, "SCANNEN UND ÖFFNEN")

    c.setFillColor(colors.HexColor("#CBD5E1"))
    c.setFont("Helvetica", 8.4)
    url_text = str(url or "").strip()
    c.drawCentredString(page_w / 2, 5.96 * cm, _truncate_to_width(url_text, page_w - 4.6 * cm, "Helvetica", 8.4))

    _draw_sponsor_footer(c, doc, pdf_sponsors or [])
    c.setFillColor(INK_FAINT)
    c.setFont("Helvetica", 7)
    c.drawString(2 * cm, 0.72 * cm, "THE LION SQUAD eSports - Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    c.drawRightString(page_w - 2 * cm, 0.72 * cm, "QR-Schild")
    c.showPage()
    c.save()
    return buf.getvalue()
