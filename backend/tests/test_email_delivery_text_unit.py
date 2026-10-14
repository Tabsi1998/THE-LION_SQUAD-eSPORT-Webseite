"""Text-Fassung der Mails (`html_to_text`): gleiche Ergebnisse wie bisher, Laufzeit linear in der Länge."""
import random
import re
import time

import pytest

from services.email_delivery import html_to_text


def _reference(markup: str) -> str:
    """Die bisherige Umsetzung mit regulären Ausdrücken - als Vergleich für kurze Eingaben."""
    import html as html_lib

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


@pytest.mark.parametrize("markup, expected", [
    ("", ""),
    ("<p>Hallo <b>Lena</b></p><p>Bis bald</p>", "Hallo Lena\nBis bald"),
    ("<style>p { color: red; }</style><p>Text</p>", "Text"),
    ("<STYLE type='text/css'>x</Style><script>var a = 1;</SCRIPT>sichtbar", "sichtbar"),
    ("Zeile<br>zwei<BR/>drei<br />vier", "Zeile\nzwei\ndrei\nvier"),
    ("<ul><li>eins</li><LI class='x'>zwei</li></ul>", "- eins\n- zwei"),
    ("a &lt;b&gt; &amp; c", "a <b> & c"),
    ("<>bleibt", "<>bleibt"),
    ("offen <b ohne Ende", "offen <b ohne Ende"),
    ("<style>ohne Schluss <p>Text</p>", "ohne Schluss Text"),
])
def test_known_cases(markup, expected):
    assert html_to_text(markup) == expected
    assert _reference(markup) == expected


def test_same_result_as_before_for_many_mixed_inputs():
    pieces = [
        "<", ">", "/", "<li", "<LI", "</li>", "<p>", "</p>", "<br>", "<br/>", "<script", "</script>", "<style",
        "</STYLE>", "<Style>", "<div>", "</div>", "<h2>", "</h2>", "&amp;", "&lt;", "a", "B", " ", "\n", "\t", "x>",
        "<b>", "<>", "ſ", "K",
    ]
    rng = random.Random(1505)
    for _ in range(4000):
        markup = "".join(rng.choice(pieces) for _ in range(rng.randint(0, 24)))
        assert html_to_text(markup) == _reference(markup), repr(markup)


@pytest.mark.parametrize("unit", ["<", "<li", "<style", "<style>", "<script>", "<p", "<br "])
def test_long_input_ends_quickly(unit):
    markup = unit * 50_000
    started = time.perf_counter()
    html_to_text(markup)
    assert time.perf_counter() - started < 0.5
