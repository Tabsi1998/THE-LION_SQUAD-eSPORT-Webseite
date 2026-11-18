"""Zusammengefasste Warnungen, wenn Staffeln die Veto-Vorlage (noch) nicht bekommen (Fabian Nr. 200, #2528): ein Satz je Fall, höchstens
drei Namen - genaue Sätze mit 1, 3 und 5 Staffeln."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.league_veto_fit import BUSY, KEEPS, QUIET, SEASON, SEASON_MISFIT, UNTIL_SYNC, Misfit, warnings_for  # noqa: E402


def names(count: int) -> list[str]:
    return [f"Liga 1 · Staffel {letter}" for letter in "ABCDE"[:count]]


def test_until_the_transfer_is_one_sentence_with_a_name_for_one_staffel():
    assert warnings_for([Misfit(UNTIL_SYNC, name) for name in names(1)]) == [
        "In Liga 1 · Staffel A gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“."]
    for count in (3, 5):
        assert warnings_for([Misfit(UNTIL_SYNC, name) for name in names(count)]) == [
            f"In {count} Staffeln gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“."]


def keeps(count: int, reason: str = "Best of 5") -> list[Misfit]:
    return [Misfit(KEEPS, name, reason) for name in names(count)]


def test_keeps_is_one_sentence_per_reason_with_at_most_three_names():
    assert warnings_for(keeps(1)) == ["Liga 1 · Staffel A spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."]
    assert warnings_for(keeps(3)) == [
        "Liga 1 · Staffel A, Liga 1 · Staffel B und Liga 1 · Staffel C spielen weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."]
    assert warnings_for(keeps(5)) == [
        "Liga 1 · Staffel A, Liga 1 · Staffel B, Liga 1 · Staffel C und 2 weitere spielen weiter Best of 5 – dort bleibt die bisherige "
        "Veto-Vorlage."]
    assert warnings_for(keeps(4))[0].startswith("Liga 1 · Staffel A, Liga 1 · Staffel B, Liga 1 · Staffel C und eine weitere spielen")
    # Je Grund ein Satz, die Namen sortiert.
    mixed = [Misfit(KEEPS, "Liga 2 · Staffel B", "Best of 3"), Misfit(KEEPS, "Liga 1 · Staffel A", "Best of 5"),
             Misfit(KEEPS, "Liga 2 · Staffel A", "Best of 3")]
    assert warnings_for(mixed) == [
        "Liga 2 · Staffel A und Liga 2 · Staffel B spielen weiter Best of 3 – dort bleibt die bisherige Veto-Vorlage.",
        "Liga 1 · Staffel A spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."]


def test_season_misfit_and_busy_and_all_together():
    assert warnings_for([Misfit(SEASON, name) for name in names(5)]) == [SEASON_MISFIT]
    assert warnings_for([Misfit(BUSY, name) for name in names(1)]) == [
        "Liga 1 · Staffel A wird gerade bearbeitet – dort gilt die neue Veto-Vorlage erst nach dem nächsten Übertragen."]
    assert warnings_for([Misfit(BUSY, name) for name in names(3)]) == [
        "Liga 1 · Staffel A, Liga 1 · Staffel B und Liga 1 · Staffel C werden gerade bearbeitet – dort gilt die neue Veto-Vorlage erst nach "
        "dem nächsten Übertragen."]
    together = [Misfit(BUSY, "Liga 1 · Staffel D"), Misfit(KEEPS, "Liga 1 · Staffel C", "Best of 5"), Misfit(UNTIL_SYNC, "Liga 1 · Staffel B"),
                Misfit(UNTIL_SYNC, "Liga 1 · Staffel A")]
    assert warnings_for(together) == [
        "In 2 Staffeln gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“.",
        "Liga 1 · Staffel C spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage.",
        "Liga 1 · Staffel D wird gerade bearbeitet – dort gilt die neue Veto-Vorlage erst nach dem nächsten Übertragen."]
    assert warnings_for([]) == []


def test_quiet_misfits_say_nothing_and_names_sort_like_numbers():
    # Läuft in der Staffel ohnehin kein Veto (Liga N mit schon immer abweichendem Best of), gibt es keinen Satz „bleibt“ (#2528).
    assert warnings_for([Misfit(QUIET, "Liga 2 · Staffel A", "Best of 3")]) == []
    assert warnings_for([Misfit(QUIET, "Liga 2 · Staffel A", "Best of 3"), Misfit(KEEPS, "Liga 1 · Staffel A", "Best of 3")]) == [
        "Liga 1 · Staffel A spielt weiter Best of 3 – dort bleibt die bisherige Veto-Vorlage."]
    # Zahlen als Zahlen: Liga 3 vor Liga 10.
    assert warnings_for([Misfit(KEEPS, "Liga 10 · Staffel A", "Best of 5"), Misfit(KEEPS, "Liga 3 · Staffel A", "Best of 5")]) == [
        "Liga 3 · Staffel A und Liga 10 · Staffel A spielen weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."]
