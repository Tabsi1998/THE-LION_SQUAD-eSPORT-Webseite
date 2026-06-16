import re

from pdf_service import (
    pdf_checkin,
    pdf_certificate,
    pdf_certificates,
    pdf_f1_leaderboard,
    pdf_matches,
    pdf_participants,
    pdf_qr_sign,
    pdf_standings,
    pdf_station_signs,
)


BRANDING = {
    "domain": "lionsquad.at",
    "logo_url": "/assets/brand/tls-wordmark.png",
    "qr_logo_url": "/assets/brand/tls-mascot.png",
}

SPONSORS = [
    {"name": "OmniFM"},
    {"name": "IT-Tabelander"},
    {"name": "Raiffeisenbank Tirol Mitte West"},
]

TOURNAMENT = {
    "id": "t1",
    "slug": "gamers-heaven-f1-25-fastest-lap-challenge-samstag",
    "title": "Gamers Heaven • F1 25 • Fastest Lap Challenge | Samstag",
}

REGISTRATIONS = [
    {"id": "r1", "display_name": "Koblauchgeist", "discord": "@koblauchgeist", "status": "checked_in", "team": {"tag": "TLS"}},
    {"id": "r2", "display_name": "DerSushi", "discord": "@dersushi", "status": "registered"},
]


def assert_pdf_bytes(payload: bytes, minimum_size: int = 10_000) -> None:
    assert payload.startswith(b"%PDF-")
    assert len(payload) > minimum_size
    assert b"%%EOF" in payload[-2048:]


def assert_portrait_pdf(payload: bytes) -> None:
    match = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]", payload)
    assert match, "PDF MediaBox not found"
    width = float(match.group(1))
    height = float(match.group(2))
    assert height > width


def test_qr_sign_handles_long_titles_and_branded_logo():
    payload = pdf_qr_sign(
        TOURNAMENT["title"],
        "https://lionsquad.at/fastlap/gamers-heaven-f1-25-fastest-lap-challenge-samstag",
        subtitle="Fast Lap",
        eyebrow="Fast-Lap-QR",
        pdf_sponsors=SPONSORS,
        pdf_branding=BRANDING,
    )

    assert_pdf_bytes(payload, minimum_size=100_000)


def test_station_signs_generate_portrait_and_landscape_pages():
    stations = [
        {"name": "Station A", "device_type": "Switch 2", "notes": "Bitte nach dem Match Ergebnis melden."},
        {"name": "Station B", "device_type": "PC", "notes": "Freies Training nach Freigabe."},
    ]

    assert_pdf_bytes(pdf_station_signs(TOURNAMENT, stations, SPONSORS, BRANDING, orientation="portrait"), minimum_size=40_000)
    assert_pdf_bytes(pdf_station_signs(TOURNAMENT, stations, SPONSORS, BRANDING, orientation="landscape"), minimum_size=40_000)


def test_certificates_generate_valid_branded_pdfs():
    row = {"rank": 1, "display_name": "Koblauchgeist", "won": 4, "lost": 0, "points": 12}
    metrics = [
        {"label": "Siege", "value": row["won"]},
        {"label": "Niederlagen", "value": row["lost"]},
        {"label": "Punkte", "value": row["points"]},
    ]
    payload = pdf_certificate(
        {**TOURNAMENT, "subtitle": "Turnier"},
        row,
        category="Gesamtwertung",
        metrics=metrics,
        pdf_sponsors=SPONSORS,
        pdf_branding=BRANDING,
    )
    assert_pdf_bytes(payload, minimum_size=35_000)
    assert_portrait_pdf(payload)

    multi = pdf_certificates([
        {"source": {**TOURNAMENT, "subtitle": "Turnier"}, "row": row, "category": "Gesamtwertung", "metrics": metrics},
        {"source": {**TOURNAMENT, "subtitle": "Turnier"}, "row": {**row, "rank": 2, "display_name": "DerSushi"}, "category": "Gesamtwertung", "metrics": metrics},
    ], SPONSORS, BRANDING)
    assert_pdf_bytes(multi, minimum_size=55_000)
    assert_portrait_pdf(multi)


def test_table_exports_generate_valid_pdfs():
    reg_map = {
        "r1": {"display_name": "Koblauchgeist"},
        "r2": {"display_name": "DerSushi"},
    }
    matches = [
        {
            "round_name": "Runde 1",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "score_a": 0,
            "score_b": 0,
            "scheduled_at": "21.06.2026 13:00",
            "station_id": "Station A",
            "status": "geplant",
        }
    ]
    standings = [{"rank": 1, "display_name": "Koblauchgeist", "wins": 2, "losses": 0, "points": 6}]
    leaderboard = [{"rank": 1, "display_name": "Fabian", "time_str": "1:21.337", "gap_str": "Leader", "attempts": 4}]

    exports = [
        pdf_participants(TOURNAMENT, REGISTRATIONS, SPONSORS, BRANDING),
        pdf_matches(TOURNAMENT, matches, reg_map, SPONSORS, BRANDING),
        pdf_standings(TOURNAMENT, standings, SPONSORS, BRANDING),
        pdf_checkin(TOURNAMENT, REGISTRATIONS, SPONSORS, BRANDING),
        pdf_f1_leaderboard({"title": TOURNAMENT["title"]}, {"name": "Spielberg | Red Bull Ring"}, leaderboard, SPONSORS, BRANDING),
    ]

    for payload in exports:
        assert_pdf_bytes(payload, minimum_size=20_000)
