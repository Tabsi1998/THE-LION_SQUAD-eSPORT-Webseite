"""``now`` reicht bis zur Datumsform durch (#1307, Review-Befund 3): Ob das Jahr dasteht, entscheidet der Bezugszeitpunkt
des Aufrufers - nicht die Uhr des Servers. Die autouse-Fixture stellt diese Uhr auf den 28.11.2026; hier ist ``now``
der 2. Jänner 2027, also steht beim Jänner-Termin kein Jahr."""
from datetime import datetime, timezone

from services import discord_bracket, discord_embeds, event_days

NOW = datetime(2027, 1, 2, 10, 0, tzinfo=timezone.utc)


def test_event_tage_nehmen_das_jahr_aus_now():
    assert event_days._relative(datetime(2027, 1, 5, 17, 0, tzinfo=timezone.utc), NOW) == "am Di 5. Jänner · 18:00"


def test_stand_zeilen_nehmen_das_jahr_aus_now():
    assert discord_embeds.stand_footer(NOW) == "Stand: Sa 2. Jänner · 11:00"
    embed = discord_bracket.bracket_embed({"title": "Cup", "slug": "cup"}, [], [], [], "https://x", now=NOW)
    assert embed["footer"].endswith("Sa 2. Jänner · 11:00")
