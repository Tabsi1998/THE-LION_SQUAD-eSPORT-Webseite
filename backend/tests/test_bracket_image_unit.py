"""Das Bracket als Bild (#575): Abschnitte und Runden in der richtigen Reihenfolge, Positionen wie im K.-o.-Baum, ein
echtes PNG mit dem Sieger in Gold, ohne K.-o.-Phase oder bei Riesenbäumen kein Bild, und eine Prüfsumme, die auch
frühere Runden kennt."""
import io
import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services import bracket_image  # noqa: E402

PITCH = bracket_image.BOX_H + bracket_image.GAP_Y
REGS = [{"id": f"r{i}", "display_name": name} for i, name in enumerate(["Paula", "Leon", "Mia", "Otto"], start=1)]
STAGES = [{"id": "s1", "number": 1, "name": "Playoffs", "stage_type": "single_elimination"}]


def match(match_id, round_number, order, a, b, *, status="pending", score=None, section="wb", stage="s1"):
    results = []
    if score:
        results = [{"registration_id": a, "outcome": "winner" if score[0] > score[1] else "loser", "score": score[0]},
                   {"registration_id": b, "outcome": "winner" if score[1] > score[0] else "loser", "score": score[1]}]
    slots = [{"position": 1, "registration_id": a}, {"position": 2, "registration_id": b}]
    return {"id": match_id, "stage_id": stage, "round": round_number, "order": order, "section": section, "slots": slots, "results": results,
            "status": status}


def four_player_bracket(final_score=None):
    return [
        match("m1", 1, 1, "r1", "r2", status="completed", score=(2, 0)),
        match("m2", 1, 2, "r3", "r4", status="completed", score=(1, 2)),
        match("f", 2, 1, "r1", "r4", status="completed" if final_score else "live", score=final_score),
    ]


def test_positions_follow_the_knockout_tree():
    assert bracket_image.positions([4, 2, 1]) == [[PITCH * 0.5, PITCH * 1.5, PITCH * 2.5, PITCH * 3.5], [PITCH, PITCH * 3], [PITCH * 2]]
    assert bracket_image.positions([2, 2, 1]) == [[PITCH * 0.5, PITCH * 1.5], [PITCH * 0.5, PITCH * 1.5], [PITCH]], "gleich große Runde: gleiche Höhe"
    assert bracket_image.positions([3, 1]) == [[PITCH * 0.5, PITCH * 1.5, PITCH * 2.5], [PITCH * 1.5]], "sonst gleichmäßig über die Höhe"


def test_sections_in_order_without_tables_and_previews():
    stages = STAGES + [{"id": "g", "number": 0, "name": "Gruppen", "stage_type": "round_robin_groups"}]
    matches = [
        match("gf", 1, 1, "r1", "r4", section="gf"),
        match("lb1", 1, 1, "r2", "r3", section="lb"),
        match("wb2", 2, 1, "r1", "r4"),
        match("wb1b", 1, 2, "r3", "r4"),
        match("wb1a", 1, 1, "r1", "r2"),
        match("grp", 1, 1, "r1", "r2", stage="g"),
        {**match("pre", 1, 3, "r1", "r3"), "is_preview": True},
    ]
    sections = bracket_image.bracket_sections(matches, stages)
    assert [section["label"] for section in sections] == ["Winner Bracket", "Loser Bracket", "Grand Final"]
    assert [[m["id"] for m in round_matches] for round_matches in sections[0]["rounds"]] == [["wb1a", "wb1b"], ["wb2"]]


def test_the_image_is_a_real_png_with_the_winner_in_gold():
    data = bracket_image.render({"title": "Sommer-Cup"}, four_player_bracket((3, 1)), STAGES, REGS, final=True)
    image = Image.open(io.BytesIO(data))
    assert image.format == "PNG" and image.size[0] == bracket_image.MIN_WIDTH
    expected_height = bracket_image.HEADER_H + bracket_image.SECTION_LABEL_H + bracket_image.ROUND_LABEL_H + 2 * PITCH + bracket_image.MARGIN + bracket_image.MARGIN // 2
    assert image.size[1] == expected_height
    gold = sum(1 for pixel in image.convert("RGB").getdata() if pixel[0] > 240 and 200 < pixel[1] < 225 and pixel[2] < 40)
    assert gold > 50, "Sieger und Titel des Endstands in Gold"
    live = bracket_image.render({"title": "Sommer-Cup"}, four_player_bracket(), STAGES, REGS)
    cyan = sum(1 for pixel in Image.open(io.BytesIO(live)).convert("RGB").getdata() if pixel[0] < 60 and 170 < pixel[1] < 195 and pixel[2] > 220)
    assert cyan > 50, "die laufende Partie hat einen cyanen Rahmen"


def test_no_image_without_a_knockout_phase_or_for_huge_trees():
    groups = [{"id": "g", "number": 1, "name": "Gruppen", "stage_type": "round_robin_groups"}]
    assert bracket_image.render({"title": "Liga"}, [match("m", 1, 1, "r1", "r2", stage="g")], groups, REGS) is None
    huge = [match(f"m{i}", 1, i, "r1", "r2") for i in range(bracket_image.MAX_ROUND_MATCHES + 1)]
    assert bracket_image.render({"title": "Riesig"}, huge, STAGES, REGS) is None


def test_the_signature_knows_earlier_rounds_too():
    before = bracket_image.signature(bracket_image.bracket_sections(four_player_bracket((3, 1)), STAGES))
    corrected = four_player_bracket((3, 1))
    corrected[0] = match("m1", 1, 1, "r1", "r2", status="completed", score=(2, 1))
    assert bracket_image.signature(bracket_image.bracket_sections(corrected, STAGES)) != before
    assert bracket_image.signature(bracket_image.bracket_sections(four_player_bracket((3, 1)), STAGES)) == before
