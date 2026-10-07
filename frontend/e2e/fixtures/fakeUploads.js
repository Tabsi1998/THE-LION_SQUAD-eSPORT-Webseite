// Nachgestellte Uploads für Bild-Tests (#1227): jede Adresse unter /api/static/uploads liefert ein SVG in der
// angefragten Breite (?w=…) oder in der Größe des „Originals“ - und so schwer, wie ein echtes Foto dieser Größe
// ungefähr wäre (ein Achtel Byte je Bildpunkt, wie ein WebP-Foto). So zeigt der Netzwerk-Mitschnitt, ob eine Seite
// die passende Fassung holt oder das Original mit mehreren tausend Pixeln.

// Originalgrößen nach dem Namensanfang der Datei - wie sie im Verein vorkommen.
const ORIGINALS = {
  logo: [3508, 1075],
  mascot: [1949, 1890],
  avatar: [2048, 2048],
  photo: [1600, 2000],
  cover: [2400, 1350],
  banner: [2400, 1350],
  sponsor: [1800, 600],
  partner: [1200, 1200],
  album: [2400, 1600],
  tool: [1600, 900],
};

function originalOf(name) {
  const key = Object.keys(ORIGINALS).find((prefix) => name.startsWith(prefix));
  return ORIGINALS[key] || [1600, 1600];
}

function fakeImage(name, requested) {
  const [ow, oh] = originalOf(name);
  // Wie der Server: kleiner nur, wenn das Original breiter ist; sonst kommt das Original.
  const width = requested && requested < ow ? requested : ow;
  const height = Math.round((oh * width) / ow);
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#29B6E8"/>`;
  const weight = Math.round((width * height) / 8);
  const padding = Math.max(0, weight - head.length - 16);
  return `${head}<!--${"x".repeat(padding)}--></svg>`;
}

/** Hängt die Uploads an die Seite; zurück kommt das Protokoll (Adresse, Breite, Bytes). */
async function routeFakeUploads(page) {
  const log = [];
  await page.route("**/api/static/uploads/**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop();
    const requested = Number(url.searchParams.get("w")) || 0;
    const body = fakeImage(name, requested);
    log.push({ path: url.pathname, name, w: requested, bytes: body.length });
    return route.fulfill({ contentType: "image/svg+xml", body });
  });
  return log;
}

module.exports = { fakeImage, routeFakeUploads };
