"""Gemeinsame Helfer für Mails: Zustellbarkeit (Text-Fassung, Message-ID) und wie Werte in eine Mail kommen.

Werte in Mails (Namen, Teamnamen, Turniertitel, freie Texte) erscheinen immer als Text, nie als Formatierung:
- im HTML wird jeder Wert geschützt eingesetzt (`html_value`) - spitze Klammern, & und Anführungszeichen bleiben
  sichtbare Zeichen. Nur HTML, das unser eigener Code baut, kommt als `SafeHtml` unverändert durch.
- im Betreff und in Kopfzeilen steht jeder Wert als eine Zeile reiner Text (`header_text`), ohne HTML-Schutz.
- die Text-Fassung (`html_to_text`) zeigt Werte so, wie sie eingegeben wurden - ohne &lt; und ohne dass Zeichen
  aus einem Wert dort zu Umbrüchen oder Aufzählungen werden.
"""
import html as html_lib
import re
from email.utils import parseaddr

# {{name}} in Vorlagen (Admin-Vorlagen und Ersatztexte im Code).
_PLACEHOLDER = re.compile(r"\{\{([A-Za-z0-9_]+)\}\}")


class SafeHtml(str):
    """HTML, das unser eigener Code gebaut hat (Knopf, Link-Block, Liste aus schon geschützten Einträgen).
    Das ist die einzige Art, wie ein Wert unverändert als HTML in eine Mail kommt - alles andere wird Text."""

    __slots__ = ()


def html_value(value) -> SafeHtml:
    """Ein Wert für das Mail-HTML: immer als Text eingesetzt - außer er ist ausdrücklich `SafeHtml`.
    Das Ergebnis ist selbst `SafeHtml`, ein zweiter Aufruf schützt also nicht doppelt."""
    if isinstance(value, SafeHtml):
        return value
    return SafeHtml(html_lib.escape("" if value is None else str(value), quote=True))


def header_text(value) -> str:
    """Ein Wert für Betreff und Kopfzeilen: reiner Text in einer Zeile. Zeilenumbrüche werden zu Leerzeichen -
    ein Wert kann so keine weitere Kopfzeile anhängen. Kein HTML-Schutz: der Betreff ist kein HTML."""
    if value is None:
        return ""
    text = html_to_text(value) if isinstance(value, SafeHtml) else str(value)
    return " ".join(text.splitlines())


def fill_placeholders(text: str, values: dict, *, as_html: bool) -> str:
    """Setzt `{{name}}` in einen Vorlagentext ein - in einem Durchgang, damit ein Wert keinen weiteren Platzhalter
    nachziehen kann. HTML: jeder Wert als Text (`html_value`). Betreff: jeder Wert einzeilig (`header_text`).
    Der Vorlagentext selbst (vom Admin gepflegt oder im Code geschrieben) bleibt, wie er ist."""
    convert = html_value if as_html else header_text

    def replace(match: re.Match) -> str:
        key = match.group(1)
        return convert(values[key]) if key in values else match.group(0)

    return _PLACEHOLDER.sub(replace, text or "")


# Tag-Anfänge und Schließer sind feste Wörter: die Suche danach läuft ohne Rückverfolgung.
_BLOCK_TAGS = {
    name: (re.compile(rf"(?i)<{name}"), re.compile(rf"(?i)</{name}>")) for name in ("script", "style")
}
_LI_OPEN = re.compile(r"(?i)<li")
_TAG_OPEN = re.compile("<")


def _strip_blocks(text: str) -> str:
    """Entfernt `<script …>…</script>` und `<style …>…</style>` - linear in der Länge.

    Gleiches Ergebnis wie `re.sub(r"(?is)<(script|style).*?>.*?</\\1>", "", text)`: vom Öffner bis zum ersten `>`,
    dann bis zum ersten passenden Schließer dahinter. Fehlt das `>` oder der Schließer, findet sich auch ab einer
    späteren Stelle keiner mehr - der Name wird dann nicht weiter gesucht."""
    # Name -> nächster Öffner ab `pos` (None: ab hier kein Treffer mehr möglich).
    upcoming = {name: opener.search(text) for name, (opener, _) in _BLOCK_TAGS.items()}
    parts = []
    pos = 0
    while True:
        for name, match in upcoming.items():
            if match is not None and match.start() < pos:
                upcoming[name] = _BLOCK_TAGS[name][0].search(text, pos)
        candidates = [(match.start(), name, match) for name, match in upcoming.items() if match is not None]
        if not candidates:
            break
        start, name, match = min(candidates)
        gt = text.find(">", match.end())
        if gt < 0:
            break
        close = _BLOCK_TAGS[name][1].search(text, gt + 1)
        if close is None:
            upcoming[name] = None
            continue
        parts.append(text[pos:start])
        pos = close.end()
    parts.append(text[pos:])
    return "".join(parts)


def _replace_tags(text: str, opener: re.Pattern, replacement: str, *, min_inner: int) -> str:
    """Ersetzt jeden Tag vom Öffner bis zum ersten `>` - linear in der Länge.

    Gleiches Ergebnis wie `re.sub(öffner + r"[^>]*>", …)` (min_inner=0) bzw. `re.sub(öffner + r"[^>]+>", …)`
    (min_inner=1). Fehlt ab einer Stelle das `>`, gibt es dahinter keinen Tag mehr."""
    parts = []
    pos = 0
    search_from = 0
    while (match := opener.search(text, search_from)) is not None:
        gt = text.find(">", match.end())
        if gt < 0:
            break
        if gt - match.end() < min_inner:
            search_from = match.start() + 1
            continue
        parts.append(text[pos:match.start()])
        parts.append(replacement)
        pos = search_from = gt + 1
    parts.append(text[pos:])
    return "".join(parts)


def html_to_text(markup: str) -> str:
    """Create a readable plain-text alternative from our transactional HTML."""
    if not markup:
        return ""

    text = _strip_blocks(markup)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = _replace_tags(text, _LI_OPEN, "- ", min_inner=0)
    text = re.sub(r"(?i)</(p|div|tr|h[1-6]|li)>", "\n", text)
    text = _replace_tags(text, _TAG_OPEN, "", min_inner=1)
    text = html_lib.unescape(text)

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    collapsed = []
    previous_blank = False
    for line in lines:
        if not line:
            if collapsed and not previous_blank:
                collapsed.append("")
            previous_blank = True
            continue
        collapsed.append(line)
        previous_blank = False

    return "\n".join(collapsed).strip()


def mailbox_domain(address: str, fallback: str = "lionsquad.at") -> str:
    """Extract the domain part from a mailbox for Message-ID generation."""
    _, parsed = parseaddr(address or "")
    if "@" not in parsed:
        return fallback
    domain = parsed.rsplit("@", 1)[1].strip().strip(">").lower()
    return domain or fallback
