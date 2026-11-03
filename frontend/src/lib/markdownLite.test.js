import { escapeBlockText, renderMarkdownLite } from "./markdownLite";

// Wie der Server ausliefert (services/markdown_text.served): Backslash im freien Text verdoppelt, Bausteinwerte mit Backslash-Escapes.
const served = (free) => free.replace(/\\/g, "\\\\");
const hasProtection = (html) => [...html].some((char) => char.charCodeAt(0) >= 0xe000 && char.charCodeAt(0) <= 0xe00f);

test("news mentions only link to profiles confirmed as public", () => {
  const html = renderMarkdownLite(
    "[@PublicPlayer](/u/PublicPlayer), @PublicPlayer und [@FormerPlayer](/u/FormerPlayer), @FormerPlayer",
    { validProfileUsernames: ["publicplayer"] },
  );

  expect(html).toContain('href="/u/PublicPlayer"');
  expect(html).toContain('href="/u/PublicPlayer" class="mention-link"');
  expect(html).not.toContain('href="/u/FormerPlayer"');
  expect(html).toContain("@FormerPlayer");
});

test("generic markdown keeps existing profile-link behavior without an allowlist", () => {
  const html = renderMarkdownLite("Hallo @Player und [Profil](/u/Player)");

  expect(html).toContain('href="/u/Player" class="mention-link"');
  expect(html).toContain('href="/u/Player"');
});

test("ohne Option bleibt jedes sichere Bild ein Bild (News, Events, Turniertexte)", () => {
  expect(renderMarkdownLite("![Plan](https://bilder.example.test/plan.png)")).toContain('<img src="https://bilder.example.test/plan.png"');
});

// Regelwerk (#2218, Folge-Review): Die API liefert Namen aus Bibliothek und Modus mit Backslash-Escapes - sie bleiben Text. Der frei
// geschriebene Regeltext kommt mit verdoppeltem Backslash und erscheint so, wie er geschrieben ist.
test("mit `escapes` bleiben Bausteinwerte Text, auch in Tabellen; freier Text behält seine Backslashes", () => {
  const options = { escapes: true, linkMentions: false };
  const name = escapeBlockText("[Klick](https://evil.example) **fett** `code` \\pfad");
  const html = renderMarkdownLite(`| Name | Gilt in |\n| --- | --- |\n| ${name} | alle |`, options);
  expect(html).not.toContain("href=");
  expect(html).not.toContain("<strong>");
  expect(html).not.toContain("<code>");
  expect(html).toContain("[Klick](https://evil.example) **fett** `code` \\pfad");
  expect(renderMarkdownLite("![Blitz 9](/api/static/uploads/b.png) **echt**", options)).toContain("<strong>echt</strong>");
  const free = "Pfad C:\\Daten\\[x] und \\_frei\\_ \\\\ende `a\\*b`";
  expect(renderMarkdownLite(served(free), options)).toBe(renderMarkdownLite(free));
  expect(hasProtection(renderMarkdownLite(served(free), options))).toBe(false);
});

test("mit `escapes` zeigt auch ein Codeblock Bausteinwerte und Backslashes als echte Zeichen", () => {
  const html = renderMarkdownLite(`\`\`\`\n${escapeBlockText("Schild [Test] *x*")} ${served("C:\\a")}\n\`\`\``, { escapes: true });
  expect(html).toContain("Schild [Test] *x* C:\\a");
  expect(hasProtection(html)).toBe(false);
});

test("mit `escapes` wird ein Backslash im freien Text kein fremder Link, ein eingeschmuggeltes Schutzzeichen fällt weg", () => {
  const options = { escapes: true, linkMentions: false };
  expect(renderMarkdownLite(served("[Klick](/\\evil.example)"), options)).not.toContain("href=");
  expect(renderMarkdownLite(served("[Regeln](#regeln)"), { ...options, anchorLinksInPage: true })).toContain('href="#regeln"');
  const html = renderMarkdownLite(`A\ue000\ue002B\ue00b`, options);
  expect(html).toBe("<p>AB</p>");
});

test("protokoll-relative Links auf fremde Seiten werden kein Link", () => {
  for (const href of ["//evil.example", "//evil.example/pfad", "/\\evil.example", "\\/\\/evil.example", "\\\\evil.example"]) {
    const html = renderMarkdownLite(`[Klick](${href})`);
    expect(html).not.toContain("href=");
    expect(html).toContain("Klick");
    // Mit `escapes` wird „\\“ zu einem einzelnen Backslash - „\evil.example“ ist ein eigener Pfad, keine fremde Seite.
    const escaped = renderMarkdownLite(`[Klick](${href})`, { escapes: true, linkMentions: false });
    expect(escaped).not.toMatch(/href="[\\/]{2}/);
  }
  expect(renderMarkdownLite("[Turniere](/tournaments)")).toContain('href="/tournaments"');
  expect(renderMarkdownLite("[Regeln](#regeln)")).toContain('href="#regeln"');
});
