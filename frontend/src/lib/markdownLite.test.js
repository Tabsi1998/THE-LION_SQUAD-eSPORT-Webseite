import { protectBlockText, renderMarkdownLite } from "./markdownLite";

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

// Regelwerk (#2218, Review): Namen aus Bibliothek und Modus stehen im Baustein mit geschützten Steuerzeichen - sie bleiben Text. Der frei
// geschriebene Regeltext bleibt unberührt: Ein Backslash darin steht da, wie er geschrieben ist.
test("mit `blockText` bleiben Bausteinwerte Text, auch in Tabellen; freier Text behält seine Backslashes", () => {
  const options = { blockText: true, linkMentions: false };
  const name = protectBlockText("[Klick](https://evil.example) **fett** `code` \\pfad");
  const html = renderMarkdownLite(`| Name | Gilt in |\n| --- | --- |\n| ${name} | alle |`, options);
  expect(html).not.toContain("href=");
  expect(html).not.toContain("<strong>");
  expect(html).not.toContain("<code>");
  expect(html).toContain("[Klick](https://evil.example) **fett** `code` \\pfad");
  expect(renderMarkdownLite("![Blitz 9](/api/static/uploads/b.png) **echt**", options)).toContain("<strong>echt</strong>");
  expect(renderMarkdownLite("Pfad C:\\Daten\\[x] und \\_frei\\_", options)).toContain("Pfad C:\\Daten\\[x] und \\_frei\\_");
});

test("protokoll-relative Links auf fremde Seiten werden kein Link", () => {
  for (const href of ["//evil.example", "//evil.example/pfad", "/\\evil.example"]) {
    const html = renderMarkdownLite(`[Klick](${href})`);
    expect(html).not.toContain("href=");
    expect(html).toContain("Klick");
  }
  expect(renderMarkdownLite("[Turniere](/tournaments)")).toContain('href="/tournaments"');
  expect(renderMarkdownLite("[Regeln](#regeln)")).toContain('href="#regeln"');
});
