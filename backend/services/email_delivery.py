"""Shared helpers for email deliverability."""
import html as html_lib
import re
from email.utils import parseaddr


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
