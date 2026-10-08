import { canShareFiles, copyResultLink, loadResultImage, prefersShareSheet, resultFileName, resultShareUrl, shareResultImage } from "./resultShare";

// Ergebnis teilen (#1194): Handy teilt das Bild ins Teilen-Menü, PC lädt herunter oder kopiert den Link.

describe("resultShare", () => {
  it("baut Adresse und Dateinamen aus dem Pfad der Teilen-Seite", () => {
    expect(resultShareUrl("/tournaments/fc26-cup/ergebnis/neonfalke", "https://verein.example")).toBe("https://verein.example/tournaments/fc26-cup/ergebnis/neonfalke");
    expect(resultFileName("/tournaments/fc26-cup/ergebnis/neonfalke")).toBe("ergebnis-fc26-cup-neonfalke-story.png");
    expect(resultFileName("/tournaments/fc26-cup/ergebnis/neon falke", "wide")).toBe("ergebnis-fc26-cup-neon-falke-wide.png");
    expect(resultFileName("")).toBe("ergebnis-turnier-ergebnis-story.png");
  });

  it("erkennt, ob der Browser Bilder teilen kann", () => {
    expect(canShareFiles(null)).toBe(false);
    expect(canShareFiles({ share: vi.fn() })).toBe(false);
    expect(canShareFiles({ share: vi.fn(), canShare: () => true })).toBe(true);
    expect(canShareFiles({ share: vi.fn(), canShare: () => false })).toBe(false);
    expect(canShareFiles({ share: vi.fn(), canShare: () => { throw new Error("kaputt"); } })).toBe(false);
    // Teilen-Menü nur am Touch-Gerät - am PC bleibt es bei Herunterladen und Kopieren.
    const nav = { share: vi.fn(), canShare: () => true };
    expect(prefersShareSheet(nav, { matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersShareSheet(nav, { matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(prefersShareSheet(nav, {})).toBe(false);
    expect(prefersShareSheet({}, { matchMedia: () => ({ matches: true }) })).toBe(false);
  });

  it("teilt das vorab geladene Bild mit Text und Link, sonst nur den Link", async () => {
    const file = new File(["png"], "ergebnis.png", { type: "image/png" });
    const share = vi.fn().mockResolvedValue(undefined);
    const nav = { share, canShare: () => true };
    expect(await shareResultImage({ file, url: "https://x/e", text: "Platz 2", title: "T", nav })).toEqual({ status: "shared" });
    expect(share).toHaveBeenLastCalledWith({ files: [file], title: "T", text: "Platz 2 https://x/e" });
    expect(await shareResultImage({ file: null, url: "https://x/e", text: "Platz 2", title: "T", nav })).toEqual({ status: "shared" });
    expect(share).toHaveBeenLastCalledWith({ title: "T", text: "Platz 2", url: "https://x/e" });

    const abort = Object.assign(new Error("abgebrochen"), { name: "AbortError" });
    expect(await shareResultImage({ file, url: "u", text: "t", nav: { share: vi.fn().mockRejectedValue(abort), canShare: () => true } })).toEqual({ status: "cancelled" });
    expect(await shareResultImage({ file, url: "u", text: "t", nav: { share: vi.fn().mockRejectedValue(new Error("nein")), canShare: () => true } })).toEqual({ status: "failed" });
    expect(await shareResultImage({ file, url: "u", text: "t", nav: {} })).toEqual({ status: "failed" });
  });

  it("lädt das Bild vorab als Datei - Fehler ergeben null", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })) });
    const file = await loadResultImage("/api/share/result/x/y/story.png", "ergebnis-x-y-story.png", ok);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("ergebnis-x-y-story.png");
    expect(await loadResultImage("/bild.png", "a.png", vi.fn().mockResolvedValue({ ok: false }))).toBeNull();
    expect(await loadResultImage("/bild.png", "a.png", vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await loadResultImage("", "a.png", ok)).toBeNull();
  });

  it("kopiert den Link, wenn es eine Zwischenablage gibt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyResultLink("https://x/e", { clipboard: { writeText } })).toEqual({ status: "copied" });
    expect(writeText).toHaveBeenCalledWith("https://x/e");
    expect(await copyResultLink("https://x/e", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("nein")) } })).toEqual({ status: "failed" });
    expect(await copyResultLink("https://x/e", {})).toEqual({ status: "failed" });
  });
});
