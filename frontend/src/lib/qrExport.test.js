import { buildQrSvg, inlineImage } from "./qrExport";

// Druckversion (#400): das Logo wird als Daten-URL eingebettet; lässt es sich nicht laden, bleibt
// die Datei ohne Logo statt mit kaputter Adresse.

test("bettet das Logo ein, wenn es sich laden lässt", async () => {
  const blob = new Blob(["png"], { type: "image/png" });
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => blob }));
  const data = await inlineImage("https://lionsquad.at/api/uploads/branding/loewe.png", fetcher);
  expect(data).toMatch(/^data:image\/png;base64,/);
  expect(await inlineImage("data:image/png;base64,AAAA", fetcher)).toBe("data:image/png;base64,AAAA");
  expect(await inlineImage("https://lionsquad.at/fehlt.png", vi.fn(async () => ({ ok: false })))).toBeNull();
});

test("die SVG-Datei hat 1024 px, den Titel und das Ziel", async () => {
  const svg = await buildQrSvg({ value: "https://lionsquad.at/tournaments/autumn-cup", title: "Autumn Cup", logoHref: null });
  expect(svg).toContain('width="1024" height="1024"');
  expect(svg).toContain("<title>Autumn Cup</title>");
  expect(svg).not.toContain("<image");
});
