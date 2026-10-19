"""Externe Namen den Mitgliedern zuordnen (#1743) - der reine Kern ohne Datenbank: Namen vergleichbar machen und
Vorschläge mit Begründung bilden. Getroffen wird nur bei gleichem Schlüssel, nie bei bloß ähnlichen Namen; die
Startnummer ist nur ein Hinweis. Nur erfundene Namen."""
from services.series_identity import (
    IdentityIndex, club_participants, counts_for_club, exact_alias, is_usable_name, name_keys, normalize_name,
    strip_clan_tags, suggest,
)


# ---------------------------------------------------------------- Normalisieren
def test_case_spaces_and_special_characters_do_not_matter():
    assert normalize_name("  Probe_Fahrer-7 ") == normalize_name("probe fahrer 7") == "probefahrer7"
    assert normalize_name("PROBE.Fahrer") == normalize_name("probe fahrer")
    # Umlaute und Akzente schreiben Veranstalter oft ohne: beide Schreibweisen ergeben denselben Schlüssel.
    assert normalize_name("Löwe Müller") == normalize_name("Lowe Muller")
    # Breite und Sonderformen (Unicode) werden vereinheitlicht.
    assert normalize_name("Ｐｒｏｂｅ") == "probe"
    assert normalize_name("") == "" and normalize_name(None) == ""


def test_clan_tags_are_optional():
    assert strip_clan_tags("[TLS] Probe Fahrer") == "Probe Fahrer"
    assert strip_clan_tags("Probe Fahrer (TLS)") == "Probe Fahrer"
    assert strip_clan_tags("{ABC}<X> Probe") == "Probe"
    # Ein Name, der nur aus einem Tag besteht, bleibt, wie er ist.
    assert strip_clan_tags("[TLS]") == "[TLS]"
    assert name_keys("[TLS] Probe Fahrer") == ("tlsprobefahrer", "probefahrer")
    assert name_keys("Probe Fahrer") == ("probefahrer",)


def test_names_without_letters_or_digits_have_no_key():
    for name in ("!!!", "🙂🙂", "[TLS]", "(TLS) [ABC]", "  ", "---"):
        assert name_keys(name) == () and not is_usable_name(name), name
    assert is_usable_name("[TLS] P") and is_usable_name("7")
    # Ein leerer Schlüssel trifft nie - auch nicht einen (alten) Alias mit leerem Schlüssel.
    index = IdentityIndex(profiles={"p-anna": "Anna Probe"}, game_id=None, aliases=[
        {"name_normalized": "", "target": "member", "profile_id": "p-anna", "game_id": None}])
    assert suggest(index, "!!!") == [] and exact_alias(index, "!!!") is None


def _alias(alias_id, profile_id, game_id=None, target="member", guest_name=None):
    return {"id": alias_id, "name_normalized": "probename", "target": target, "profile_id": profile_id,
            "guest_name": guest_name, "game_id": game_id, "confirmed_at": "2026-01-01T10:00:00+00:00"}


def test_a_game_bound_alias_wins_over_a_global_one_in_any_order():
    profiles = {"p-anna": "Anna Probe", "p-bert": "Bert Probe"}
    aliases = [_alias("a-global", "p-bert"), _alias("a-game", "p-anna", game_id="spiel-1")]
    for order in (aliases, aliases[::-1]):
        assert exact_alias(IdentityIndex(profiles=profiles, aliases=order, game_id="spiel-1"), "Probe Name")["id"] == "a-game"
        # Eine Spur ohne Spiel (oder mit anderem Spiel) nimmt den globalen.
        assert exact_alias(IdentityIndex(profiles=profiles, aliases=order, game_id=None), "Probe Name")["id"] == "a-global"
        assert exact_alias(IdentityIndex(profiles=profiles, aliases=order, game_id="spiel-2"), "Probe Name")["id"] == "a-global"


def test_ambiguous_aliases_never_assign_by_themselves():
    profiles = {"p-anna": "Anna Probe", "p-bert": "Bert Probe"}
    clash = [_alias("a-1", "p-anna"), _alias("a-2", "p-bert")]
    for order in (clash, clash[::-1]):
        index = IdentityIndex(profiles=profiles, aliases=order, game_id=None)
        assert exact_alias(index, "Probe Name") is None
        assert [item["profile_id"] for item in suggest(index, "Probe Name")] == ["p-anna", "p-bert"]
    # Zwei Einträge mit demselben Ziel sind nicht mehrdeutig - genommen wird immer derselbe.
    same = [_alias("a-2", "p-anna"), _alias("a-1", "p-anna")]
    for order in (same, same[::-1]):
        assert exact_alias(IdentityIndex(profiles=profiles, aliases=order, game_id=None), "Probe Name")["id"] == "a-1"
    # Zeigt der spielgebundene Alias auf ein Profil, das es nicht mehr gibt, gibt es nur Vorschläge.
    stale = [_alias("a-global", "p-bert"), _alias("a-game", "p-weg", game_id="spiel-1")]
    assert exact_alias(IdentityIndex(profiles=profiles, aliases=stale, game_id="spiel-1"), "Probe Name") is None


def test_similar_names_have_different_keys():
    assert normalize_name("Probe Fahrer") != normalize_name("Probe Fahrer 2")
    assert normalize_name("ProbeFahrer") != normalize_name("ProbeFahrerin")
    assert normalize_name("Max") != normalize_name("Maxi")


# ---------------------------------------------------------------- Vorschläge
def _index(**overrides) -> IdentityIndex:
    base = {
        "profiles": {"p-anna": "Anna Probe", "p-bert": "Bert Probe", "p-cora": "Cora Probe"},
        "aliases": [],
        "game_ids": [],
        "start_numbers": [],
        "game_id": "spiel-1",
    }
    base.update(overrides)
    return IdentityIndex(**base)


def test_a_game_id_on_the_account_suggests_the_profile():
    index = _index(game_ids=[{"profile_id": "p-anna", "value": "Probe_Racer77", "label": "EA-ID"}])
    found = suggest(index, "probe racer77")
    assert [item["profile_id"] for item in found] == ["p-anna"]
    assert found[0]["basis"] == "game_id" and found[0]["strong"] is True
    assert found[0]["reason"] == "Spiel-ID passt (EA-ID)"
    assert found[0]["label"] == "Anna Probe"


def test_a_confirmed_alias_wins_and_names_its_date():
    alias = {"name_normalized": "pr0berenner", "target": "member", "profile_id": "p-bert", "game_id": "spiel-1",
             "confirmed_at": "2026-03-01T23:30:00+00:00"}
    index = _index(aliases=[alias], game_ids=[{"profile_id": "p-anna", "value": "Pr0Berenner", "label": "PSN"}])
    found = suggest(index, "Pr0Berenner")
    assert [item["profile_id"] for item in found] == ["p-bert", "p-anna"]
    # Wiener Tag: 23:30 UTC am 1. März ist in Wien schon der 2. März.
    assert found[0]["reason"] == "Alias bestätigt am 02.03.2026" and found[0]["basis"] == "alias"


def test_an_alias_can_point_to_a_guest():
    alias = {"name_normalized": "gastprobe", "target": "guest", "profile_id": None, "guest_name": "Gast Probe",
             "game_id": None, "confirmed_at": "2026-02-01T10:00:00+00:00"}
    found = suggest(_index(aliases=[alias]), "Gast Probe")
    assert found[0]["target"] == "guest" and found[0]["guest_name"] == "Gast Probe"
    assert found[0]["label"] == "Gast Probe"


def test_similar_names_are_never_suggested():
    index = _index(
        game_ids=[{"profile_id": "p-anna", "value": "ProbeRacer", "label": "EA-ID"}],
        aliases=[{"name_normalized": "proberacer", "target": "member", "profile_id": "p-bert", "game_id": None,
                  "confirmed_at": "2026-01-01T10:00:00+00:00"}],
    )
    assert suggest(index, "ProbeRacer2") == []
    assert suggest(index, "Probe Racerin") == []
    assert suggest(index, "Racer") == []


def test_a_profile_name_is_a_weaker_suggestion():
    found = suggest(_index(), "cora probe")
    assert found[0]["profile_id"] == "p-cora" and found[0]["basis"] == "profile_name"
    assert found[0]["strong"] is False and found[0]["reason"] == "Name im Profil passt"


def test_without_clan_tag_still_matches_but_says_so():
    index = _index(game_ids=[{"profile_id": "p-anna", "value": "ProbeRacer", "label": "EA-ID"}])
    found = suggest(index, "[TLS] ProbeRacer")
    assert found[0]["profile_id"] == "p-anna"
    assert found[0]["reason"] == "Spiel-ID passt (EA-ID) – ohne Clan-Tag"


def test_the_start_number_is_only_a_hint():
    index = _index(start_numbers=[{"profile_id": "p-bert", "start_number": "17", "season": "2025"}])
    found = suggest(index, "Ganz Neuer Name", start_number="17")
    assert found == [{"target": "member", "profile_id": "p-bert", "guest_name": None, "label": "Bert Probe",
                      "basis": "start_number", "strong": False, "reason": "Gleiche Startnummer 17 wie in 2025"}]
    assert suggest(index, "Ganz Neuer Name", start_number="18") == []
    assert suggest(index, "Ganz Neuer Name") == []


def test_one_profile_appears_once_with_all_reasons():
    index = _index(game_ids=[{"profile_id": "p-anna", "value": "Anna Probe", "label": "PSN"}],
                   start_numbers=[{"profile_id": "p-anna", "start_number": "5", "season": "2025"}])
    found = suggest(index, "Anna Probe", start_number="5")
    assert len(found) == 1
    assert found[0]["basis"] == "game_id"
    assert found[0]["reason"] == "Spiel-ID passt (PSN) · Name im Profil passt · Gleiche Startnummer 5 wie in 2025"


def test_unknown_profiles_are_left_out():
    index = _index(game_ids=[{"profile_id": "p-weg", "value": "Probe", "label": "PSN"}])
    assert suggest(index, "Probe") == []


# ---------------------------------------------------------------- Vereinsstatistik
def test_guests_count_for_the_team_but_not_for_the_club():
    people = [
        {"id": "a", "link": "member", "profile_id": "p-anna"},
        {"id": "b", "link": "guest", "profile_id": None, "guest_name": "Gast Probe"},
        {"id": "c", "link": "external", "profile_id": None},
        {"id": "d", "link": "member", "profile_id": None},  # Verknüpfung gelöst (etwa nach Kontolöschung)
    ]
    assert [counts_for_club(person) for person in people] == [True, False, False, False]
    assert [person["id"] for person in club_participants(people)] == ["a"]


# ---------------------------------------------------------------- Indexe
def test_cross_series_lookups_have_indexes():
    import asyncio

    from mongomock_motor import AsyncMongoMockClient

    import database

    db = AsyncMongoMockClient()["tls_index_test"]
    original = database.get_db
    database.get_db = lambda: db
    try:
        asyncio.run(database.init_indexes())
        names = set(asyncio.run(db.reference_participants.index_information()))
    finally:
        database.get_db = original
    assert {"name_normalized_1_link_status_1", "alias_id_1"} <= names


# ---------------------------------------------------------------- Clan-Tags ohne Regex (CodeQL)
def test_clan_tags_stripped_linear_even_for_long_whitespace():
    import time
    assert strip_clan_tags(" [TLS]  Probe Fahrer  (LS) ") == "Probe Fahrer"
    assert strip_clan_tags("[A][B] Probe {C}") == "Probe"
    assert strip_clan_tags("Probe [mehr als zwoelf Zeichen]") == "Probe [mehr als zwoelf Zeichen]"
    assert not is_usable_name("[TLS]") and not is_usable_name("(Probe)")
    started = time.perf_counter()
    for text in ("a" + " " * 100_000 + "b", "x" + " " * 100_000 + "(a", "[" + " " * 100_000):
        strip_clan_tags(text)
        is_usable_name(text)
    assert time.perf_counter() - started < 1.0
