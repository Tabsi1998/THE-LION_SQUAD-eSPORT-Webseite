import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from achievement_catalog import ACHIEVEMENT_GROUPS, ACHIEVEMENT_TIERS, CONDITION_KEY_STATUS


def test_catalog_codes_and_public_names_are_unique():
    group_codes = [g["code"] for g in ACHIEVEMENT_GROUPS]
    tier_codes = [t["code"] for t in ACHIEVEMENT_TIERS]
    assert len(group_codes) == len(set(group_codes))
    assert len(tier_codes) == len(set(tier_codes))

    public_group_codes = {g["code"] for g in ACHIEVEMENT_GROUPS if g.get("public") and not g.get("is_negative")}
    public_names = [t["name"] for t in ACHIEVEMENT_TIERS if t["group_code"] in public_group_codes]
    duplicates = [name for name, count in Counter(public_names).items() if count > 1]
    assert duplicates == []


def test_every_tier_references_existing_group_and_known_condition_status():
    group_codes = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert all(t["group_code"] in group_codes for t in ACHIEVEMENT_TIERS)

    used_condition_keys = {t.get("condition_key") for t in ACHIEVEMENT_TIERS if t.get("condition_key")}
    assert used_condition_keys <= set(CONDITION_KEY_STATUS)
    assert {"live", "counter", "planned"} >= set(CONDITION_KEY_STATUS.values())


def test_live_progress_targets_are_monotonic_within_group():
    by_group_and_key = defaultdict(list)
    for tier in ACHIEVEMENT_TIERS:
        key = tier.get("condition_key")
        if not key or CONDITION_KEY_STATUS.get(key) != "live":
            continue
        by_group_and_key[(tier["group_code"], key)].append(tier)

    for (group_code, key), tiers in by_group_and_key.items():
        ordered = sorted(tiers, key=lambda t: t["level"])
        targets = [int(t.get("progress_target") or 0) for t in ordered]
        assert targets == sorted(targets), f"{group_code}/{key} targets are not monotonic: {targets}"


def test_membership_tenure_is_marked_member_only():
    membership_tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == "membership_tenure"]
    assert membership_tiers
    assert all(t.get("member_only") is True for t in membership_tiers)


def test_level_milestones_reach_the_top_level():
    # Seit Katalog C (#614): „Levelaufstieg“ misst das Level selbst (5 bis 60), nicht mehr Punkte bis 8,9 Millionen.
    tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] == "level_milestones"]
    targets = {t["code"]: t["progress_target"] for t in tiers}
    assert targets["level_milestones_1"] == 5 and targets["level_milestones_7"] == 60
    assert all(t["condition_key"] == "level" for t in tiers)
    assert not any(t["group_code"] == "level_progression" for t in ACHIEVEMENT_TIERS), "abgelöst"


def test_catalog_has_long_term_depth_and_secret_negative_awards():
    assert len(ACHIEVEMENT_TIERS) >= 300
    negative_groups = {g["code"] for g in ACHIEVEMENT_GROUPS if g.get("is_negative")}
    negative_tiers = [t for t in ACHIEVEMENT_TIERS if t["group_code"] in negative_groups]
    assert len(negative_tiers) >= 50
    assert all(t.get("manual_only") is True for t in negative_tiers)
    assert all(int(t.get("points") or 0) > 0 for t in negative_tiers)


def test_no_public_tier_uses_planned_automation():
    groups = {g["code"]: g for g in ACHIEVEMENT_GROUPS}
    public_tiers = [
        t for t in ACHIEVEMENT_TIERS
        if groups[t["group_code"]].get("public") and not groups[t["group_code"]].get("is_negative")
    ]
    assert [
        t["code"] for t in public_tiers
        if CONDITION_KEY_STATUS.get(t.get("condition_key")) == "planned"
    ] == []


def test_events_hosted_group_is_public_and_counted():
    # Seit Katalog C (#614): „Gastgeber“ zählt abgeschlossene eigene Events automatisch und ist öffentlich (vorher event_host, von Hand, versteckt).
    hosted = next(g for g in ACHIEVEMENT_GROUPS if g["code"] == "events_hosted")
    assert hosted["public"] is True and hosted["condition_key"] == "events_hosted_completed"
    assert not any(g["code"] == "event_host" for g in ACHIEVEMENT_GROUPS)


# ---------- Erfolge II, Katalog A (#612): Spielen und Turnier ----------

from achievement_catalog import COUNTER_KEYS_V2, GROUP_MAPPING, GROUPS_A, LADDERS, REDEFINED, REPLACED, TIERS_A  # noqa: E402
from services import achievement_counters as counters  # noqa: E402


def test_katalog_a_hat_40_gruppen_und_206_stufen_mit_eindeutigen_codes():
    assert len(GROUPS_A) == 40 and len(TIERS_A) == 206
    assert len([g for g in GROUPS_A if g["category"] == "match"]) == 20
    assert len([g for g in GROUPS_A if g["category"] == "tournament"]) == 20
    codes = [g["code"] for g in GROUPS_A]
    assert len(codes) == len(set(codes))
    tier_codes = [t["code"] for t in TIERS_A]
    assert len(tier_codes) == len(set(tier_codes))
    in_catalog = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert set(codes) <= in_catalog
    assert not (set(REPLACED) & in_catalog), "abgelöste Gruppen sind aus dem Katalog"
    assert all(GROUP_MAPPING.get(old) == new for old, new in REPLACED.items())
    assert set(REDEFINED) <= set(codes)


def test_katalog_a_ziele_steigen_material_passt_zur_leiter_texte_da():
    by_group = defaultdict(list)
    for tier in TIERS_A:
        by_group[tier["group_code"]].append(tier)
    for group in GROUPS_A:
        tiers = by_group[group["code"]]
        targets = [t["progress_target"] for t in tiers]
        assert targets == sorted(targets) and len(set(targets)) == len(targets), group["code"]
        assert [t["material"] for t in tiers] == LADDERS[len(tiers)], group["code"]
        assert all(t["condition_key"] == group["condition_key"] for t in tiers)
        assert group["description"] and group["how_to"] and group["icon"] and group["art"]
        assert all(t["description"] and t["how_to"] and t["points"] > 0 for t in tiers)
        assert all(t["name"] == f"{group['name']} {ROMAN}" for t, ROMAN in zip(tiers, ["I", "II", "III", "IV", "V", "VI", "VII"]))
        assert all(t["level"] in (1, 2, 3, 4) for t in tiers), "alte Clients sehen 1–4"


def test_katalog_a_schluessel_sind_live_und_registriert():
    keys = {g["condition_key"] for g in GROUPS_A}
    assert all(CONDITION_KEY_STATUS.get(key) == "live" for key in keys), sorted(key for key in keys if CONDITION_KEY_STATUS.get(key) != "live")
    known = set(counters.REGISTRY) | set(counters.LEGACY_KEYS)
    assert keys <= known, sorted(keys - known)
    assert set(COUNTER_KEYS_V2) >= set(counters.REGISTRY)


# ---- Katalog B (#613): Fast Lap, Saison, Team
from achievement_catalog import GROUPS_B, REDEFINED_B, REPLACED_B, TIERS_B  # noqa: E402


def test_katalog_b_hat_26_gruppen_und_136_stufen_je_kategorie_und_loest_alte_ab():
    assert len(GROUPS_B) == 26 and len(TIERS_B) == 136
    assert len([g for g in GROUPS_B if g["category"] == "fastlap"]) == 9
    assert len([g for g in GROUPS_B if g["category"] == "season"]) == 7
    assert len([g for g in GROUPS_B if g["category"] == "team"]) == 10
    assert sum(1 for t in TIERS_B if t["group_code"] in {g["code"] for g in GROUPS_B if g["category"] == "fastlap"}) == 53
    assert sum(1 for t in TIERS_B if t["group_code"] in {g["code"] for g in GROUPS_B if g["category"] == "season"}) == 37
    assert sum(1 for t in TIERS_B if t["group_code"] in {g["code"] for g in GROUPS_B if g["category"] == "team"}) == 46
    codes = [g["code"] for g in GROUPS_A + GROUPS_B]
    assert len(codes) == len(set(codes)), "kein Code doppelt über die Kataloge"
    tier_codes = [t["code"] for t in TIERS_A + TIERS_B]
    assert len(tier_codes) == len(set(tier_codes))
    in_catalog = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert {g["code"] for g in GROUPS_B} <= in_catalog
    assert not (set(REPLACED_B) & in_catalog), "abgelöste Gruppen sind aus dem Katalog"
    assert all(GROUP_MAPPING.get(old) == new for old, new in REPLACED_B.items())
    assert set(REDEFINED_B) <= set(codes)
    assert all(g["catalog"] == "B" and g["public"] for g in GROUPS_B)


def test_katalog_b_ziele_steigen_material_passt_texte_da_schluessel_live():
    by_group = defaultdict(list)
    for tier in TIERS_B:
        by_group[tier["group_code"]].append(tier)
    for group in GROUPS_B:
        tiers = by_group[group["code"]]
        targets = [t["progress_target"] for t in tiers]
        assert targets == sorted(targets) and len(set(targets)) == len(targets), group["code"]
        assert [t["material"] for t in tiers] == LADDERS[len(tiers)], group["code"]
        assert all(t["condition_key"] == group["condition_key"] for t in tiers)
        assert group["description"] and group["how_to"] and group["icon"] and group["art"]
        assert all(t["description"] and t["how_to"] and t["points"] > 0 for t in tiers)
        assert all(t["level"] in (1, 2, 3, 4) for t in tiers)
    keys = {g["condition_key"] for g in GROUPS_B}
    assert all(CONDITION_KEY_STATUS.get(key) == "live" for key in keys), sorted(key for key in keys if CONDITION_KEY_STATUS.get(key) != "live")
    known = set(counters.REGISTRY) | set(counters.LEGACY_KEYS)
    assert keys <= known, sorted(keys - known)


# ---- Katalog C (#614): Community, Creator, Profil
from achievement_catalog import GROUPS_C, MATERIALS, REDEFINED_C, REPLACED_C, TIERS_C  # noqa: E402


def test_katalog_c_hat_42_gruppen_je_kategorie_und_loest_alte_ab():
    assert len(GROUPS_C) == 42
    assert len([g for g in GROUPS_C if g["category"] == "community"]) == 17
    assert len([g for g in GROUPS_C if g["category"] == "creator"]) == 10
    assert len([g for g in GROUPS_C if g["category"] == "profile"]) == 15
    assert len(TIERS_C) == sum(len([t for t in TIERS_C if t["group_code"] == g["code"]]) for g in GROUPS_C)
    codes = [g["code"] for g in GROUPS_A + GROUPS_B + GROUPS_C]
    assert len(codes) == len(set(codes)), "kein Code doppelt über die Kataloge"
    tier_codes = [t["code"] for t in TIERS_A + TIERS_B + TIERS_C]
    assert len(tier_codes) == len(set(tier_codes))
    in_catalog = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert {g["code"] for g in GROUPS_C} <= in_catalog
    assert not (set(REPLACED_C) & in_catalog), "abgelöste Gruppen sind aus dem Katalog"
    assert all(GROUP_MAPPING.get(old) == new for old, new in REPLACED_C.items())
    assert set(REDEFINED_C) <= set(codes)
    assert all(g["catalog"] == "C" and g["public"] for g in GROUPS_C)
    manual = {g["code"] for g in GROUPS_C if g["manual_only"]}
    assert manual == {"community_helper", "mentor", "creator_spirit"}


def test_katalog_c_ziele_material_texte_und_schluessel():
    by_group = defaultdict(list)
    for tier in TIERS_C:
        by_group[tier["group_code"]].append(tier)
    for group in GROUPS_C:
        tiers = by_group[group["code"]]
        targets = [t["progress_target"] for t in tiers]
        assert targets == sorted(targets) and len(set(targets)) == len(targets), group["code"]
        materials = [t["material"] for t in tiers]
        assert all(m in MATERIALS for m in materials) and materials == sorted(materials, key=lambda m: MATERIALS[m]["rank"]), group["code"]
        if len(tiers) in LADDERS and materials != LADDERS[len(tiers)]:
            assert group["code"] in {"watchdog", "app_user", "passkey", "email_verified", "tutorial", "privacy_aware", "notifications", "birthday_login"}, group["code"]
        assert group["description"] and group["how_to"] and group["icon"] and group["art"]
        assert all(t["description"] and t["how_to"] and t["points"] > 0 for t in tiers)
        assert all(t["level"] in (1, 2, 3, 4) for t in tiers)
        if group["manual_only"]:
            assert group["condition_key"] is None and all(t["manual_only"] and t["condition_key"] is None for t in tiers), group["code"]
        else:
            assert all(t["condition_key"] == group["condition_key"] for t in tiers)
    keys = {g["condition_key"] for g in GROUPS_C if g["condition_key"]}
    assert all(CONDITION_KEY_STATUS.get(key) == "live" for key in keys), sorted(key for key in keys if CONDITION_KEY_STATUS.get(key) != "live")
    known = set(counters.REGISTRY) | set(counters.LEGACY_KEYS)
    assert keys <= known, sorted(keys - known)


# ---- Katalog D (#615): Verein, Besonders, Geheim
from achievement_catalog import GROUPS_D, REDEFINED_D, REPLACED_D, TIERS_D  # noqa: E402


def test_katalog_d_hat_37_gruppen_und_die_kataloge_zusammen_keinen_doppelten_code():
    # Nachtrag #615: Papierkram (3 Stufen), Vorstandsarbeit (5) und Sprinter (geheim) sind messbar; seit #646 „Eierkönig“,
    # seit #848 „Vereinsjubiläum“ (3).
    assert len(GROUPS_D) == 38 and len(TIERS_D) == (7 + 1 + 5 + 5 + 1 + 3 + 5 + 3) + 16 + 14  # Verein 30, Besonders 16, Geheim 14
    codes = [g["code"] for g in GROUPS_A + GROUPS_B + GROUPS_C + GROUPS_D]
    assert len(codes) == len(set(codes)), "kein Code doppelt über die Kataloge"
    tier_codes = [t["code"] for t in TIERS_A + TIERS_B + TIERS_C + TIERS_D]
    assert len(tier_codes) == len(set(tier_codes))
    in_catalog = {g["code"] for g in ACHIEVEMENT_GROUPS}
    assert {g["code"] for g in GROUPS_D} <= in_catalog
    assert REPLACED_D == {}
    assert set(REDEFINED_D) <= set(codes)
    assert all(g["catalog"] == "D" and g["public"] for g in GROUPS_D)
    # Die sieben Negativ-Gruppen bleiben unverändert im alten Block.
    negative = [g for g in ACHIEVEMENT_GROUPS if g.get("is_negative")]
    assert len(negative) == 7 and all("catalog" not in g for g in negative)


def test_katalog_d_ziele_material_texte_und_schluessel():
    by_group = defaultdict(list)
    for tier in TIERS_D:
        by_group[tier["group_code"]].append(tier)
    for group in GROUPS_D:
        tiers = by_group[group["code"]]
        targets = [t["progress_target"] for t in tiers]
        assert targets == sorted(targets) and len(set(targets)) == len(targets), group["code"]
        assert group["description"] and group["how_to"] and group["icon"] and group["art"]
        assert all(t["description"] and t["how_to"] and t["points"] > 0 for t in tiers)
        if group["category"] == "special":
            assert [t["material"] for t in tiers] == ["legendary"], group["code"]
        elif group["category"] == "hidden":
            assert [t["material"] for t in tiers] == ["hidden"], group["code"]
        else:
            assert all(t["material"] in MATERIALS for t in tiers)
        if group["manual_only"]:
            assert group["condition_key"] is None and all(t["manual_only"] and t["condition_key"] is None for t in tiers), group["code"]
        else:
            assert all(t["condition_key"] == group["condition_key"] for t in tiers)
    keys = {g["condition_key"] for g in GROUPS_D if g["condition_key"]}
    assert all(CONDITION_KEY_STATUS.get(key) == "live" for key in keys), sorted(key for key in keys if CONDITION_KEY_STATUS.get(key) != "live")
    known = set(counters.REGISTRY) | set(counters.LEGACY_KEYS)
    assert keys <= known, sorted(keys - known)


def test_die_katalog_pruefung_des_admins_findet_im_code_katalog_keinen_fehler():
    """E10 (#620): dieselben Regeln im Test und im Admin - der ausgelieferte Katalog ist fehlerfrei."""
    from achievement_catalog import apply_category_overrides
    from achievement_catalog.validate import validate_catalog
    groups = [apply_category_overrides(g) for g in ACHIEVEMENT_GROUPS]
    report = validate_catalog(groups, ACHIEVEMENT_TIERS, CONDITION_KEY_STATUS)
    assert report["errors"] == [], report["errors"][:10]
    assert report["counts"]["groups"] == len(groups) and report["counts"]["tiers"] == len(ACHIEVEMENT_TIERS)


# ---- Katalog E (#678): Saison-Fundstücke
from achievement_catalog import GROUPS_E, TIERS_E  # noqa: E402


def test_katalog_e_saison_fundstuecke():
    assert [g["code"] for g in GROUPS_E] == ["bat_whisperer", "snow_catcher", "season_collector"]
    assert len(TIERS_E) == 15 and all(g["catalog"] == "E" and g["category"] == "community" and g["public"] for g in GROUPS_E)
    codes = [g["code"] for g in GROUPS_A + GROUPS_B + GROUPS_C + GROUPS_D + GROUPS_E]
    assert len(codes) == len(set(codes)), "kein Code doppelt über die Kataloge"
    tier_codes = [t["code"] for t in TIERS_A + TIERS_B + TIERS_C + TIERS_D + TIERS_E]
    assert len(tier_codes) == len(set(tier_codes))
    assert {g["code"] for g in GROUPS_E} <= {g["code"] for g in ACHIEVEMENT_GROUPS}
    by_group = defaultdict(list)
    for tier in TIERS_E:
        by_group[tier["group_code"]].append(tier)
    for group in GROUPS_E:
        tiers = by_group[group["code"]]
        assert [t["material"] for t in tiers] == ["bronze", "silver", "gold", "platinum", "diamond"], group["code"]
        targets = [t["progress_target"] for t in tiers]
        assert targets == sorted(targets) and len(set(targets)) == 5
        assert group["description"] and group["how_to"] and group["icon"] and group["art"]
        assert all(t["condition_key"] == group["condition_key"] and t["description"] and t["points"] > 0 for t in tiers)
        assert CONDITION_KEY_STATUS.get(group["condition_key"]) == "live"
        assert group["condition_key"] in counters.REGISTRY and "signal" in counters.REGISTRY[group["condition_key"]].sources
    # Die Deckel machen die oberen Stufen zu einer Sache von Jahren: acht Tage Halloween mit 30 am Tag sind 240.
    assert counters.SIGNAL_RULES["halloween_bats_scared"]["per_day"] * 8 < by_group["bat_whisperer"][3]["progress_target"]
    assert by_group["bat_whisperer"][0]["progress_target"] <= counters.SIGNAL_RULES["halloween_bats_scared"]["per_day"], "die erste Stufe geht an einem Abend"


def test_tier_texts_name_the_unit_once_and_use_the_singular_for_one():
    """#864: „90 Tage im Vorstand.“ statt „90 Tage Tage im Vorstand.“, „1 Jahr dabei.“ statt „1 Jahre dabei.“"""
    import re

    doubled = [t["description"] for t in ACHIEVEMENT_TIERS if re.search(r"\b(Tage?|Jahre?|%) (Tage?|Jahre?|%)(?=\W|$)", t.get("description") or "")]
    assert doubled == []
    plural_one = [t["description"] for t in ACHIEVEMENT_TIERS if re.search(r"(?<!\d)1 (Tage|Jahre)\b", t.get("description") or "")]
    assert plural_one == []
    texts = {t["code"]: t["description"] for t in ACHIEVEMENT_TIERS}
    assert texts["board_service_1"] == "90 Tage im Vorstand."
    assert texts["anniversary_1"] == "1 Jahr dabei." and texts["anniversary_2"] == "2 Jahre dabei."
    assert texts["membership_tenure_1"] == "1 Tag Mitglied."
    # Gegenprobe: der Suchausdruck findet den alten Fehler.
    assert re.search(r"\b(Tage?|Jahre?|%) (Tage?|Jahre?|%)(?=\W|$)", "90 Tage Tage im Vorstand.")
    assert re.search(r"(?<!\d)1 (Tage|Jahre)\b", "1 Jahre dabei.") and not re.search(r"(?<!\d)1 (Tage|Jahre)\b", "21 Tage dabei.")
