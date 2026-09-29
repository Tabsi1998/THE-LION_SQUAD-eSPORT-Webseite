import { achievementShareText, achievementShareUrl, shareAchievement } from "./shareAchievement";

describe("shareAchievement (#619)", () => {
  it("baut Link und Text", () => {
    expect(achievementShareUrl("aw 1", "https://lionsquad.at")).toBe("https://lionsquad.at/achievements/a/aw%201");
    expect(achievementShareText({ name: "Spielmacher VII", materialName: "Diamant", personName: "Anna" })).toBe("Anna hat „Spielmacher VII“ (Diamant) bei THE LION SQUAD freigeschaltet.");
    expect(achievementShareText({ name: "Konami", clubName: "Verein X" })).toBe("Ich habe „Konami“ bei Verein X freigeschaltet.");
  });

  it("nutzt Web Share, wenn vorhanden, und meldet Abbruch", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareAchievement({ awardId: "aw1", name: "Spielmacher I", materialName: "Holz", nav: { share }, origin: "https://x.test" });
    expect(result).toEqual({ status: "shared", url: "https://x.test/achievements/a/aw1" });
    expect(share).toHaveBeenCalledWith({ title: "Spielmacher I · THE LION SQUAD", text: "Ich habe „Spielmacher I“ (Holz) bei THE LION SQUAD freigeschaltet.", url: "https://x.test/achievements/a/aw1" });
    const abort = Object.assign(new Error("nope"), { name: "AbortError" });
    expect((await shareAchievement({ awardId: "aw1", name: "X", nav: { share: vi.fn().mockRejectedValue(abort) }, origin: "https://x.test" })).status).toBe("cancelled");
  });

  it("kopiert den Link, wenn Web Share fehlt oder ablehnt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect((await shareAchievement({ awardId: "aw1", name: "X", nav: { clipboard: { writeText } }, origin: "https://x.test" })).status).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://x.test/achievements/a/aw1");
    const share = vi.fn().mockRejectedValue(new Error("NotAllowed"));
    expect((await shareAchievement({ awardId: "aw1", name: "X", nav: { share, clipboard: { writeText } }, origin: "https://x.test" })).status).toBe("copied");
    expect((await shareAchievement({ awardId: "aw1", name: "X", nav: {}, origin: "https://x.test" })).status).toBe("failed");
  });
});
