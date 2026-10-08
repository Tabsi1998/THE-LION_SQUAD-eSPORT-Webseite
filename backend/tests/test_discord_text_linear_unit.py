"""Discord-Texte aufräumen in einem Durchgang (#1408).

Früher erledigten das reguläre Ausdrücke, die bei bestimmten langen Eingaben (viele „<“, „[[“ oder Leerzeichen
ohne passendes Ende) quadratisch lange rechneten - der Server stand so lange still. Die neuen Fassungen liefern
genau dasselbe Ergebnis: das prüfen die Vergleiche mit den alten Ausdrücken über alle kurzen Texte aus den
kritischen Zeichen und über viele zufällige längere. Lange, bösartige Eingaben sind jetzt sofort fertig.
"""
import itertools
import random
import re
import time

from services import discord_announcements, discord_design


def old_plain_text(value, limit=300):
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"[#*_`>\[\]]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def old_optional_parts(text, keep):
    return re.sub(r"\[\[(.+?)\]\]", lambda match: keep(match.group(1)), text, flags=re.S)


def old_tidy(text):
    lines = []
    for line in str(text or "").split("\n"):
        line = re.sub(r"\[\]\([^)]*\)", "", line)
        line = line.replace("****", "")
        line = re.sub(r"(\s*·\s*){2,}", " · ", line)
        line = re.sub(r"^\s*·\s*|\s*·\s*$", "", line)
        line = re.sub(r"\s{2,}", " ", line).strip()
        lines.append(line)
    return "\n".join(lines).strip()


def every_text(alphabet: str, longest: int):
    for length in range(longest + 1):
        for chars in itertools.product(alphabet, repeat=length):
            yield "".join(chars)


def random_texts(alphabet: str, count: int = 3000, longest: int = 40, seed: int = 1408):
    rng = random.Random(seed)
    for _ in range(count):
        yield "".join(rng.choice(alphabet) for _ in range(rng.randint(0, longest)))


def finishes_fast(call, text, seconds=1.0):
    started = time.perf_counter()
    call(text)
    return time.perf_counter() - started < seconds


def test_tags_are_removed_exactly_as_before():
    for text in itertools.chain(every_text("<>a", 8), random_texts("<>a b\n#*")):
        assert discord_announcements._without_tags(text) == re.sub(r"<[^>]+>", " ", text), repr(text)
        assert discord_announcements.plain_text(text, 25) == old_plain_text(text, 25), repr(text)
    assert discord_announcements.plain_text("<p>Hallo **Welt**</p>\n\n# Titel") == "Hallo Welt Titel"


def test_optional_parts_are_found_exactly_as_before():
    def keep(inner):
        return "" if "x" in inner else f"<{inner}>"

    for text in itertools.chain(every_text("[]a", 9), every_text("[]x\n", 7), random_texts("[]ax \n{}")):
        assert discord_design._optional_parts(text, keep) == old_optional_parts(text, keep), repr(text)


def test_tidy_gives_exactly_the_old_result():
    for text in itertools.chain(every_text("[]()a", 6), every_text(" ·a\t", 7), every_text("·* \n", 6),
                                random_texts("[]()· a*\t\n", count=5000)):
        assert discord_design.tidy(text) == old_tidy(text), repr(text)
    assert discord_design.tidy("**Turnier** · · [](https://x) · Start\n · Ende · ") == "**Turnier** · Start\nEnde"


def test_long_hostile_texts_finish_at_once():
    assert finishes_fast(discord_announcements.plain_text, "<" * 200_000)
    assert finishes_fast(discord_announcements.plain_text, "<a" * 100_000)
    assert finishes_fast(lambda text: discord_design.fill(text, {}, {}, escape=True), "[[a" * 70_000)
    assert finishes_fast(discord_design.tidy, "[](" * 70_000)
    assert finishes_fast(discord_design.tidy, " " * 200_000 + "x")
    assert finishes_fast(discord_design.tidy, "x" + " " * 200_000 + "·" + " " * 200_000 + "x")
