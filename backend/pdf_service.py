"""PDF export service using reportlab. Brand-consistent THE LION SQUAD PDFs."""
import io
import os
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

CYAN = colors.HexColor("#29B6E8")
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
    s.add(ParagraphStyle(name="TLSTitle", fontName="Helvetica-Bold", fontSize=22,
                          textColor=WHITE, leading=26, spaceAfter=4))
    s.add(ParagraphStyle(name="TLSSubtitle", fontName="Helvetica-Bold", fontSize=9,
                          textColor=CYAN, leading=12, letterSpacing=1, spaceAfter=14))
    s.add(ParagraphStyle(name="TLSSection", fontName="Helvetica-Bold", fontSize=12,
                          textColor=CYAN, leading=16, spaceBefore=12, spaceAfter=6))
    s.add(ParagraphStyle(name="TLSBody", fontName="Helvetica", fontSize=9,
                          textColor=colors.HexColor("#CCCCCC"), leading=12))
    s.add(ParagraphStyle(name="TLSFoot", fontName="Helvetica", fontSize=7,
                          textColor=MUTED, leading=9))
    return s


def _header(story, styles, subtitle: str, title: str):
    story.append(Paragraph(f"THE LION SQUAD eSports · {subtitle}", styles["TLSSubtitle"]))
    story.append(Paragraph(title, styles["TLSTitle"]))
    story.append(Spacer(1, 12))


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


def _draw_logo(canvas, path: Path, x: float, y: float, max_w: float, max_h: float) -> bool:
    try:
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


def _doc(buffer, title: str, orientation="portrait", sponsors: list | None = None, branding: dict | None = None):
    size = landscape(A4) if orientation == "landscape" else A4
    doc = SimpleDocTemplate(buffer, pagesize=size, title=title,
                              leftMargin=2 * cm, rightMargin=2 * cm,
                              topMargin=2.75 * cm, bottomMargin=3.35 * cm)
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
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
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
    t = Table(data, colWidths=[1.2 * cm, 7 * cm, 4 * cm, 2.5 * cm, 3 * cm])
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
    t = Table(data, colWidths=[1.5 * cm, 7 * cm, 3.5 * cm, 3 * cm, 2.5 * cm])
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
    t = Table(data, colWidths=[3.5 * cm, 6 * cm, 2.5 * cm, 6 * cm, 3 * cm, 2.5 * cm, 3 * cm])
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
    t = Table(data, colWidths=[1.5 * cm, 8 * cm, 2.5 * cm, 3 * cm, 2.5 * cm])
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
    t = Table(data, colWidths=[1.2 * cm, 6 * cm, 4 * cm, 2 * cm, 5 * cm])
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

        content_top = page_h - 2.65 * cm
        content_bottom = 3.25 * cm
        content_h = content_top - content_bottom
        center_y = content_bottom + content_h * (0.53 if orientation == "landscape" else 0.50)

        c.setStrokeColor(colors.HexColor("#1F2937"))
        c.setLineWidth(1.2)
        c.roundRect(1.55 * cm, content_bottom, page_w - 3.1 * cm, content_h, 8, stroke=1, fill=0)

        station_name = str(station.get("name") or station.get("label") or station.get("id") or "Station").strip()
        device = str(station.get("device_type") or "").strip()
        notes = str(station.get("notes") or "").strip()
        tournament_title = str(tournament.get("title") or "THE LION SQUAD Event").strip()

        c.setFillColor(CYAN)
        c.setFont("Helvetica-Bold", 13 if orientation == "landscape" else 11)
        c.drawCentredString(page_w / 2, content_top - 1.0 * cm, "SPIELSTATION")

        c.setFillColor(WHITE)
        name_font_size = _fit_font_size(
            station_name.upper(),
            page_w - 3.6 * cm,
            start=112 if orientation == "landscape" else 88,
            minimum=42 if orientation == "landscape" else 34,
        )
        c.setFont("Helvetica-Bold", name_font_size)
        c.drawCentredString(page_w / 2, center_y + (0.55 * cm if orientation == "landscape" else 1.65 * cm), station_name.upper())

        if device:
            c.setFillColor(CYAN)
            c.setFont("Helvetica-Bold", 30 if orientation == "landscape" else 24)
            c.drawCentredString(page_w / 2, center_y - (1.05 * cm if orientation == "landscape" else 0.25 * cm), device.upper())

        c.setFillColor(colors.HexColor("#E5E7EB"))
        c.setFont("Helvetica-Bold", 16 if orientation == "landscape" else 15)
        c.drawCentredString(page_w / 2, center_y - (2.25 * cm if orientation == "landscape" else 1.55 * cm), tournament_title[:86])

        if notes:
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 12)
            c.drawCentredString(page_w / 2, center_y - (3.1 * cm if orientation == "landscape" else 2.45 * cm), notes[:96])

        c.setStrokeColor(CYAN)
        c.setLineWidth(1.5)
        c.line(3.4 * cm, content_bottom + 1.55 * cm, page_w - 3.4 * cm, content_bottom + 1.55 * cm)

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
