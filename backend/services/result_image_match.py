"""Ergebnis-Bilder (#1756): aus den Lesungen (``result_image_ocr.Reading``) Werte machen, sie gegeneinander prüfen und
mit den Teilnehmern der Saison abgleichen - ohne Datenbank.

**Wert je Zelle** (``decide``): Jede Zelle hat bis zu zwei Lesungen (ganze Seite und Spalten-Streifen, Zahlen mit
Whitelist). Sicher ist eine Zelle, wenn beide dasselbe ergeben oder die einzige Lesung über ``min_confidence`` liegt.
Widersprechen sie sich, ist sie unsicher - außer eine Gegenprobe bestätigt den Wert:

- **Platz:** Die Plätze laufen ohne Lücke hoch; „DNF“, „DNS“, „DSQ“ stehen statt eines Platzes (``dnf``, ``marks``).
- **Zeit und Abstand:** Zeit = Zeit des Ersten + Abstand (auf eine Tausendstel); Zeiten steigen mit dem Platz.
- **Grid:** jede Startposition nur einmal.
- **Startnummer als Anker:** Gehören gelesene Startnummer und gelesener Name zum selben Teilnehmer, sind beide sicher.
  Zeigen sie auf verschiedene Teilnehmer, wird der Name genommen und die Startnummer gelb.
- **Namen unscharf:** Ähnlichkeit (``difflib``) über den Schlüssel aus ``series_identity`` und eine Fassung, in der
  leicht verwechselte Zeichen gleich sind (0/O, 1/l/I, 5/S, 8/B, 2/Z, rn/m, ii/ü; Groß/klein und Satzzeichen wie
  „__“/„_“ zählen ohnehin nicht). Ab ``name_match`` wird der Teilnehmer vorgeschlagen, ab ``name_sure`` ohne
  Markierung - aber nur mit klarem Abstand (``name_margin``) zum Zweitbesten. Aliase der Mitglieder (nur für den
  Vorstand, wie in #1743) und gelernte Schreibweisen aus Bildern (``read_aliases``, #2012) zählen wie Namen. Jeder
  Teilnehmer höchstens einmal.
- **Nie grün geraten (#2012):** Ein unbekannter Name ist immer gelb, wie sicher die Erkennung auch ist. Teilnehmer
  anderer Saisons derselben Spur (``track``) werden mit ihrem Namen vorgeschlagen - ohne Kennung, gelb, mit Hinweis
  „wie in Saison X“ (``hint``); den Teilnehmer legt erst das Übernehmen an.
- **Team:** gegen die bekannten Teams der Saison (``teams``, dazu die Standard-Teams der Teilnehmer), zuerst das des
  erkannten Teilnehmers. Ein Team nur aus einer anderen Saison (``track_teams``) ist gelb mit Hinweis, ein unbekanntes
  gelb.

Unsichere Felder stehen je Zeile in ``uncertain`` (die Oberfläche färbt sie gelb), das Gelesene in ``read``, wenn es
vom Wert abweicht, ein Hinweis zum Wert in ``hint``, und was im Bild stand in ``image`` (Name, Team - damit das Blatt
beim Übernehmen eine Korrektur als Schreibweise lernen kann, #2012). Gespeichert wird hier nichts - erst, wenn jemand
das Blatt prüft und übernimmt.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from services import series_identity
from services.result_image_ocr import Read, Reading, RowReading
from services.result_image_values import (
    DIGIT_FIX, TimeFormat, compact, is_noise, is_placeholder, mark_of, parse_clock, parse_gap, parse_time,
    read_digits, time_format,
)

# Leicht verwechselte Zeichen - nur für den Vergleich von Namen, nie für den angezeigten Wert.
_LOOKALIKE = str.maketrans({"0": "o", "1": "l", "i": "l", "5": "s", "8": "b", "6": "b", "2": "z"})
# Zeichenfolgen, die in Bildschirmschrift wie ein Zeichen aussehen (#2012): „rn“ wie „m“, „ii“ wie „ü“ (ohne Punkte
# bleibt „u“ - ``normalize_name`` nimmt die Akzente weg).
_FOLDS = (("rn", "m"), ("ii", "u"))
# Ähnlichkeit, wenn zwei Namen erst mit den Verwechslungen gleich sind - knapp unter einem genauen Treffer, damit der
# genau passende Name gewinnt und zwei so ähnliche Teilnehmer nie eindeutig sind (``name_margin``).
LOOKALIKE_SCORE = 0.98
# Ab dieser Ähnlichkeit zum Teilnehmer lernt das Blatt eine gelesene Schreibweise (#2012, ``learnable``) - ganz andere
# Namen sind keine Verlesung, sondern eine andere Zeile.
LEARN_SIMILARITY = 0.5
TIME_TOLERANCE = 0.0015
AGREEMENT_BONUS = 20
# Ein Platz (oder „DNF“) steht in jeder Zeile - ist er nicht gelesen, ist die Zelle unsicher. Leer sein darf etwa der
# Abstand des Siegers.
REQUIRED_KINDS = {"place"}
# Ziffern-Spalten mit dritter Lesung (anders vorbereitet, ``RowReading.alts``): widerspricht sie, ist die Zelle gelb.
DIGIT_KINDS = {"place", "number", "time", "gap"}
# Längen wie im Ergebnis-Blatt (``reference_result_routes.ResultEntryRow``) - so bleibt die Antwort klein.
TEXT_LIMIT = 120
FIELD_LIMITS = {"name": TEXT_LIMIT, "team": TEXT_LIMIT, "start_number": 10, "time": 20, "gap": 20}


# ---------------------------------------------------------------- Lesen und Werte
@dataclass
class Decision:
    value: object = None  # int, str oder (Sekunden, Text) - je nach Art
    text: str = ""  # angezeigter Wert
    sure: bool = True
    raw: str = ""  # gelesen (die gewählte Lesung)
    conf: float = 0.0
    mark: str | None = None
    disagree: bool = False
    # Ziffern: die verschiedenen Werte aller Lesungen (Seite, Streifen, dritte Lesung) - eine Gegenprobe darf einen
    # davon bestätigen, wenn sie genau ihn stützt (``_settle``).
    options: list = field(default_factory=list)


def _parse(kind: str, read: Read, *, page: bool, fmt: TimeFormat | None = None):
    """Wert einer Lesung oder ``None``. ``page``: Seitenlesung ohne Whitelist - Ziffern dürfen verlesen sein. ``fmt``:
    die Form der Zeiten des Veranstalters - sie setzt die Trennzeichen (``parse_clock``)."""
    if kind == "place":
        mark = mark_of(read.text)
        if mark:
            return ("mark", mark)
        digits = read_digits(read.text, fix=page)
        return ("place", int(digits)) if digits and 0 < int(digits) <= 999 else None
    if kind == "number":
        digits = read_digits(read.text, fix=page)
        return ("number", digits.lstrip("0") or "0") if digits else None
    if kind in ("time", "gap") and is_placeholder(read.text):
        return ("empty", None)
    if kind == "time":
        mark = mark_of(read.text)
        if mark:
            return ("mark", mark)
        lapped = parse_gap(read.text)  # Überrundete: „+1 Runden“ statt einer Zeit
        if lapped and lapped[1] is None:
            return ("lap", lapped[0])
        parsed = parse_clock(read.text, fmt, fix=page) if fmt else parse_time(read.text, fix=page)
        return ("time", parsed) if parsed else None
    if kind == "gap":
        parsed = parse_gap(read.text, fix=page, fmt=fmt)
        return ("gap", parsed) if parsed else None
    text = clean_text(read.text)
    return ("text", text) if text else None


def clean_text(text: str) -> str:
    """Leerraum zusammengefasst, Satzzeichen-Reste am Rand weg (Linien, Striche, Punkte aus der Erkennung)."""
    words = str(text or "").split()
    while words and not any(char.isalnum() for char in words[0]):
        words.pop(0)
    while words and not any(char.isalnum() for char in words[-1]):
        words.pop()
    return " ".join(words)


def _display(parsed) -> str:
    kind, value = parsed
    if kind in ("time",):
        return value[1]
    if kind == "gap":
        return value[0]
    if kind == "mark":
        return value.upper()
    if kind == "empty":
        return ""
    return str(value)


def _same(left, right) -> bool:
    if left is None or right is None:
        return False
    if left[0] != right[0]:
        return False
    if left[0] == "text":
        return series_identity.normalize_name(left[1]) == series_identity.normalize_name(right[1])
    return _display(left) == _display(right)


def _exact(text: str) -> str:
    return " ".join(clean_text(text).split())


def decide(kind: str, page: Read | None, strip: Read | None, min_conf: float, *, fmt: TimeFormat | None = None,
           alt: Read | None = None) -> Decision:
    """Ein Wert aus Seiten- und Streifenlesung (siehe Modultext). Ziffern haben eine dritte Lesung ``alt`` (anders
    vorbereitet): sagt sie sicher genug (``min_conf``) etwas anderes - etwa 5 statt 3 -, ist die Zelle gelb, nie still
    falsch. Eine unsichere dritte Lesung ist Rauschen und zählt nicht."""
    decision = _decide_two(kind, page, strip, min_conf, fmt)
    if kind not in DIGIT_KINDS:
        return decision
    for read, is_page in ((page, True), (strip, False), (alt, False)):
        if read is None or not read.text.strip() or is_noise(read.text):
            continue
        if read is alt and read.conf < min_conf:
            continue
        parsed = _parse(kind, read, page=is_page, fmt=fmt)
        if parsed is not None and all(_display(parsed) != _display(item) for item in decision.options):
            decision.options.append(parsed)
        plus = _plus_as_four(kind, read, is_page, fmt)
        if plus is not None and all(_display(plus) != _display(item) for item in decision.options):
            decision.options.append(plus)
    # Die Lesungen widersprechen sich (auch die dritte) - auch, wenn Seite und Streifen nur einen Platzhalter oder
    # nichts lasen, eine Lesung aber einen Wert. Ausfall-Zeilen und der Abstand des Siegers entscheidet ``build`` neu.
    if any(_display(item) != decision.text for item in decision.options):
        decision.sure, decision.disagree = False, True
    return decision


def _plus_as_four(kind: str, read: Read, page: bool, fmt: TimeFormat | None):
    """Ein Abstand ohne Plus, der mit 4 beginnt („47,441“): das Plus kann als 4 gelesen sein (#2012) - auch „+7,441“
    ist dann eine Lesung. Nur eine weitere Lesung: entscheiden muss die Probe Zeit = Zeit des Ersten + Abstand."""
    text = compact(read.text)
    if kind != "gap" or not text.startswith("4") or "+" in text or len(text) < 3:
        return None
    return _parse(kind, Read("+" + text[1:], read.conf, read.parts), page=page, fmt=fmt)


def _take(decision: Decision, parsed) -> None:
    """Eine der Lesungen übernehmen (Wert, Anzeige, Marke)."""
    kind, value = parsed
    decision.value, decision.text, decision.mark = value, _display(parsed), None
    if kind == "mark":
        decision.mark, decision.value = value, None


def _settle(decision: Decision, kind: str, fits) -> None:
    """Gegenprobe für eine Zelle: stützt sie genau eine ihrer Lesungen, gilt diese - grün; stützt sie keine oder mehrere
    (die Lesungen widersprechen sich und die Probe entscheidet nicht), ist die Zelle gelb. Sagt eine Lesung etwas ganz
    anderes (ein „DNF“ statt eines Platzes, „+1 Runde“ statt einer Zeit), bleibt das ein Widerspruch - gelb."""
    matching = [item for item in _options(decision, kind) if fits(item[1])]
    if len(matching) == 1 and not _foreign(decision, kind):
        _take(decision, matching[0])
        decision.sure = True
    else:
        decision.sure = False


def _options(decision: Decision | None, kind: str) -> list:
    return [item for item in decision.options if item[0] == kind] if decision is not None else []


def _foreign(decision: Decision | None, kind: str) -> bool:
    """Liest eine der Lesungen einen Wert anderer Art (Marke, Runden, Platzhalter) als die Probe prüft?"""
    return decision is not None and any(item[0] != kind for item in decision.options)


def _confirm(decision: Decision | None) -> None:
    """Eine Gegenprobe bestätigt - aber nie gegen widersprüchliche Lesungen."""
    if decision is not None and not decision.disagree:
        decision.sure = True


def _decide_two(kind: str, page: Read | None, strip: Read | None, min_conf: float,
                fmt: TimeFormat | None) -> Decision:
    # Nur Linien oder Punkte (der Rand der Tabelle, ein Trennstrich) sind keine Lesung.
    reads = [(read, _parse(kind, read, page=is_page, fmt=fmt)) for read, is_page in ((page, True), (strip, False))
             if read and read.text.strip() and not is_noise(read.text)]
    if not reads:
        return Decision(sure=kind not in REQUIRED_KINDS)
    parsed_reads = [(read, parsed) for read, parsed in reads if parsed is not None]
    if not parsed_reads:
        best = max(reads, key=lambda item: item[0].conf)[0]
        text = clean_text(best.text)
        if kind in ("time", "gap") and not any(char.isdigit() for char in text):
            text = ""  # Zeiten haben Ziffern - verlesene Platzhalter („+--:--,---“) nicht ins Feld, nur gelb
        return Decision(value=None, text=text, sure=False, raw=best.text, conf=best.conf)
    if kind == "text" and len(parsed_reads) == 2 and _same(parsed_reads[0][1], parsed_reads[1][1]):
        # Namen und Teams sind frei - Tesseract verliest sie oft zweimal fast gleich (ein Leerzeichen mehr, l statt I).
        # Sicher nur, wenn beide Lesungen Zeichen für Zeichen gleich sind und jede für sich über der Schwelle liegt.
        read, parsed = max(parsed_reads, key=lambda item: item[0].conf)
        exact = _exact(parsed_reads[0][0].text) == _exact(parsed_reads[1][0].text)
        return _decision(parsed, read, sure=exact and all(item[0].conf >= min_conf for item in parsed_reads))
    if len(parsed_reads) == 2 and _same(parsed_reads[0][1], parsed_reads[1][1]):
        # Zwei unabhängige Lesungen sagen dasselbe - dafür reicht weniger Sicherheit je Wort.
        read, parsed = max(parsed_reads, key=lambda item: item[0].conf)
        return _decision(parsed, read, sure=read.conf >= min_conf - AGREEMENT_BONUS)
    if len(parsed_reads) == 2:
        (page_read, page_parsed), (strip_read, strip_parsed) = parsed_reads
        if kind == "text":
            chosen = max(parsed_reads, key=lambda item: item[0].conf)
        else:
            # Zahlen: der Streifen mit Whitelist gilt, außer er ist deutlich unsicherer.
            chosen = (strip_read, strip_parsed) if strip_read.conf >= page_read.conf - 10 else (page_read, page_parsed)
        decision = _decision(chosen[1], chosen[0], sure=False)
        decision.disagree = True
        return decision
    read, parsed = parsed_reads[0]
    other_unparsed = len(reads) > 1
    return _decision(parsed, read, sure=read.conf >= min_conf and not other_unparsed)


def _decision(parsed, read: Read, *, sure: bool) -> Decision:
    kind, value = parsed
    out = Decision(value=value, text=_display(parsed), sure=sure, raw=read.text, conf=read.conf)
    if kind == "mark":
        out.mark, out.value, out.text = value, None, value.upper()
    return out


# ---------------------------------------------------------------- Namen
def _loose(key: str) -> set[str]:
    """Fassungen eines Schlüssels, in denen leicht verwechselte Zeichen gleich sind - mit und ohne die Folgen
    (``_FOLDS``), denn „ii“ kann ebenso als „ll“ ankommen."""
    folded = key
    for old, new in _FOLDS:
        folded = folded.replace(old, new)
    return {key.translate(_LOOKALIKE), folded.translate(_LOOKALIKE)}


def similarity(read: str, known: str) -> float:
    """Ähnlichkeit 0-1 zweier Namen, unempfindlich gegen Groß/klein, Leerzeichen, Satzzeichen und Clan-Tags. Gleich erst
    mit den Verwechslungen (l/1/I, 0/O, rn/m, ii/ü …): ``LOOKALIKE_SCORE``. Zwei verschiedene Tags einer Spielkennung
    („Name#AAA“, „Name#BBB“, #1961) sind verschiedene Personen: 0."""
    if series_identity.tags_conflict(read, known):
        return 0.0
    left_keys, right_keys = set(series_identity.name_keys(read)), set(series_identity.name_keys(known))
    if left_keys & right_keys:
        return 1.0
    left_loose = {form for key in left_keys for form in _loose(key)}
    right_loose = {form for key in right_keys for form in _loose(key)}
    if left_loose & right_loose:
        return LOOKALIKE_SCORE
    return max((SequenceMatcher(None, left, right).ratio() for left in left_keys | left_loose
                for right in right_keys | right_loose), default=0.0)


@dataclass
class Candidate:
    participant: dict
    names: list[str] = field(default_factory=list)  # eigener Name, Aliase und gelernte Schreibweisen
    season: str | None = None  # nur aus einer anderen Saison der Spur (``track``): deren Bezeichnung

    @property
    def foreign(self) -> bool:
        return self.season is not None


def own_names(row: dict) -> list[str]:
    """Name und gelernte Schreibweisen aus Bildern (#2012) eines Teilnehmers."""
    learned = [item.get("name") for item in row.get("read_aliases") or [] if isinstance(item, dict)]
    return [row.get("name") or "", *(name for name in learned if name)]


def candidates(participants: list[dict], aliases: list[dict] | None = None,
               track: list[dict] | None = None) -> list[Candidate]:
    """Teilnehmer der Saison mit ihren Namen; ``aliases`` (nur Vorstand) als ``{"name", "participant_id"}``.

    ``track`` (#2012): Teilnehmer anderer Saisons derselben Spur, je mit ``season`` (Bezeichnung) - die neueste zuerst.
    Wer in dieser Saison schon steht (gleicher Name oder Alias, dasselbe Profil, derselbe Gast), fällt weg; je Name
    zählt die erste Saison."""
    def add_aliases(pool: dict[str, Candidate]) -> None:
        for alias in aliases or []:
            target = pool.get(alias.get("participant_id"))
            if target and alias.get("name"):
                target.names.append(alias["name"])

    out = {row["id"]: Candidate(row, own_names(row)) for row in participants if row.get("id")}
    add_aliases(out)
    taken = {key for candidate in out.values() for name in candidate.names for key in series_identity.name_keys(name)}
    profiles = {row.get("profile_id") for row in participants if row.get("link") == "member" and row.get("profile_id")}
    guests = {series_identity.normalize_name(row.get("guest_name")) for row in participants
              if row.get("link") == "guest" and row.get("guest_name")}
    others: dict[str, Candidate] = {}
    for row in track or []:
        keys = set(series_identity.name_keys(row.get("name")))
        same_person = ((row.get("link") == "member" and row.get("profile_id") in profiles)
                       or (row.get("link") == "guest"
                           and series_identity.normalize_name(row.get("guest_name")) in guests))
        if not row.get("id") or not keys or keys & taken or same_person or row["id"] in out:
            continue
        taken |= keys
        others[row["id"]] = Candidate(row, own_names(row), season=str(row.get("season") or ""))
    add_aliases(others)
    return [*out.values(), *others.values()]


def learnable(read: str, name: str) -> bool:
    """Taugt eine gelesene Schreibweise als gelernter Alias für ``name`` (#2012)? Nutzbar, nicht schon derselbe Name,
    kein anderer Tag einer Spielkennung und ähnlich genug, um eine Verlesung zu sein."""
    keys = set(series_identity.name_keys(read))
    return (bool(keys) and not keys & set(series_identity.name_keys(name))
            and similarity(read, name) >= LEARN_SIMILARITY)


def best_name(texts: list[str], pool: list[Candidate]) -> list[tuple[float, Candidate]]:
    """Alle Teilnehmer mit ihrer besten Ähnlichkeit zu einer der Lesungen, die ähnlichsten zuerst."""
    scored = []
    for candidate in pool:
        score = max((similarity(text, name) for text in texts if text for name in candidate.names if name),
                    default=0.0)
        scored.append((score, candidate))
    scored.sort(key=lambda item: (-item[0], str(item[1].participant.get("name") or "").casefold()))
    return scored


# ---------------------------------------------------------------- Ganzes Blatt
FIELDS = ("place", "start_number", "name", "team", "grid", "time", "gap", "points")


def _row_decisions(row, columns: dict[str, dict], min_conf: float,
                   fmt: TimeFormat | None = None) -> dict[str, Decision]:
    return {name: decide(columns[name]["kind"], row.cells.get(name), row.strips.get(name), min_conf, fmt=fmt,
                         alt=row.alts.get(name))
            for name in FIELDS if name in columns}


def _check_places(rows: list[dict[str, Decision]]) -> None:
    """Plätze ohne Lücke, je Zeile eins mehr. Wo die Reihe beginnt, sagt die Mehrheit der gelesenen Plätze - ein
    verlesener erster Platz macht so nicht alle anderen gelb. Ausfälle (DNF, DNS, DSQ) haben keinen Platz und zählen
    nicht mit."""
    ranked = [row["place"] for row in rows if row.get("place") is not None and not _row_marks(row)]
    offsets = Counter(place.value - index for index, place in enumerate(ranked) if isinstance(place.value, int))
    start = max(offsets.items(), key=lambda item: (item[1], -abs(item[0] - 1)))[0] if offsets else 1
    for index, place in enumerate(ranked):
        # Die Reihenfolge stützt höchstens eine Lesung (nur ein Wert ist start + index) - die gilt, sonst gelb.
        _settle(place, "place", lambda value, expected=start + index: value == expected)
    # Passt genau eine Zeile nicht und laufen alle anderen lückenlos (mindestens zwei), ist ihr Platz klar. Grün nur
    # für Platz 1 in der ersten Zeile (der farbige Kasten, der nicht oder verlesen ankam, #1981); jede andere Lücke -
    # ein Platz ohne Lesung oder einer, den schon eine andere Zeile hat - wird nur vorbelegt und bleibt gelb: in
    # Turnierserien sind geteilte Plätze erlaubt (#1961), und vielleicht fehlt eine Zeile.
    off = [index for index, place in enumerate(ranked) if not place.sure]
    if len(off) == 1 and len(ranked) >= 3 and offsets:
        index = off[0]
        place = ranked[index]
        taken = place.value in {item.value for item in ranked if item is not place}
        if index == 0 and start == 1 and not _foreign(place, "place"):  # liest eine Lesung „DNF“, bleibt es gelb
            place.value, place.text, place.mark, place.sure = 1, "1", None, True
        elif place.value is None or taken:
            place.value, place.text, place.mark, place.sure = start + index, str(start + index), None, False


def _lapped(decision: Decision | None) -> str | None:
    """„+1 Runde(n)“ in Zeit oder Abstand - sonst ``None``."""
    if decision is None:
        return None
    value = decision.value
    if isinstance(value, tuple) and len(value) == 2 and value[1] is None and isinstance(value[0], str):
        return value[0]
    return value if isinstance(value, str) and value.startswith("+") else None


def _leader_time(rows: list[dict[str, Decision]]) -> tuple[float | None, bool]:
    """Zeit des Siegers: was die meisten Zeilen als Zeit minus Abstand ergeben (auf die Tausendstel) - so macht eine
    verlesene Siegerzeit nicht alle Abstände gelb. Ohne Mehrheit (mindestens zwei Zeilen) die erste gelesene Zeit.
    Liefert die Zeit und ob eine Mehrheit sie bestätigt."""
    first = None
    votes: Counter = Counter()
    for row in rows:
        time, gap = row.get("time"), row.get("gap")
        if not (time and isinstance(time.value, tuple)):
            continue
        if first is None:
            first = time.value[0]
        if gap and isinstance(gap.value, tuple) and gap.value[1] is not None:
            votes[round(time.value[0] - gap.value[1], 3)] += 1
    if votes:
        value, count = votes.most_common(1)[0]
        if count >= 2:
            return value, True
    return first, False


def _check_times(rows: list[dict[str, Decision]]) -> None:
    """Zeit = Zeit des Siegers + Abstand; ohne Abstand müssen Zeiten wenigstens steigen. Überrundete: steht „+1 Runde“
    in Zeit und Abstand gleich, oder ist die Zeit kleiner als die des Vordermanns, passt der Abstand „+N Runden“."""
    winner, voted = _leader_time(rows)
    leader = None
    previous = None
    for row in rows:
        time, gap = row.get("time"), row.get("gap")
        laps = _lapped(gap)
        if laps and _lapped(time) == laps:
            _confirm(time)
            _confirm(gap)
            continue
        seconds = time.value[0] if time and isinstance(time.value, tuple) else None
        if seconds is None:
            continue
        if laps and previous is not None and seconds + TIME_TOLERANCE < previous:
            _confirm(gap)
        if leader is None:
            leader = winner if winner is not None else seconds
            # Der Sieger: bestätigt, wenn genau eine seiner Lesungen zur Mehrheit passt; passt keine, ist er verlesen.
            if voted:
                _settle(time, "time", lambda value: abs(value[0] - leader) <= TIME_TOLERANCE)
            elif abs(seconds - leader) > TIME_TOLERANCE:
                time.sure = False
            previous = time.value[0] if isinstance(time.value, tuple) else seconds
            continue
        gap_seconds = gap.value[1] if gap and isinstance(gap.value, tuple) else None
        if gap_seconds is not None:
            # Zeit = Zeit des Siegers + Abstand. Widersprechen sich Lesungen (etwa 3/5), bestätigt die Probe nur ein
            # Paar, das als einziges passt - sonst bleiben Zeit und Abstand gelb. Liest eine Lesung etwas anderer Art
            # („DNF“, „+1 Runde“, ein Platzhalter), ist das ein Widerspruch, den die Probe nicht auflöst.
            pairs = [(one, two) for one in _options(time, "time") for two in _options(gap, "gap")
                     if two[1][1] is not None and abs(leader + two[1][1] - one[1][0]) <= TIME_TOLERANCE]
            other_kind = _foreign(time, "time") or _foreign(gap, "gap") or any(
                item[1][1] is None for item in _options(gap, "gap"))
            if len(pairs) == 1 and not other_kind:
                _take(time, pairs[0][0])
                _take(gap, pairs[0][1])
                time.sure = gap.sure = True
            else:
                time.sure = gap.sure = False
            seconds = time.value[0]
        if gap_seconds is not None and previous is not None and seconds + TIME_TOLERANCE < previous:
            time.sure = False
        previous = seconds


def _check_leader_gap(rows: list[dict[str, Decision]]) -> None:
    """Platz 1 hat keinen Abstand: dort steht ein Platzhalter („+--:--,---“), oft verlesen („deln“). Alles ohne gültigen
    Abstand ist darum „kein Abstand“ - sicher. Ein echter Abstand beim Ersten passt nicht - gelb."""
    for row in rows:
        place, gap = row.get("place"), row.get("gap")
        # Nur beim sicheren Platz 1 - ist er selbst gelb (etwa ein verlesener anderer Platz), bleibt der Abstand, wie
        # gelesen, und wird nicht still gelöscht.
        if not (place and gap is not None and place.value == 1 and place.sure and not _row_marks(row)):
            continue
        seconds = gap.value[1] if isinstance(gap.value, tuple) else None
        # Liest eine der Lesungen einen echten Abstand, widerspricht sie dem Platzhalter - gelb.
        real = [item for item in _options(gap, "gap") if item[1][1] is None or item[1][1] >= TIME_TOLERANCE]
        if not real and (gap.value is None or (seconds is not None and seconds < TIME_TOLERANCE)):
            gap.value, gap.text, gap.mark, gap.sure = None, "", None, True
        else:
            gap.sure = False


def _check_gaps_in_columns(rows: list[dict[str, Decision]]) -> None:
    """Startnummer, Team und Startplatz stehen in jeder Zeile: hat die Spalte in mindestens der Hälfte der Zeilen einen
    Wert, ist eine leere Zelle verdächtig (etwa dunkelgraue Schrift auf dunklem Grund) - gelb."""
    for name in ("start_number", "team", "grid"):
        cells = [row.get(name) for row in rows if row.get(name) is not None]
        filled = [cell for cell in cells if cell.raw]
        if not cells or len(filled) * 2 < len(rows):
            continue
        for cell in cells:
            if not cell.raw:
                cell.sure = False


def _grid_number(item) -> int | None:
    value = item[1] if isinstance(item, tuple) else item
    return int(value) if isinstance(value, str) and value.isdigit() else None


def _settle_grid(grids: list[Decision]) -> None:
    """Startplätze sind 1…N, jeder einmal (#2012). Fehlen den sicheren genau die Zahlen, die die unsicheren als je
    einzige passende Lesung haben (jede Zahl genau einmal), gelten diese - grün. Sonst bleibt alles, wie es ist."""
    sure = [_grid_number(cell.value) for cell in grids if cell.sure and cell.value is not None]
    unsure = [cell for cell in grids if not cell.sure]
    if not unsure or None in sure or len(set(sure)) != len(sure) or any(value > len(grids) for value in sure):
        return
    missing = set(range(1, len(grids) + 1)) - set(sure)
    picks = []
    for cell in unsure:
        fitting = [item for item in _options(cell, "number") if _grid_number(item) in missing]
        if len(fitting) != 1 or _foreign(cell, "number"):
            return
        picks.append(fitting[0])
    if len(picks) != len(missing) or {_grid_number(item) for item in picks} != missing:
        return
    for cell, item in zip(unsure, picks):
        _take(cell, item)
        cell.sure = True


def _check_grid(rows: list[dict[str, Decision]]) -> None:
    _settle_grid([row["grid"] for row in rows if row.get("grid") is not None])
    seen: dict[object, list[Decision]] = {}
    for row in rows:
        grid = row.get("grid")
        if grid and grid.value is not None:
            seen.setdefault(grid.value, []).append(grid)
    for items in seen.values():
        if len(items) > 1:
            for item in items:
                item.sure = False


def _row_marks(row: dict[str, Decision]) -> list[str]:
    marks = []
    for name in ("place", "time"):
        item = row.get(name)
        if item and item.mark and item.mark not in marks:
            marks.append(item.mark)
    return marks


def build(reading: Reading, template: dict, participants: list[dict], *, aliases: list[dict] | None = None,
          no_team_names: list[str] | None = None, track: list[dict] | None = None, teams: list[str] | None = None,
          track_teams: list[dict] | None = None, team_aliases: list[dict] | None = None) -> dict:
    """Die Antwort für die Oberfläche (siehe ``routes/reference_result_image_routes.py``). ``no_team_names``: Einträge
    „kein Team“ der Saison (#1960, etwa „Ersatzfahrer“) - sie bleiben im Team-Feld stehen.

    Kader der Spur (#2012): ``track`` sind Teilnehmer anderer Saisons derselben Spur (mit ``season``), ``teams`` die
    bekannten Teams dieser Saison (eigene Teams, Teams der Blätter - dazu kommen immer die Standard-Teams der
    Teilnehmer), ``track_teams`` Teams anderer Saisons (``{"team", "season"}``) und ``team_aliases`` gelernte
    Schreibweisen (``{"read", "team"}``)."""
    columns = {column["field"]: column for column in template["columns"]}
    min_conf = float(template.get("min_confidence", 80))
    name_match = float(template.get("name_match", 0.72))
    name_sure = float(template.get("name_sure", 0.9))
    margin = float(template.get("name_margin", 0.1))
    team_match = float(template.get("team_match", 0.6))
    fmt = time_format(template.get("time_format"))
    rows = [_row_decisions(row, columns, min_conf, fmt) for row in reading.rows]
    # Spalten, die nur mit ihrer Überschrift gelten (Punkte): ohne sie im Bild fallen sie weg - nie gelb, nie geraten.
    dropped = {name for name, column in columns.items() if column.get("needs_label") and reading.labelled is not None
               and name not in reading.labelled}
    for row in rows:
        for name in dropped:
            row.pop(name, None)
    # Ein Ausfall in „Pos“ bestätigt „DNF“ in „Zeit“ und umgekehrt.
    for row in rows:
        place, time = row.get("place"), row.get("time")
        if place and time and place.mark and place.mark == time.mark:
            _confirm(place)
            _confirm(time)
        # Ausfall: statt Zeit und Abstand stehen Platzhalter - auch verlesen (ohne Ziffern) sind sie leer, nicht gelb.
        if _row_marks(row):
            for key in ("time", "gap"):
                cell = row.get(key)
                if cell is not None and cell.value is None and not cell.mark and not any(
                        char.isdigit() for char in cell.raw):
                    cell.text, cell.sure = "", True
    _check_places(rows)
    _check_leader_gap(rows)
    _check_times(rows)
    _check_grid(rows)
    _check_gaps_in_columns(rows)

    pool = candidates(participants, aliases, track)
    known_teams = team_pool(participants, teams, track_teams, team_aliases)
    numbers = {str(row.get("start_number") or "").strip(): row.get("id") for row in participants
               if str(row.get("start_number") or "").strip()}
    chosen, lost = _match_people(reading, rows, pool, name_match, name_sure)

    out_rows = []
    for index, (row, match, raw) in enumerate(zip(rows, chosen, reading.rows)):
        out_rows.append(_row_out(index, row, match, known_teams, name_match, name_sure, team_match, raw=raw,
                                 lost=index in lost, no_team_names=no_team_names, margin=margin, numbers=numbers))
        out_rows[-1]["color"] = raw.color
    # Reichte das Zeitbudget nicht für die zweite Lesung einer Spalte, ist dort jede gelesene Zelle ungeprüft - gelb.
    for out, raw in zip(out_rows, reading.rows):
        unchecked = {name for name in reading.unchecked if name in FIELDS and name in raw.cells and name not in dropped}
        if unchecked - set(out["uncertain"]):
            out["uncertain"] = [name for name in FIELDS if name in out["uncertain"] or name in unchecked]
    header = _header_out(reading, pool, min_conf, name_match, name_sure, fmt, margin)
    uncertain_rows = sum(1 for row in out_rows if row["uncertain"])
    return {"rows": out_rows, **header, "uncertain_rows": uncertain_rows, "team_colors": team_colors(out_rows),
            "is_result": _looks_like_result(rows, template)}


def team_colors(rows: list[dict]) -> dict[str, str]:
    """Vorschlag für die Teamfarben (#1950): je Team die häufigste Schriftfarbe seiner Zeilen. Nur ein Vorschlag -
    gespeichert wird nichts."""
    seen: dict[str, Counter] = {}
    for row in rows:
        if row.get("team") and row.get("color"):
            seen.setdefault(row["team"], Counter())[row["color"]] += 1
    return {team: counts.most_common(1)[0][0] for team, counts in sorted(seen.items())}


def _looks_like_result(rows: list[dict[str, Decision]], template: dict) -> bool:
    """Ein Ergebnis hat in den Feldern ``template["needs"]`` (Rennliga: Zeit) in mindestens der Hälfte der Zeilen einen
    Wert - eine Zeit, „+1 Runde“ oder „DNF“. Saisontabellen und Kalender haben das nicht."""
    for field_name in template.get("needs") or []:
        filled = sum(1 for row in rows if row.get(field_name) is not None
                     and (row[field_name].mark or row[field_name].value not in (None, "")))
        if filled * 2 < len(rows):
            return False
    return True


def _match_people(reading: Reading, rows: list[dict[str, Decision]], pool: list[Candidate], name_match: float,
                  name_sure: float) -> tuple[list[dict | None], set[int]]:
    """Je Zeile der Teilnehmer (oder ``None``) mit Ähnlichkeit, ob die Startnummer passt und ob jede Lesung des Namens
    zu ihm passt (``agree``). Jeder höchstens einmal: die besser passende Zeile gewinnt - die Zeilen, die ihren
    Teilnehmer so verlieren, kommen als zweiter Wert zurück."""
    proposals = []
    for index, (row, raw) in enumerate(zip(rows, reading.rows)):
        texts = [read.text for read in (raw.cells.get("name"), raw.strips.get("name")) if read and read.text.strip()]
        numbers = set()
        for read, page in ((raw.cells.get("start_number"), True), (raw.strips.get("start_number"), False)):
            parsed = _parse("number", read, page=page) if read else None
            if parsed:
                numbers.add(parsed[1])
        best = None
        ranked = best_name(texts, pool)
        for score, candidate in ranked[:8]:
            own = str(candidate.participant.get("start_number") or "").strip()
            number_hit = bool(own) and own in numbers
            if score < name_match and not (number_hit and score >= 0.4):
                continue
            combined = score + (0.3 if number_hit else 0.0)
            if best is None or combined > best["combined"]:
                best = {"candidate": candidate, "score": score, "number_hit": number_hit, "combined": combined,
                        "index": index}
        if best:
            # Seite und Streifen müssen beide auf diesen Teilnehmer zeigen - liest eine „Max Muster“ und die andere
            # „Tim Kunz“, ist der Name nicht sicher, auch wenn eine Lesung genau passt.
            names = [name for name in best["candidate"].names if name]
            best["agree"] = all(max((similarity(text, name) for name in names), default=0.0) >= name_match
                                for text in texts)
            best["texts"] = texts
            # Eindeutig nur mit Abstand zum Zweitbesten (#2012) - auch einem aus einer anderen Saison der Spur.
            best["second"] = max((score for score, candidate in ranked if candidate is not best["candidate"]),
                                 default=0.0)
        proposals.append(best)
    taken: dict[str, dict] = {}
    lost: set[int] = set()
    for proposal in sorted((item for item in proposals if item), key=lambda item: -item["combined"]):
        pid = proposal["candidate"].participant["id"]
        if pid in taken:
            proposals[proposal["index"]] = None
            lost.add(proposal["index"])
        else:
            taken[pid] = proposal
    return proposals, lost


def _reads_text(texts: list[str]) -> str:
    """Was im Bild stand - bei zwei verschiedenen Lesungen beide („Max Muster / Tim Kunz“)."""
    seen: list[str] = []
    for text in texts:
        cleaned = clean_text(text)
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return " / ".join(seen)


@dataclass
class TeamPool:
    """Bekannte Teams (#2012): je Team seine Schreibweisen (der Name, gelernte aus Bildern); ``seasons`` nennt die
    Teams, die nur eine andere Saison der Spur kennt, mit deren Bezeichnung."""
    spellings: dict[str, list[str]] = field(default_factory=dict)
    seasons: dict[str, str] = field(default_factory=dict)


def team_pool(participants: list[dict], teams: list[str] | None = None, track_teams: list[dict] | None = None,
              team_aliases: list[dict] | None = None) -> TeamPool:
    """Die bekannten Teams: die dieser Saison (Standard-Teams der Teilnehmer und ``teams``), dann die anderer Saisons
    der Spur, die es hier nicht gibt. Gelernte Schreibweisen hängen am Team, auf das sie zeigen."""
    pool = TeamPool()
    keys: dict[str, str] = {}

    def add(team, season: str | None) -> None:
        name = " ".join(str(team or "").split())
        key = series_identity.normalize_name(name)
        if not key or key in keys:
            return
        keys[key] = name
        pool.spellings[name] = [name]
        if season is not None:
            pool.seasons[name] = season

    for team in sorted({str(row.get("default_team")) for row in participants if row.get("default_team")}):
        add(team, None)
    for team in teams or []:
        add(team, None)
    for item in track_teams or []:
        add(item.get("team"), str(item.get("season") or ""))
    for alias in team_aliases or []:
        target = keys.get(series_identity.normalize_name(alias.get("team")))
        if target and alias.get("read"):
            pool.spellings[target].append(alias["read"])
    return pool


def _rank_teams(text: str, pool: TeamPool, own: str | None) -> list[tuple[float, str]]:
    """Alle bekannten Teams mit ihrer besten Ähnlichkeit zu ``text``, das ähnlichste zuerst - bei Gleichstand das des
    Teilnehmers (``own``), dann in der Reihenfolge des Pools."""
    order = sorted(pool.spellings, key=lambda team: team != own)
    scored = [(max(similarity(text, spelling) for spelling in pool.spellings[team]), team) for team in order]
    return sorted(scored, key=lambda item: -item[0])


def _all_reads_say(texts: list[str], pool: TeamPool, team: str, threshold: float, own: str | None) -> bool:
    """Zeigt jede Lesung (Seite, Streifen) auf dasselbe bekannte Team, jeweils ab ``threshold``?"""
    for text in texts:
        ranked = _rank_teams(text, pool, own)
        if not ranked or ranked[0][1] != team or ranked[0][0] < threshold:
            return False
    return True


def _team_out(decision: Decision | None, match: dict | None, pool: TeamPool, team_match: float,
              name_sure: float, texts: list[str] | None = None, no_team_names: list[str] | None = None,
              margin: float = 0.1) -> tuple[str | None, bool, str | None]:
    """Das Team: ein bekanntes (zuerst das des Teilnehmers) ab ``team_match`` - gelb unter ``name_sure``, ohne klaren
    Abstand zum Zweitbesten, wenn die Lesungen (``texts``: Seite, Streifen) auf verschiedene Teams zeigen oder wenn
    nur eine andere Saison der Spur das Team kennt (dann mit Hinweis) -, sonst wie gelesen und gelb (#2012: ein
    unbekanntes Team ist nie grün). Teams sind wenige und bekannt, darum reicht weniger Ähnlichkeit als bei Namen. Ein
    Eintrag „kein Team“ (#1960, ``no_team_names``, etwa „Ersatzfahrer“) bleibt, wie er dasteht - er wird nie aufs
    Stammteam oder ein ähnliches Team „korrigiert“. Liefert (Team, sicher, Hinweis)."""
    if decision is None or not decision.text:
        return None, True, None
    read = decision.text
    no_team = next((name for name in no_team_names or () if similarity(read, name) >= name_sure), None)
    if no_team:
        return no_team, decision.sure, None
    candidate = match["candidate"] if match else None
    own = candidate.participant.get("default_team") if candidate and not candidate.foreign else None
    ranked = _rank_teams(read, pool, own)
    if ranked:
        score, team = ranked[0]
        second = ranked[1][0] if len(ranked) > 1 else 0.0
        hint = f"wie in Saison {pool.seasons[team]}" if team in pool.seasons else None
        if score >= name_sure:
            sure = (team not in pool.seasons and score - second >= margin
                    and _all_reads_say(texts or [read], pool, team, name_sure, own))
            return team, sure, hint
        if score >= team_match:
            return team, False, hint
    return read, False, None


def _row_out(index: int, row: dict[str, Decision], match: dict | None, teams: TeamPool, name_match: float,
             name_sure: float, team_match: float, *, raw: RowReading | None = None, lost: bool = False,
             no_team_names: list[str] | None = None, margin: float = 0.1,
             numbers: dict[str, str] | None = None) -> dict:
    uncertain: list[str] = []
    read: dict[str, str] = {}
    hint: dict[str, str] = {}

    def flag(name: str, decision: Decision | None, value_text: str | None) -> None:
        if decision is None:
            return
        if not decision.sure:
            uncertain.append(name)
        if decision.raw and clean_text(decision.raw) != (value_text or ""):
            read[name] = clean_text(decision.raw)

    place = row.get("place")
    marks = _row_marks(row)
    out = {"index": index, "place": None, "dnf": "dnf" in marks, "marks": marks, "start_number": None, "name": "",
           "participant_id": None, "team": None, "grid": None, "time": None, "gap": None, "points": None}
    if place:
        out["place"] = place.value if isinstance(place.value, int) and not place.mark else None
        flag("place", place, place.text)

    number = row.get("start_number")
    name = row.get("name")
    candidate = match["candidate"] if match else None
    if candidate and not candidate.foreign:
        person = candidate.participant
        out["participant_id"] = person["id"]
        out["name"] = person.get("name") or ""
        own_number = str(person.get("start_number") or "").strip()
        # Eindeutig (#2012): sehr ähnlich und klar vor dem Zweitbesten - oder ähnlich und die Startnummer passt.
        name_ok = ((match["score"] >= name_sure and match["score"] - match.get("second", 0.0) >= margin)
                   or (match["score"] >= name_match and match["number_hit"]))
        if name and not (name_ok and match.get("agree", True)):
            uncertain.append("name")
        if name and not match.get("agree", True):
            read["name"] = _reads_text(match.get("texts") or [name.raw])
        elif name and name.raw and clean_text(name.raw) != out["name"]:
            read["name"] = clean_text(name.raw)
        if own_number:
            # Die Startnummer des Teilnehmers gilt. Gelb nur, wenn im Bild eine andere stand - ohne gelesene Nummer
            # kommt sie aus der Saison, nicht aus dem Bild. Steht dort sicher eine Nummer, die keinem anderen gehört,
            # hat er gewechselt: die aus dem Bild, mit der bisherigen als Hinweis (#2012).
            out["start_number"] = own_number
            if number and number.raw and not match["number_hit"]:
                uncertain.append("start_number")
                owner = (numbers or {}).get(number.text)
                if number.sure and number.text and owner in (None, person["id"]):
                    out["start_number"] = number.text
                    hint["start_number"] = f"bisher {own_number}"
            if number and number.raw and clean_text(number.raw) != out["start_number"]:
                read["start_number"] = clean_text(number.raw)
        elif number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])
    elif candidate:
        # Nur aus einer anderen Saison der Spur (#2012): deren Name als Vorschlag, ohne Kennung - immer gelb.
        out["name"] = candidate.participant.get("name") or ""
        uncertain.append("name")
        hint["name"] = f"wie in Saison {candidate.season}"
        if name and not match.get("agree", True):
            read["name"] = _reads_text(match.get("texts") or [name.raw])
        elif name and name.raw and clean_text(name.raw) != out["name"]:
            read["name"] = clean_text(name.raw)
        if number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])
    else:
        if name:
            out["name"] = name.text
            flag("name", name, out["name"])
            if out["name"] and "name" not in uncertain:
                # Unbekannt (#2012) - oder er passte zu einem Teilnehmer, den eine andere Zeile besser trifft (doppelt
                # oder verlesen): nie grün, wie sicher die Erkennung auch ist.
                uncertain.append("name")
                if lost:
                    read.setdefault("name", clean_text(name.raw))
        else:
            uncertain.append("name")
        if number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])

    team_texts = [read_.text for read_ in ((raw.cells.get("team"), raw.strips.get("team")) if raw else ())
                  if read_ and read_.text.strip()]
    team, team_sure, team_hint = _team_out(row.get("team"), match, teams, team_match, name_sure, team_texts,
                                           no_team_names, margin)
    if team_hint:
        hint["team"] = team_hint
    team_cell = row.get("team")
    if team_cell is not None and not team_cell.raw and not team_cell.sure:
        # Leere Zelle in einer Spalte, die sonst Teams hat (#1960): gelb, aber leer - kein Stammteam vorschlagen. Oft
        # steht dort ein farbiges Schild wie „Ersatzfahrer“, das beim Lesen wegfällt; das Stammteam wäre dann falsch.
        team = None
        team_sure = False
    out["team"] = team
    if team_cell is not None:
        if not team_sure:
            uncertain.append("team")
        raw_team = _reads_text(team_texts) if len(team_texts) > 1 and not team_sure else clean_text(row["team"].raw)
        if raw_team and raw_team != team:
            read["team"] = raw_team

    for key in ("grid", "time", "gap", "points"):
        decision = row.get(key)
        if decision is None:
            continue
        if key in ("grid", "points"):
            value = decision.value if isinstance(decision.value, str) and decision.value.isdigit() else None
            out[key] = int(value) if value else None
        elif decision.mark:
            out[key] = None
        else:
            out[key] = decision.text or None
        flag(key, decision, decision.text)
    out["uncertain"] = [name for name in FIELDS if name in uncertain]
    # Die Antwort bleibt klein und passt ins Blatt (Name und Team höchstens 120 Zeichen, Startnummer 10).
    for key, limit in FIELD_LIMITS.items():
        if isinstance(out[key], str):
            out[key] = out[key][:limit].strip() or ("" if key == "name" else None)
    out["read"] = {key: value[:TEXT_LIMIT] for key, value in read.items()}
    out["hint"] = hint
    # Was im Bild stand (#2012): ändert der Vorstand Name oder Team, lernt das Blatt diese Schreibweise beim Übernehmen.
    image = {key: clean_text(row[key].raw)[:TEXT_LIMIT] for key in ("name", "team")
             if row.get(key) is not None and clean_text(row[key].raw)}
    out["image"] = image
    return out


def _person(text: str, pool: list[Candidate], name_match: float, name_sure: float,
            margin: float = 0.1) -> tuple[str, str | None, bool]:
    """Ein Name aus dem Kopf: Teilnehmer (Name, Kennung, sicher?) oder der gelesene Text. Sicher nur eindeutig und nur
    ein Teilnehmer dieser Saison (#2012); einer aus einer anderen Saison der Spur wird nur vorgeschlagen."""
    scored = best_name([text], pool)
    if scored and scored[0][0] >= name_match:
        score, candidate = scored[0]
        second = scored[1][0] if len(scored) > 1 else 0.0
        if candidate.foreign:
            return candidate.participant.get("name") or "", None, False
        return (candidate.participant.get("name") or "", candidate.participant["id"],
                score >= name_sure and score - second >= margin)
    return clean_text(text), None, False


def _header_out(reading: Reading, pool: list[Candidate], min_conf: float, name_match: float,
                name_sure: float, fmt: TimeFormat | None = None, margin: float = 0.1) -> dict:
    out: dict = {"track": None, "session": None, "fastest_lap": None, "pole": None, "driver_of_the_day": None}
    track = reading.header.get("track")
    if track and clean_text(track.text):
        out["track"] = {"name": clean_text(track.text)[:TEXT_LIMIT],
                        "uncertain": [] if track.conf >= min_conf else ["name"]}
    session = reading.header.get("session")
    if session and clean_text(session.text):
        # Nur ein Hinweis, bis es Läufe je Termin gibt (#1930): Rennen, Sprint oder Qualifying.
        name = clean_text(session.text)[:40]
        key = series_identity.normalize_name(name)
        kind = "qualifying" if key.startswith("quali") else "sprint" if key.startswith("sprint") else "race"
        out["session"] = {"name": name, "kind": kind}
    for key in ("fastest_lap", "pole"):
        lap = reading.header.get(key)
        if not lap or not lap.text.strip():
            continue
        name_words, time_text, exact = _split_lap(clean_text(lap.text).split(), fmt)
        name, pid, sure = _person(" ".join(name_words), pool, name_match, name_sure, margin)
        uncertain = [] if sure else ["name"]  # ein unbekannter Name ist nie grün (#2012)
        if not exact or not _time_word_sure(lap, min_conf, fmt):
            uncertain.append("time")
        out[key] = {"name": name[:TEXT_LIMIT], "participant_id": pid, "time": time_text, "uncertain": uncertain,
                    "read": clean_text(lap.text)[:TEXT_LIMIT]}
    dotd = reading.header.get("driver_of_the_day")
    if dotd and dotd.text.strip():
        name, pid, sure = _person(dotd.text, pool, name_match, name_sure, margin)
        uncertain = [] if sure else ["name"]
        out["driver_of_the_day"] = {"name": name[:TEXT_LIMIT], "participant_id": pid, "uncertain": uncertain,
                                    "read": clean_text(dotd.text)[:TEXT_LIMIT]}
    return out


def _split_lap(words: list[str], fmt: TimeFormat | None = None) -> tuple[list[str], str | None, bool]:
    """Name und Zeit aus „Name 1:31.207“: die Zeit sind die letzten Wörter, die als Zeit taugen. Ein letztes Wort aus
    Ziffern gehört nie zum Namen - ist es verlesen („131.207“), wird die Zeit geraten (``exact`` falsch). Mit ``fmt``
    setzt die Form die Trennzeichen - dann ist auch „131.207“ eine Zeit."""
    for cut in range(len(words) - 1, max(-1, len(words) - 4), -1):
        joined = "".join(words[cut:])
        parsed = parse_clock(joined, fmt, fix=True) if fmt else parse_time(joined, fix=True)
        if parsed:
            return words[:cut], parsed[1], True
    if words and sum(char.isdigit() for char in words[-1]) >= max(2, len(words[-1]) * 0.6):
        tail = compact(words[-1]).translate(DIGIT_FIX)
        clock, _, fraction = tail.partition(".")
        guess = parse_time(f"{clock[:-2]}:{clock[-2:]}.{fraction}") if len(clock) >= 3 and clock.isdigit() else None
        return words[:-1], guess[1] if guess else None, False
    return words, None, False


def _time_word_sure(read: Read, min_conf: float, fmt: TimeFormat | None = None) -> bool:
    return any(conf >= min_conf and (parse_clock(text, fmt, fix=True) if fmt else parse_time(text, fix=True))
               for text, conf in read.parts)
