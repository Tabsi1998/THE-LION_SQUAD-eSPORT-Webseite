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


def html_to_text(markup: str) -> str:
    """Create a readable plain-text alternative from our transactional HTML."""
    if not markup:
        return ""

    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", markup)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "- ", text)
    text = re.sub(r"(?i)</(p|div|tr|h[1-6]|li)>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
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
