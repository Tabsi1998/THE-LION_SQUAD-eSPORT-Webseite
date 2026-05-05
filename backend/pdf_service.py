"""PDF export service using reportlab. Brand-consistent THE LION SQUAD PDFs."""
import io
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

CYAN = colors.HexColor("#29B6E8")
BLACK = colors.HexColor("#0A0A0A")
WHITE = colors.white
DARK = colors.HexColor("#121212")
MUTED = colors.HexColor("#A1A1AA")


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
    # Footer
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(2 * cm, 1 * cm, "THE LION SQUAD eSports · Generated " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    canvas.drawRightString(doc.pagesize[0] - 2 * cm, 1 * cm, f"Page {doc.page}")
    canvas.restoreState()


def _doc(buffer, title: str, orientation="portrait"):
    size = landscape(A4) if orientation == "landscape" else A4
    return SimpleDocTemplate(buffer, pagesize=size, title=title,
                              leftMargin=2 * cm, rightMargin=2 * cm,
                              topMargin=2 * cm, bottomMargin=1.8 * cm)


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


def pdf_participants(tournament: dict, registrations: list) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Teilnehmer - {tournament.get('title','')}")
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


def pdf_f1_leaderboard(challenge: dict, track: dict, entries: list) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"F1 {challenge.get('title','')} - {track.get('name','') if track else ''}")
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


def pdf_matches(tournament: dict, matches: list, reg_map: dict) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Matchplan - {tournament.get('title','')}", "landscape")
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


def pdf_standings(tournament: dict, rows: list) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Standings - {tournament.get('title','')}")
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


def pdf_checkin(tournament: dict, registrations: list) -> bytes:
    buf = io.BytesIO()
    doc = _doc(buf, f"Check-in - {tournament.get('title','')}")
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
