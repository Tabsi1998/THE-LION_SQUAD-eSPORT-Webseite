import { renderMarkdownLite } from "./markdownLite";

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

test("protokoll-relative Links auf fremde Seiten werden kein Link", () => {
  for (const href of ["//evil.example", "//evil.example/pfad", "/\\evil.example"]) {
    const html = renderMarkdownLite(`[Klick](${href})`);
    expect(html).not.toContain("href=");
    expect(html).toContain("Klick");
  }
  expect(renderMarkdownLite("[Turniere](/tournaments)")).toContain('href="/tournaments"');
  expect(renderMarkdownLite("[Regeln](#regeln)")).toContain('href="#regeln"');
});
