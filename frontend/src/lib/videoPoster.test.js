import { captureVideoPoster } from "./videoPoster";

// Ein Standbild aus dem Video zu ziehen, kann fehlschlagen: nicht jedes Format
// spielt jeder Browser ab. Das darf den Upload nicht mitnehmen - ein Video ohne
// Vorschaubild ist immer noch ein brauchbares Video. Diese Tests halten fest,
// dass der Fehlerfall null liefert statt zu werfen.
//
// Der Erfolgsfall braucht einen Browser, der ein echtes Video dekodiert; jsdom
// tut das nicht, und ein Testvideo waere ohne ffmpeg nicht zu erzeugen. Er ist
// deshalb nicht automatisch abgedeckt - was der Nutzer davon merkt, prueft
// dagegen e2e/gallery-media.spec.js: eine Kachel mit Standbild zeigt es, und
// keine Kachel spielt mehr von selbst.

describe("Standbild aus einem Video", () => {
  test("ohne Datei kommt null", async () => {
    await expect(captureVideoPoster(null)).resolves.toBeNull();
    await expect(captureVideoPoster(undefined)).resolves.toBeNull();
  });

  test("nach der Wartezeit wird aufgegeben statt zu haengen", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "kaputt.mp4", { type: "video/mp4" });

    const poster = await captureVideoPoster(file, { seek: 0.1, timeoutMs: 60 });

    expect(poster).toBeNull();
  });

  test("der Objekt-URL wird wieder freigegeben", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const file = new File([new Uint8Array([1, 2, 3, 4])], "kaputt.mp4", { type: "video/mp4" });

    await captureVideoPoster(file, { seek: 0.1, timeoutMs: 60 });

    expect(revoke).toHaveBeenCalled();
    revoke.mockRestore();
  });
});
