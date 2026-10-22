import { imageSourceText, shownLogo } from "./sponsorImages";

// Bilder aus dem Vereinsmodul (#880): die Verwaltung zeigt, was die Website zeigt.

test("Vorschaubild: dunkel vor hell vor dem Upload", () => {
  const dark = { url: "/d.png" };
  const light = { url: "/h.png" };
  expect(shownLogo({ logo_url: "/u.png", dolibarr_images: { logo: { dark, light } } })).toBe("/d.png");
  expect(shownLogo({ logo_url: "/u.png", dolibarr_images: { logo: { light } } })).toBe("/h.png");
  expect(shownLogo({ logo_url: "/u.png" })).toBe("/u.png");
  expect(shownLogo(null)).toBe("");
});

// #1952: ein hier hochgeladenes SVG-Logo geht vor - wie auf der Website.
test("Vorschaubild: ein hochgeladenes SVG geht vor Dolibarr", () => {
  const dark = { url: "/api/static/uploads/dolibarr-partner-1-logo-dark-aa.png" };
  expect(shownLogo({ logo_url: "/api/static/uploads/kiwi.svg", dolibarr_images: { logo: { dark } } })).toBe("/api/static/uploads/kiwi.svg");
  expect(shownLogo({ logo_url: "/api/static/uploads/kiwi.png", dolibarr_images: { logo: { dark } } })).toBe(dark.url);
});

test("Herkunft in Worten - leer, wenn Dolibarr nichts liefert", () => {
  expect(imageSourceText({ logo: { variants: ["dark", "light"] }, banner: { variants: ["dark"] } })).toBe("Logo aus Dolibarr (dunkel und hell) · Banner aus Dolibarr (dunkel)");
  expect(imageSourceText({ logo: { variants: [] }, banner: { variants: [] } })).toBe("");
  expect(imageSourceText(undefined)).toBe("");
});
