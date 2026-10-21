"""Land eines Termins externer Serien (#1925): die Flagge je Rennen, wie sie Veranstalter-Grafiken zeigen.

- **Erkennen** (``detect_country``): zuerst aus Ort bzw. Strecke - deutsche und englische Ländernamen, bekannte
  Strecken- und Städtenamen und Klammerzusätze („USA (Miami)“). Nur ohne Treffer dort aus dem Titel, und im Titel nur
  Länder und Strecken: bloße Städte und Wörter, die auch Namen sind (``VENUE_ONLY``: „Austin Powers …“), zählen dort
  nicht.
  Verglichen wird ohne Akzente, ohne Groß- und Kleinschreibung und nur mit ganzen Wörtern („Spa“ ist nicht „Spanien“).
  Kein Treffer bleibt leer.
- **Liste:** ``COUNTRIES`` ist die Auswahl im Termin; die Website hat dieselbe Liste mit den deutschen Namen
  (``frontend/src/lib/countries.json``) und zu jedem Land eine Flagge (``frontend/public/assets/flags``). Ein Test
  hält beide gleich.
- Ohne regulären Ausdruck über die Eingabe: der Text wird Zeichen für Zeichen zu Wörtern, gesucht wird mit Leerzeichen
  als Wortgrenze.
"""
from __future__ import annotations

import unicodedata

# ISO 3166-1 alpha-2 → (deutscher Name, weitere Schreibweisen: englisch, Landessprache, Strecken und Städte).
COUNTRIES: dict[str, tuple[str, tuple[str, ...]]] = {
    "AE": ("Vereinigte Arabische Emirate", ("VAE", "UAE", "United Arab Emirates", "Emirate", "Abu Dhabi",
                                            "Yas Marina", "Yas Island", "Dubai")),
    "AR": ("Argentinien", ("Argentina", "Buenos Aires", "Termas de Rio Hondo")),
    "AT": ("Österreich", ("Oesterreich", "Austria", "Spielberg", "Red Bull Ring", "Salzburgring")),
    "AU": ("Australien", ("Australia", "Melbourne", "Albert Park", "Bathurst", "Mount Panorama", "Phillip Island",
                          "Adelaide")),
    "AZ": ("Aserbaidschan", ("Azerbaijan", "Baku", "Baku City Circuit")),
    "BE": ("Belgien", ("Belgium", "Belgique", "Spa", "Spa-Francorchamps", "Francorchamps", "Zolder")),
    "BH": ("Bahrain", ("Sakhir", "Bahrein")),
    "BR": ("Brasilien", ("Brazil", "Brasil", "Interlagos", "Sao Paulo", "Jose Carlos Pace")),
    "CA": ("Kanada", ("Canada", "Montreal", "Gilles Villeneuve", "Mosport")),
    "CH": ("Schweiz", ("Switzerland", "Suisse", "Svizzera")),
    "CN": ("China", ("Shanghai", "Zhuhai")),
    "CZ": ("Tschechien", ("Czechia", "Czech Republic", "Brno", "Brünn")),
    "DE": ("Deutschland", ("Germany", "Nürburgring", "Nurburgring", "Nordschleife", "Hockenheim",
                           "Hockenheimring", "Sachsenring", "Lausitzring", "Norisring", "Oschersleben")),
    "ES": ("Spanien", ("Spain", "Espana", "Barcelona", "Catalunya", "Montmelo", "Madrid", "Madring", "Valencia",
                       "Jerez", "Aragon", "Motorland")),
    "FI": ("Finnland", ("Finland", "Suomi", "KymiRing")),
    "FR": ("Frankreich", ("France", "Paul Ricard", "Le Castellet", "Le Mans", "Magny-Cours")),
    "GB": ("Großbritannien", ("Grossbritannien", "Great Britain", "United Kingdom", "UK", "England", "Britain",
                              "Silverstone", "Brands Hatch", "Donington", "Donington Park", "Snetterton",
                              "Oulton Park")),
    "HU": ("Ungarn", ("Hungary", "Hungaroring", "Budapest", "Magyarorszag")),
    "ID": ("Indonesien", ("Indonesia", "Mandalika")),
    "IN": ("Indien", ("India", "Buddh")),
    "IT": ("Italien", ("Italy", "Italia", "Monza", "Imola", "Emilia-Romagna", "Mugello", "Misano", "Vallelunga")),
    "JP": ("Japan", ("Suzuka", "Fuji", "Fuji Speedway", "Motegi")),
    "KR": ("Südkorea", ("Korea", "South Korea", "Yeongam")),
    "MA": ("Marokko", ("Morocco", "Marrakesch", "Marrakech")),
    "MC": ("Monaco", ("Monte Carlo", "Monte-Carlo")),
    "MX": ("Mexiko", ("Mexico", "Mexico City", "Mexiko-Stadt", "Hermanos Rodriguez")),
    "MY": ("Malaysia", ("Sepang",)),
    "NL": ("Niederlande", ("Netherlands", "Nederland", "Holland", "Zandvoort", "Assen")),
    "NZ": ("Neuseeland", ("New Zealand", "Hampton Downs", "Taupo")),
    "PL": ("Polen", ("Poland", "Polska", "Poznan")),
    "PT": ("Portugal", ("Portimao", "Algarve", "Estoril")),
    "QA": ("Katar", ("Qatar", "Lusail", "Losail")),
    "RU": ("Russland", ("Russia", "Sochi", "Sotschi")),
    "SA": ("Saudi-Arabien", ("Saudi Arabia", "Saudi", "Jeddah", "Dschidda", "Jeddah Corniche")),
    "SE": ("Schweden", ("Sweden", "Sverige", "Anderstorp")),
    "SG": ("Singapur", ("Singapore", "Marina Bay")),
    "TH": ("Thailand", ("Buriram",)),
    "TR": ("Türkei", ("Tuerkei", "Turkey", "Turkiye", "Istanbul", "Istanbul Park")),
    "US": ("USA", ("Vereinigte Staaten", "United States", "Amerika", "America", "Americas", "COTA", "Austin",
                   "Miami", "Las Vegas", "Indianapolis", "Indy", "Daytona", "Sebring", "Laguna Seca",
                   "Watkins Glen", "Road Atlanta", "Road America", "Long Beach")),
    "VN": ("Vietnam", ("Hanoi",)),
    "ZA": ("Südafrika", ("South Africa", "Kyalami")),
}


def _words(value) -> str:
    """Text als Wörter: Unicode zerlegt, ohne Akzente, klein, alles außer Buchstaben und Ziffern wird zur Wortgrenze."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char)).casefold()
    return " ".join("".join(char if char.isalnum() else " " for char in text).split())


# Jede Schreibweise (auch der deutsche Name) als Wörter - die längste zuerst, damit „Mexico City“ vor „Mexico“ zählt.
_ALIASES: tuple[tuple[str, str], ...] = tuple(sorted(
    {(_words(alias), code) for code, (name, aliases) in COUNTRIES.items() for alias in (name, *aliases)
     if _words(alias)},
    key=lambda item: (-len(item[0]), item[0])))

# Nur im Ort bzw. in der Strecke: bloße Städte und mehrdeutige Wörter, die auch Vor- oder Nachnamen sind („Austin
# Powers …“, „Spielberg“, „Holland“, „Monaco“). Eindeutige Streckennamen gehören nicht hierher, auch wenn sie nach
# Personen heißen („Gilles Villeneuve“, „Hermanos Rodriguez“, „Paul Ricard“) - im Titel zählen Länder und Strecken.
VENUE_ONLY = frozenset(_words(alias) for alias in (
    "Abu Dhabi", "Dubai", "Buenos Aires", "Spielberg", "Melbourne", "Adelaide", "Bathurst", "Baku", "Spa",
    "Sao Paulo", "Montreal", "Shanghai", "Zhuhai", "Brno", "Brünn", "Barcelona", "Madrid", "Valencia", "Jerez",
    "Budapest", "India", "Fuji", "Marrakesch", "Marrakech", "Monaco", "Monte Carlo", "Monte-Carlo", "Mexico City",
    "Mexiko-Stadt", "Holland", "Poznan", "Sochi",
    "Sotschi", "Jeddah", "Dschidda", "Istanbul", "Austin", "Miami", "Las Vegas", "Indianapolis", "Indy", "Long Beach",
    "Daytona", "Hanoi",
))
_TITLE_ALIASES = tuple(item for item in _ALIASES if item[0] not in VENUE_ONLY)


def _find(text: str, aliases=_ALIASES) -> str | None:
    """Das Land der frühesten Fundstelle im Text (bei gleicher Stelle die längste Schreibweise)."""
    words = _words(text)
    if not words:
        return None
    padded = f" {words} "
    best: tuple[int, int, str] | None = None
    for alias, code in aliases:
        at = padded.find(f" {alias} ")
        if at >= 0 and (best is None or (at, -len(alias)) < best[:2]):
            best = (at, -len(alias), code)
    return best[2] if best else None


def detect_country(venue=None, title=None) -> str | None:
    """Land (ISO-Code) aus Ort bzw. Strecke - mit allen Schreibweisen; nur ohne Treffer aus dem Titel, dort nur Länder
    und Strecken (``VENUE_ONLY`` zählt nicht). ``None`` ohne Treffer."""
    return _find(venue) or _find(title, _TITLE_ALIASES)


def clean_code(value) -> str | None:
    """Ein Code aus der Auswahl (groß geschrieben) oder ``None`` für leer; ein unbekannter Code ist ein Fehler."""
    code = str(value or "").strip().upper()
    if not code:
        return None
    if code not in COUNTRIES:
        raise ValueError("Unbekanntes Land.")
    return code


def country_name(code) -> str | None:
    found = COUNTRIES.get(str(code or "").upper())
    return found[0] if found else None
