"""Die Urkunde hatte zwei Ueberlappungen, und beide waren rechnerisch zwingend.

Der alte Code rueckte um einen festen Abstand weiter und setzte dort die
*Grundlinie* der naechsten Zeile. Bei 35 pt ragt die Versalhoehe 0,86 cm ueber
die Grundlinie, der Abstand betrug 0,72 cm - der Titel lief also immer in den
Untertitel. Beim Namen dasselbe: 0,94 cm Aufstieg gegen 0,82 cm Abstand.

Diese Tests pruefen die Rechnung statt das Bild: Bloecke kennen ihre Ober- und
Unterkante, und ein Stapel daraus darf sich nicht selbst ueberlappen - egal wie
lang ein Name oder ein Turniertitel ist.
"""
import pytest
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm

from pdf_service import (
    REGISTRATION_STATUS_LABELS,
    _registration_status_label,
    _team_label,
    certificate_text_stack,
    text_block,
)


PAGE_W, PAGE_H = A4
TOP = PAGE_H - 3.95 * cm

LANGER_NAME = "Maximilian Gruber-Hinterlechner-Aschenwald"
LANGER_TITEL = "Gamers Heaven • Rocket League • Winter Cup Championship Finale | Sonntag"


def stack(recipient=LANGER_NAME, occasion="Winter Cup", subtitle="Rocket League 3v3",
          headline="Siegerurkunde", min_bottom=0.0):
    return certificate_text_stack(
        PAGE_W, TOP, subtitle=subtitle, headline=headline,
        recipient=recipient, occasion=occasion, min_bottom=min_bottom)


# ---------------------------------------------------------------- Der Block

def test_a_block_hangs_below_its_top_edge_not_on_it():
    """Genau die Verwechslung, die den Fehler verursacht hat."""
    block = text_block(700, "TEST", max_width=400, start_size=35, min_size=20)

    assert block["top"] == 700
    # Der Kern: die Grundlinie liegt um den Aufstieg unter der Oberkante. Genau
    # diese Strecke hatte der alte Code unterschlagen.
    assert block["first_baseline"] == pytest.approx(700 - 35 * 0.76)
    assert block["bottom"] < block["first_baseline"], "unter der Grundlinie bleibt der Abstrich"
    assert block["height"] == pytest.approx(35), "Aufstieg plus Abstrich einer Zeile"


def test_a_gap_before_moves_the_whole_block_down():
    ohne = text_block(700, "TEST", max_width=400, start_size=20, min_size=12)
    mit = text_block(700, "TEST", max_width=400, start_size=20, min_size=12, gap_before=30)

    assert mit["top"] == ohne["top"] - 30
    assert mit["bottom"] == ohne["bottom"] - 30


def test_a_long_text_wraps_and_grows_taller():
    kurz = text_block(700, "Lea", max_width=200, start_size=30, min_size=18, max_lines=2)
    lang = text_block(700, LANGER_NAME, max_width=200, start_size=30, min_size=18, max_lines=2)

    assert len(lang["lines"]) >= len(kurz["lines"])
    assert lang["bottom"] <= kurz["bottom"]


# ---------------------------------------------------------------- Der Stapel

@pytest.mark.parametrize("recipient", ["Lea", LANGER_NAME, "Anna-Sophie Mayrhofer"])
@pytest.mark.parametrize("occasion", ["Winter Cup", LANGER_TITEL])
@pytest.mark.parametrize("headline", ["Siegerurkunde", "Urkunde zum 2. Platz", "Teilnahmeurkunde"])
def test_no_block_ever_runs_into_the_one_above(recipient, occasion, headline):
    blocks = stack(recipient=recipient, occasion=occasion, headline=headline)

    for upper, lower in zip(blocks, blocks[1:]):
        assert lower["top"] <= upper["bottom"] + 0.01, (
            f"'{' '.join(lower['lines'])[:24]}' beginnt bei {lower['top']:.1f}, "
            f"waehrend '{' '.join(upper['lines'])[:24]}' erst bei {upper['bottom']:.1f} endet"
        )


def test_the_stack_stays_inside_the_page():
    blocks = stack(recipient=LANGER_NAME, occasion=LANGER_TITEL)

    assert blocks[0]["top"] <= PAGE_H
    assert blocks[-1]["bottom"] > 0


@pytest.mark.parametrize("recipient", ["Lea", LANGER_NAME])
@pytest.mark.parametrize("occasion", ["Winter Cup", LANGER_TITEL])
def test_the_stack_ends_above_the_medal(recipient, occasion):
    """Unter dem Kopf sitzt die Medaille; dort war vorher kein Anschlag."""
    grenze = 12.85 * cm

    blocks = stack(recipient=recipient, occasion=occasion, min_bottom=grenze)

    assert blocks[-1]["bottom"] >= grenze - 0.01


def test_an_absurdly_long_name_shrinks_rather_than_overflowing():
    blocks = stack(recipient="Wolfeschlegelsteinhausenbergerdorff Senior " * 3,
                   occasion=LANGER_TITEL, min_bottom=12.85 * cm)

    assert blocks[-1]["bottom"] >= 12.85 * cm - 0.01
    for upper, lower in zip(blocks, blocks[1:]):
        assert lower["top"] <= upper["bottom"] + 0.01


def test_the_stack_keeps_its_order():
    blocks = stack()
    assert [b["lines"][0] for b in blocks][:1] == ["ROCKET LEAGUE 3V3"]
    assert blocks[2]["lines"] == ["AUSGEZEICHNET WIRD"]
    assert blocks[4]["lines"] == ["für die Leistung bei"]


# ---------------------------------------------------------------- Listenwerte

def test_the_team_column_reads_the_name_not_a_field_teams_do_not_have():
    """Die Spalte blieb leer, weil sie 'tag' las - Teams fuehren 'name'."""
    assert _team_label({"name": "Lions Alpha"}) == "Lions Alpha"
    assert _team_label({"tag": "LNS"}) == "LNS"
    assert _team_label({"name": "Lions Alpha", "tag": "LNS"}) == "Lions Alpha"
    assert _team_label(None) == "—"
    assert _team_label({}) == "—"


def test_a_printed_list_says_eingecheckt_not_checked_in():
    assert _registration_status_label("checked_in") == "Eingecheckt"
    assert _registration_status_label("no_show") == "Nicht erschienen"
    assert _registration_status_label("approved") == "Bestätigt"
    assert _registration_status_label(None) == "—"


def test_an_unknown_status_stays_readable_instead_of_raw():
    assert _registration_status_label("irgend_ein_status") == "Irgend ein status"


def test_every_known_status_has_a_german_label():
    assert all(label and label[0].isupper() for label in REGISTRATION_STATUS_LABELS.values())


def test_the_old_fixed_gaps_could_not_have_worked():
    """Die Zahlen von damals, als Beleg dass der Fehler zwingend war.

    Kein Test des heutigen Codes, sondern der Nachweis, warum ein fester
    Abstand zwischen Grundlinien die Ueberlappung nicht vermeiden konnte.
    """
    from pdf_service import TEXT_ASCENT

    assert 35 * TEXT_ASCENT > 0.72 * cm, "Titel 35 pt gegen 0,72 cm Abstand"
    assert 38 * TEXT_ASCENT > 0.82 * cm, "Name 38 pt gegen 0,82 cm Abstand"


# ---------------------------------------------------------------- Gegenprobe am Ergebnis

pymupdf = pytest.importorskip("pymupdf", reason="pymupdf zeigt die Textkaesten der erzeugten Seiten")


def _overlapping_spans(data: bytes) -> list[tuple[str, str]]:
    """Textkaesten, die sich auf derselben Seite deutlich ueberschneiden.

    Die Rechnung oben prueft den Entwurf, dieser Test das Erzeugnis. Genau so
    sind acht Ueberlappungen im Matchplan aufgefallen, die beim Ansehen der
    Seite niemandem auffielen: der rohe Zeitstempel lief in die Stationsspalte.
    """
    findings = []
    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        for page in document:
            spans = []
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        if span["text"].strip():
                            spans.append((pymupdf.Rect(span["bbox"]), span["text"].strip()))
            for index, (rect_a, text_a) in enumerate(spans):
                for rect_b, text_b in spans[index + 1:]:
                    overlap = rect_a & rect_b
                    smaller = min(rect_a.get_area(), rect_b.get_area())
                    if overlap.is_valid and smaller and overlap.get_area() > 0.35 * smaller:
                        findings.append((text_a, text_b))
    finally:
        document.close()
    return findings


LANGE_NAMEN = [
    {"id": "r1", "display_name": LANGER_NAME, "discord": "max#1001",
     "status": "checked_in", "team": {"name": "Lions Alpha"}},
    {"id": "r2", "display_name": "Lea", "discord": "lea#1002", "status": "approved", "team": None},
]

SPIELE = [{
    "id": "m1", "match_key": "WB1", "round": 1, "matchday_number": 1, "match_type": "duel",
    "status": "completed", "scheduled_at": "2026-09-13T19:30:00+00:00",
    "station_label": "Station 1",
    "slots": [{"position": 1, "registration_id": "r1"}, {"position": 2, "registration_id": "r2"}],
    "results": [{"registration_id": "r1", "rank": 1, "score": 3},
                {"registration_id": "r2", "rank": 2, "score": 1}],
}]

TURNIER = {"id": "t1", "title": "Gamers Heaven • Rocket League • Winter Cup | Sonntag"}


@pytest.mark.parametrize("name,build", [
    ("Teilnehmerliste", lambda: __import__("pdf_service").pdf_participants(TURNIER, LANGE_NAMEN)),
    ("Check-in", lambda: __import__("pdf_service").pdf_checkin(TURNIER, LANGE_NAMEN)),
    ("Matchplan", lambda: __import__("pdf_service").pdf_matches(
        TURNIER, SPIELE, {r["id"]: r for r in LANGE_NAMEN})),
    ("Stationen", lambda: __import__("pdf_service").pdf_station_signs(
        TURNIER, [{"name": "Station 1", "device_type": "PC • RTX 4070", "notes": "Discord offen"}])),
    ("Urkunde", lambda: __import__("pdf_service").pdf_certificates([
        {"source": TURNIER, "row": {"display_name": LANGER_NAME, "rank": 1},
         "category": "Gesamtwertung",
         "metrics": [{"label": "Spiele", "value": "6"}, {"label": "Siege", "value": "5"}]}])),
])
def test_no_text_overlaps_another_on_the_finished_page(name, build):
    findings = _overlapping_spans(build())

    assert findings == [], f"{name}: " + "; ".join(f"'{a[:30]}' auf '{b[:30]}'" for a, b in findings[:3])


def test_a_printed_match_plan_shows_a_readable_time_not_an_iso_stamp():
    from pdf_service import _match_status_label, _pdf_datetime_label

    assert _pdf_datetime_label("2026-09-13T19:30:00+00:00") == "13.09.2026 21:30"
    assert _pdf_datetime_label(None) == "—"
    assert _pdf_datetime_label("kein datum") == "kein datum"
    assert _match_status_label("completed") == "Beendet"
    assert _match_status_label("waiting_result") == "Wartet auf Ergebnis"


# ---------------------------------------------------------------- Wasserzeichen

def test_a_long_metric_value_shrinks_instead_of_being_cut_off():
    """Auf der echten Urkunde stand "Spielberg | Red B..." statt der Strecke."""
    import pdf_service

    data = pdf_service.pdf_certificates([{
        "source": TURNIER,
        "row": {"display_name": "buma_70", "rank": 1},
        "category": "Streckenwertung",
        "metrics": [
            {"label": "Strecke", "value": "Spielberg | Red Bull Ring"},
            {"label": "Beste Zeit", "value": "1:06.258"},
        ],
    }])

    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        text = document[0].get_text()
    finally:
        document.close()
    assert "Spielberg | Red Bull Ring" in text
    assert "Red B..." not in text


def test_the_watermark_is_tiled_and_survives_a_missing_file(tmp_path):
    """Das Muster stammt aus der Silhouette, nicht aus der Farbe der Vorlage."""
    import pdf_service
    from reportlab.pdfgen import canvas as pdf_canvas

    mascot = pdf_service._brand_asset_path("/assets/brand/tls-mascot.png")
    assert mascot is not None, "das Maskottchen gehoert zum Quellstand"

    page = pdf_canvas.Canvas(str(tmp_path / "probe.pdf"), pagesize=A4)
    assert pdf_service._draw_tiled_watermark(page, mascot, PAGE_W, PAGE_H) is True
    assert pdf_service._draw_tiled_watermark(page, tmp_path / "gibtsnicht.png", PAGE_W, PAGE_H) is False


def test_a_certificate_no_longer_carries_the_banner_text():
    """Quer ueber der Urkunde stand vorher die Werbeschrift des Banners."""
    import pdf_service

    data = pdf_service.pdf_certificates([{
        "source": {**TURNIER, "banner_url": "/assets/brand/og-default.png"},
        "row": {"display_name": "buma_70", "rank": 1},
        "category": "Gesamtwertung",
        "metrics": [],
    }])

    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        images = document[0].get_images(full=True)
    finally:
        document.close()
    # Ein gekacheltes Muster verwendet dieselbe Vorlage mehrfach; ein
    # seitenfuellendes Banner waere genau ein grosses Bild.
    assert images, "die Urkunde traegt ein Wasserzeichen"
