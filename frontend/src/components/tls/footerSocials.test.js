import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Social-Links in der Fußzeile: kompakt (Kästchen 36 px statt 44 px, Symbol 16 px), aber auf dem Handy noch
// gut zu treffen (mindestens 32 px). Die Größen stehen in index.css (.tls-social) und in PublicLayout.jsx.
const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
const layout = readFileSync(resolve(__dirname, "PublicLayout.jsx"), "utf8");

function remOf(property) {
  const block = css.match(/\n\.tls-social \{([\s\S]*?)\n\}/)[1];
  return Number(block.match(new RegExp(`${property}: ([0-9.]+)rem`))[1]);
}

test("Kästchen der Social-Links: kleiner als vorher (2,75 rem), Trefferfläche mindestens 32 px", () => {
  for (const property of ["width", "height"]) {
    expect(remOf(property) * 16).toBeLessThanOrEqual(36);
    expect(remOf(property) * 16).toBeGreaterThanOrEqual(32);
  }
});

test("Symbole in der Fußzeile 16 px, Abstand klein, Reihe darf umbrechen", () => {
  expect(layout).toContain('<ChannelIcon kind={social.platform} className="w-4 h-4" />');
  expect(layout).toMatch(/className="mt-4 flex flex-wrap gap-1\.5" data-testid="footer-socials"/);
});
