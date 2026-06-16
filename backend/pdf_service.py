"""PDF export service using reportlab. Brand-consistent THE LION SQUAD PDFs."""
import io
import os
import re
from pathlib import Path
from datetime import datetime
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

CYAN = colors.HexColor("#29B6E8")
GOLD = colors.HexColor("#D6B45F")
BLACK = colors.HexColor("#0A0A0A")
WHITE = colors.white
DARK = colors.HexColor("#121212")
MUTED = colors.HexColor("#A1A1AA")
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_BRAND_DIR = REPO_ROOT / "frontend" / "public" / "assets" / "brand"


def _base_styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle(name="TLSTitle", fontName="Helvetica-Bold", fontSize=20,
                          textColor=WHITE, leading=24, spaceAfter=8))
    s.add(ParagraphStyle(name="TLSSubtitle", fontName="Helvetica-Bold", fontSize=8.5,
                          textColor=CYAN, leading=12, letterSpacing=1, spaceAfter=10))
    s.add(ParagraphStyle(name="TLSSection", fontName="Helvetica-Bold", fontSize=12,
                          textColor=CYAN, leading=16, spaceBefore=12, spaceAfter=6))
    s.add(ParagraphStyle(name="TLSBody", fontName="Helvetica", fontSize=9,
                          textColor=colors.HexColor("#CCCCCC"), leading=12))
    s.add(ParagraphStyle(name="TLSFoot", fontName="Helvetica", fontSize=7,
                          textColor=MUTED, leading=9))
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
    canvas.setFillColor(BLACK)
    canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], fill=1, stroke=0)
    # Thin cyan line top
    canvas.setFillColor(CYAN)
    canvas.rect(0, doc.pagesize[1] - 4, doc.pagesize[0], 4, fill=1, stroke=0)
    _draw_brand_header(canvas, doc, getattr(doc, "tls_pdf_branding", {}))
    _draw_sponsor_footer(canvas, doc, getattr(doc, "tls_pdf_sponsors", []))
    # Footer
    canvas.setFillColor(MUTED)
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


def _draw_brand_header(canvas, doc, branding: dict | None):
    branding = branding or {}
    page_w, page_h = doc.pagesize
    logo_path = (
        _brand_asset_path(branding.get("logo_url"))
        or _brand_asset_path(branding.get("mascot_url"))
        or _brand_asset_path("/assets/brand/tls-wordmark.png")
    )
    x = 2 * cm
    y = page_h - 1.85 * cm
    if not (logo_path and _draw_logo(canvas, logo_path, x, y, 4.8 * cm, 1.1 * cm)):
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(x, y + 0.42 * cm, "THE LION SQUAD")
        canvas.setFillColor(CYAN)
        canvas.setFont("Helvetica-Bold", 6)
        canvas.drawString(x, y + 0.16 * cm, "E-SPORTS")

    domain = str(branding.get("domain") or "lionsquad.at").replace("https://", "").replace("http://", "").strip("/")
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.setFont("Helvetica-Bold", 6)
    canvas.drawRightString(page_w - 2 * cm, y + 0.48 * cm, domain.upper())
    canvas.setStrokeColor(colors.HexColor("#1F2937"))
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
    canvas.setFillColor(colors.HexColor("#080808"))
    canvas.rect(0, 0.95 * cm, page_w, band_top - 0.95 * cm, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor("#1F2937"))
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, band_top, page_w - 2 * cm, band_top)
    canvas.setFillColor(CYAN)
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
            canvas.setFillColor(WHITE)
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
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), CYAN),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#E5E7EB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#121212"), colors.HexColor("#161616")]),
        ("LINEBELOW", (0, 0), (-1, 0), 1, CYAN),
        ("GRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#222")),
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
            r.get("team", {}).get("tag") if r.get("team") else "—",
            r.get("status", "—"),
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


def pdf_matches(tournament: dict, matches: list, reg_map: dict, pdf_sponsors: list | None = None, pdf_branding: dict | None = None) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Matchplan - {tournament.get('title','')}", "landscape", sponsors=pdf_sponsors, branding=pdf_branding)
    styles = _base_styles()
    story = []
    _header(story, styles, "Matchplan", tournament.get("title", ""))
    data = [["Runde", "Teilnehmer A", "vs", "Teilnehmer B", "Zeit", "Station", "Status"]]
    for m in matches:
        a = reg_map.get(m.get("participant_a_id"))
        b = reg_map.get(m.get("participant_b_id"))
        data.append([
            m.get("round_name", f"R{m.get('round')}"),
            (a or {}).get("display_name", "TBD"),
            f"{m.get('score_a',0)} : {m.get('score_b',0)}",
            (b or {}).get("display_name", "TBD"),
            m.get("scheduled_at", "") or "—",
            m.get("station_id", "") or "—",
            m.get("status", "—"),
        ])
    t = Table(data, colWidths=[3.5 * cm, 6 * cm, 2.5 * cm, 6 * cm, 3 * cm, 2.5 * cm, 3 * cm], repeatRows=1)
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
        c.setFillColor(BLACK)
        c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
        c.setFillColor(CYAN)
        c.rect(0, page_h - 4, page_w, 4, fill=1, stroke=0)
        _draw_brand_header(c, doc, branding)

        content_top = page_h - 2.90 * cm
        content_bottom = 3.35 * cm
        content_h = content_top - content_bottom
        center_y = content_bottom + content_h * (0.54 if orientation == "landscape" else 0.52)

        c.setStrokeColor(colors.HexColor("#1F2937"))
        c.setLineWidth(1.2)
        c.roundRect(1.65 * cm, content_bottom, page_w - 3.3 * cm, content_h, 8, stroke=1, fill=0)

        station_name = _normalize_pdf_text(station.get("name") or station.get("label") or station.get("id") or "Station")
        device = _normalize_pdf_text(station.get("device_type") or "")
        notes = _normalize_pdf_text(station.get("notes") or "")
        tournament_title = _normalize_pdf_text(tournament.get("title") or "THE LION SQUAD Event")

        c.setFillColor(CYAN)
        c.setFont("Helvetica-Bold", 13 if orientation == "landscape" else 11)
        c.drawCentredString(page_w / 2, content_top - 1.05 * cm, "SPIELSTATION")

        c.setFillColor(WHITE)
        name_font_size = _fit_font_size(
            station_name.upper(),
            page_w - 4.2 * cm,
            start=104 if orientation == "landscape" else 82,
            minimum=40 if orientation == "landscape" else 32,
        )
        c.setFont("Helvetica-Bold", name_font_size)
        c.drawCentredString(page_w / 2, center_y + (0.95 * cm if orientation == "landscape" else 1.90 * cm), station_name.upper())

        if device:
            c.setFillColor(CYAN)
            c.setFont("Helvetica-Bold", 28 if orientation == "landscape" else 23)
            c.drawCentredString(page_w / 2, center_y - (0.75 * cm if orientation == "landscape" else 0.05 * cm), device.upper())

        c.setFillColor(colors.HexColor("#E5E7EB"))
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
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 12)
            c.drawCentredString(
                page_w / 2,
                center_y - (3.05 * cm if orientation == "landscape" else 2.52 * cm),
                _truncate_to_width(notes, page_w - 5.6 * cm, "Helvetica", 12),
            )

        c.setStrokeColor(CYAN)
        c.setLineWidth(1.5)
        c.line(3.8 * cm, content_bottom + 1.55 * cm, page_w - 3.8 * cm, content_bottom + 1.55 * cm)

        c.setFillColor(colors.HexColor("#64748B"))
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(page_w / 2, 3.04 * cm, "THE LION SQUAD eSPORTS")

        _draw_sponsor_footer(c, doc, sponsors)
        c.setFillColor(MUTED)
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
    background_path = (
        _brand_asset_path(source.get("certificate_image_url"))
        or _brand_asset_path(source.get("banner_url"))
        or _brand_asset_path(source.get("image_url"))
        or _brand_asset_path(source.get("seo_image_url"))
        or _brand_asset_path((branding or {}).get("share_banner_url"))
    )
    mascot_path = (
        _brand_asset_path((branding or {}).get("mascot_url"))
        or _brand_asset_path((branding or {}).get("qr_logo_url"))
        or _brand_asset_path("/assets/brand/tls-mascot.png")
    )

    canvas.setFillColor(BLACK)
    canvas.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    if background_path:
        _draw_cover_image(canvas, background_path, page_w, page_h, opacity=0.30)
    _draw_alpha_rect(canvas, 0, 0, page_w, page_h, colors.HexColor("#030506"), 0.76)
    if mascot_path:
        _draw_alpha_logo(
            canvas,
            mascot_path,
            (page_w - 10.8 * cm) / 2,
            9.4 * cm,
            10.8 * cm,
            10.8 * cm,
            0.095,
            crop_transparent=True,
        )
    canvas.setFillColor(CYAN)
    canvas.rect(0, page_h - 5, page_w, 5, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, page_h - 9, page_w, 1.4, fill=1, stroke=0)

    _draw_brand_header(canvas, doc, branding)

    border_x = 1.25 * cm
    border_y = 3.22 * cm
    border_w = page_w - 2.5 * cm
    border_h = page_h - 6.30 * cm
    canvas.setStrokeColor(colors.HexColor("#24313B"))
    canvas.setLineWidth(1.2)
    canvas.roundRect(border_x, border_y, border_w, border_h, 8, stroke=1, fill=0)
    canvas.setStrokeColor(GOLD)
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
    canvas.setFillColor(colors.HexColor("#1B3A46"))
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.drawCentredString(0, 0, "THE LION SQUAD CERTIFICATE")
    canvas.restoreState()

    y = page_h - 4.22 * cm
    canvas.setFillColor(CYAN)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawCentredString(page_w / 2, y, _truncate_to_width(_normalize_pdf_text(subtitle).upper(), page_w - 5.2 * cm, "Helvetica-Bold", 8.5))

    canvas.setFillColor(WHITE)
    y -= 0.72 * cm
    title_bottom = _draw_centered_wrapped(
        canvas,
        _certificate_title(rank).upper(),
        page_w / 2,
        y,
        page_w - 4.6 * cm,
        start_size=35,
        min_size=20,
        max_lines=2,
        leading_factor=1.10,
    )

    y = title_bottom - 0.42 * cm
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawCentredString(page_w / 2, y, "AUSGEZEICHNET WIRD")

    y -= 0.82 * cm
    canvas.setFillColor(WHITE)
    recipient_bottom = _draw_centered_wrapped(
        canvas,
        recipient,
        page_w / 2,
        y,
        page_w - 4.0 * cm,
        start_size=38,
        min_size=22,
        max_lines=2,
        leading_factor=1.02,
    )
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.75)
    canvas.line(4.0 * cm, recipient_bottom + 0.30 * cm, page_w - 4.0 * cm, recipient_bottom + 0.30 * cm)

    y = recipient_bottom - 0.46 * cm
    canvas.setFillColor(colors.HexColor("#E5E7EB"))
    canvas.setFont("Helvetica", 9.5)
    canvas.drawCentredString(page_w / 2, y, "für die Leistung bei")
    y -= 0.58 * cm
    _draw_centered_wrapped(
        canvas,
        title,
        page_w / 2,
        y,
        page_w - 4.6 * cm,
        start_size=16,
        min_size=10,
        max_lines=3,
        leading_factor=1.14,
    )

    medal_cx = page_w / 2
    medal_cy = 11.95 * cm
    canvas.setFillColor(colors.HexColor("#090D10"))
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(1.4)
    canvas.circle(medal_cx, medal_cy, 1.26 * cm, stroke=1, fill=1)
    canvas.setStrokeColor(CYAN)
    canvas.setLineWidth(0.6)
    canvas.circle(medal_cx, medal_cy, 1.04 * cm, stroke=1, fill=0)
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica-Bold", 21)
    canvas.drawCentredString(medal_cx, medal_cy + 0.08 * cm, _placement_label(rank).split(" ")[0])
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Bold", 5.8)
    canvas.drawCentredString(medal_cx, medal_cy - 0.48 * cm, "PLATZIERUNG")

    canvas.setFillColor(CYAN)
    canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(page_w / 2, 10.06 * cm, _placement_label(rank).upper())
    canvas.setFillColor(colors.HexColor("#CBD5E1"))
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawCentredString(page_w / 2, 9.46 * cm, _truncate_to_width(category.upper(), page_w - 5.0 * cm, "Helvetica-Bold", 9))

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
            canvas.setStrokeColor(colors.HexColor("#1F2937"))
            canvas.setFillColor(colors.HexColor("#0B1115"))
            canvas.roundRect(x, metric_y, slot_w, 1.20 * cm, 5, fill=1, stroke=1)
            canvas.setFillColor(GOLD)
            canvas.setFont("Helvetica-Bold", 5.8)
            canvas.drawCentredString(x + slot_w / 2, metric_y + 0.78 * cm, str(metric.get("label") or "").upper()[:20])
            canvas.setFillColor(WHITE)
            canvas.setFont("Helvetica-Bold", 11)
            canvas.drawCentredString(x + slot_w / 2, metric_y + 0.30 * cm, _truncate_to_width(str(metric.get("value")), slot_w - 0.35 * cm, "Helvetica-Bold", 11))

    issued = _normalize_pdf_text(certificate.get("issued_label") or datetime.now().strftime("%d.%m.%Y"))
    canvas.setStrokeColor(colors.HexColor("#64748B"))
    canvas.setLineWidth(0.6)
    canvas.line(3.0 * cm, 5.05 * cm, 8.05 * cm, 5.05 * cm)
    canvas.line(page_w - 8.05 * cm, 5.05 * cm, page_w - 3.0 * cm, 5.05 * cm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.drawCentredString(5.52 * cm, 4.66 * cm, f"AUSGESTELLT AM {issued}".upper())
    canvas.drawCentredString(page_w - 5.52 * cm, 4.66 * cm, "TURNIERLEITUNG")

    if mascot_path:
        _draw_logo(canvas, mascot_path, (page_w - 1.78 * cm) / 2, 4.15 * cm, 1.78 * cm, 1.78 * cm, crop_transparent=True)

    _draw_sponsor_footer(canvas, doc, sponsors or [])
    canvas.setFillColor(MUTED)
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


def _draw_qr_code(canvas, value: str, x: float, y: float, size: float, branding: dict | None = None) -> None:
    widget = qr.QrCodeWidget(value, barLevel="H", barBorder=4)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    canvas.setFillColor(WHITE)
    canvas.roundRect(x - 1.2 * mm, y - 1.2 * mm, size + 2.4 * mm, size + 2.4 * mm, 7, fill=1, stroke=0)
    renderPDF.draw(drawing, canvas, x, y)

    logo_path = (
        _brand_asset_path((branding or {}).get("qr_logo_url"))
        or _brand_asset_path((branding or {}).get("mascot_url"))
        or _brand_asset_path((branding or {}).get("favicon_dark_url"))
        or _brand_asset_path((branding or {}).get("logo_dark_url"))
        or _brand_asset_path((branding or {}).get("logo_url"))
        or _brand_asset_path("/assets/brand/tls-mascot.png")
    )
    badge_size = size * 0.205
    logo_size = badge_size * 0.76
    center_x = x + size / 2
    center_y = y + size / 2
    badge_r = badge_size / 2
    logo_x = center_x - logo_size / 2
    logo_y = center_y - logo_size / 2
    canvas.setFillColor(WHITE)
    canvas.circle(center_x, center_y, badge_r, fill=1, stroke=0)
    canvas.setStrokeColor(BLACK)
    canvas.setLineWidth(max(0.9, size * 0.006))
    canvas.circle(center_x, center_y, badge_r, fill=0, stroke=1)
    if logo_path:
        _draw_logo(canvas, logo_path, logo_x, logo_y, logo_size, logo_size, crop_transparent=True)


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

    c.setFillColor(BLACK)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(0, page_h - 4, page_w, 4, fill=1, stroke=0)
    _draw_brand_header(c, doc, branding)

    c.setFillColor(CYAN)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawCentredString(page_w / 2, page_h - 4.25 * cm, _normalize_pdf_text(eyebrow or "QR CODE").upper()[:64])

    display_title = _normalize_pdf_text(title or "THE LION SQUAD").upper()
    c.setFillColor(WHITE)
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

    c.setFillColor(CYAN)
    c.setFont("Helvetica-Bold", 14.5)
    c.drawCentredString(page_w / 2, 6.58 * cm, "SCANNEN UND ÖFFNEN")

    c.setFillColor(colors.HexColor("#CBD5E1"))
    c.setFont("Helvetica", 8.4)
    url_text = str(url or "").strip()
    c.drawCentredString(page_w / 2, 5.96 * cm, _truncate_to_width(url_text, page_w - 4.6 * cm, "Helvetica", 8.4))

    _draw_sponsor_footer(c, doc, pdf_sponsors or [])
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7)
    c.drawString(2 * cm, 0.72 * cm, "THE LION SQUAD eSports - Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    c.drawRightString(page_w - 2 * cm, 0.72 * cm, "QR-Schild")
    c.showPage()
    c.save()
    return buf.getvalue()
