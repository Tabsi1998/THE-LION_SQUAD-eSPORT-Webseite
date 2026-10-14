import {
  AVATAR_MAX_ZOOM,
  AVATAR_OUTPUT_SIZE,
  avatarOutputSize,
  avatarPreviewBox,
  avatarSourceRect,
  clampAvatarCrop,
  INITIAL_AVATAR_CROP,
  isSafeBlobUrl,
  panAvatarCrop,
  zoomAvatarCrop,
} from "./avatarCrop";

// Profilbild zuschneiden (#1459): Zoom und Verschiebung ergeben ein quadratisches Quellrechteck, das nie über das
// Bild hinausragt - im runden Rahmen gibt es also nie leere Ränder.

const wide = { width: 1200, height: 800 };
const tall = { width: 600, height: 1000 };

function insideImage(dims, rect) {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.size <= dims.width + 1e-9 && rect.y + rect.size <= dims.height + 1e-9;
}

test("ohne Zoom: größtes Quadrat, mittig", () => {
  expect(avatarSourceRect(wide, INITIAL_AVATAR_CROP)).toEqual({ x: 200, y: 0, size: 800 });
  expect(avatarSourceRect(tall, INITIAL_AVATAR_CROP)).toEqual({ x: 0, y: 200, size: 600 });
});

test("Zoom verkleinert den Ausschnitt um den Mittelpunkt", () => {
  expect(avatarSourceRect(wide, { zoom: 2, offsetX: 0, offsetY: 0 })).toEqual({ x: 400, y: 200, size: 400 });
});

test("Zoom bleibt zwischen 1 und dem Höchstwert - unter 1 gäbe es leere Ränder", () => {
  expect(clampAvatarCrop(wide, { zoom: 0.4, offsetX: 0, offsetY: 0 }).zoom).toBe(1);
  expect(clampAvatarCrop(wide, { zoom: 99, offsetX: 0, offsetY: 0 }).zoom).toBe(AVATAR_MAX_ZOOM);
  expect(clampAvatarCrop(wide, { zoom: Number.NaN, offsetX: 0, offsetY: 0 }).zoom).toBe(1);
});

test("Verschieben stößt an den Bildrand an", () => {
  const far = clampAvatarCrop(wide, { zoom: 1, offsetX: 5000, offsetY: -5000 });
  expect(far).toEqual({ zoom: 1, offsetX: 200, offsetY: 0 });
  expect(avatarSourceRect(wide, far)).toEqual({ x: 400, y: 0, size: 800 });
});

test("kein Quellrechteck ragt je über das Bild hinaus", () => {
  for (const dims of [wide, tall, { width: 640, height: 640 }, { width: 37, height: 4000 }]) {
    for (const zoom of [0.2, 1, 1.37, 2.5, AVATAR_MAX_ZOOM, 10]) {
      for (const offset of [-1e6, -333, -1, 0, 7, 250, 1e6]) {
        const rect = avatarSourceRect(dims, { zoom, offsetX: offset, offsetY: -offset });
        expect(insideImage(dims, rect)).toBe(true);
        expect(rect.size).toBeGreaterThan(0);
      }
    }
  }
});

test("Ziehen nach rechts zeigt mehr vom linken Bildteil", () => {
  const zoomed = { zoom: 2, offsetX: 0, offsetY: 0 };
  // 300 px Ansicht zeigen 400 px Bild: 30 px ziehen = 40 px im Bild.
  const moved = panAvatarCrop(wide, zoomed, 30, -15, 300);
  expect(moved.offsetX).toBeCloseTo(-40);
  expect(moved.offsetY).toBeCloseTo(20);
});

test("Zoom raus nach dem Verschieben zieht den Ausschnitt zurück ins Bild", () => {
  const moved = { zoom: 3, offsetX: 300, offsetY: 200 };
  const out = zoomAvatarCrop(wide, moved, 1);
  expect(out.zoom).toBe(1);
  expect(insideImage(wide, avatarSourceRect(wide, out))).toBe(true);
  expect(out.offsetY).toBe(0);
});

test("Vorschau: das Bild deckt die runde Ansicht immer ganz ab", () => {
  const view = 320;
  for (const crop of [INITIAL_AVATAR_CROP, { zoom: 2.2, offsetX: 180, offsetY: -90 }, { zoom: 4, offsetX: -1e5, offsetY: 1e5 }]) {
    const box = avatarPreviewBox(wide, crop, view);
    expect(box.left).toBeLessThanOrEqual(0);
    expect(box.top).toBeLessThanOrEqual(0);
    expect(box.left + box.width).toBeGreaterThanOrEqual(view - 1e-9);
    expect(box.top + box.height).toBeGreaterThanOrEqual(view - 1e-9);
  }
  expect(avatarPreviewBox(wide, INITIAL_AVATAR_CROP, 400)).toEqual({ left: -100, top: 0, width: 600, height: 400 });
});

test("Ausgabe: quadratisch, höchstens 512 px, kleine Ausschnitte werden nicht aufgeblasen", () => {
  expect(AVATAR_OUTPUT_SIZE).toBe(512);
  expect(avatarOutputSize({ size: 800 })).toBe(512);
  expect(avatarOutputSize({ size: 300.4 })).toBe(300);
  expect(avatarOutputSize({ size: 0.2 })).toBe(1);
});

test("Vorschau-Adresse: nur echte Blob-Adressen, nichts anderes landet im Bild", () => {
  expect(isSafeBlobUrl("blob:http://localhost:3000/0f6c1a2e-9a1b-4c7e-8d2f-1b2c3d4e5f60")).toBe(true);
  expect(isSafeBlobUrl("blob:https://lionsquad.at/abc-123")).toBe(true);
  for (const bad of ["javascript:alert(1)", "https://example.com/bild.png", "data:image/png;base64,AAAA", " blob:http://x/1",
    'blob:http://x/1" onerror="alert(1)', "blob:http://x/<script>", "blob:", "blob:http:", "blob:http://x/1\n", "blob:null/1", "", null, undefined, 42, {}]) {
    expect(isSafeBlobUrl(bad)).toBe(false);
  }
});
