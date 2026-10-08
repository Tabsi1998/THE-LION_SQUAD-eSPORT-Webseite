import { Share } from "react-native";

// Ergebnis teilen (#1194): Bild laden und ins Teilen-Menü, sonst der Link - wie im Web.

const mockFs = { cacheDirectory: "file:///cache/", downloadAsync: jest.fn() };
const mockSharing = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
jest.mock("expo-file-system/legacy", () => mockFs);
jest.mock("expo-sharing", () => mockSharing);
jest.mock("./api", () => ({ resolveMediaUrl: (value?: string | null) => (value ? `https://verein.example${value}` : "") }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resultFileName, resultShareUrl, shareResultImage, shareResultLink, showsHint } = require("./resultShare");

const OPTIONS = {
  shareable: true, path: "/tournaments/fc26-cup/ergebnis/neonfalke",
  image_paths: { story: "/api/share/result/fc26-cup/neonfalke/story.png", wide: "/api/share/result/fc26-cup/neonfalke/wide.png" },
  headline: "Platz 2 im FC 26 Herbst-Cup", share_text: "Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD.",
};

beforeEach(() => {
  mockFs.downloadAsync.mockReset();
  mockSharing.isAvailableAsync.mockReset();
  mockSharing.shareAsync.mockReset();
});

test("Dateiname, Adresse und wann ein Hinweis statt Knopf kommt", () => {
  expect(resultFileName(OPTIONS.path)).toBe("ergebnis-fc26-cup-neonfalke-story.png");
  expect(resultFileName("/tournaments/fc26-cup/ergebnis/neon falke", "wide")).toBe("ergebnis-fc26-cup-neon-falke-wide.png");
  expect(resultShareUrl(OPTIONS.path).endsWith("/tournaments/fc26-cup/ergebnis/neonfalke")).toBe(true);
  expect(showsHint({ shareable: false, reason: "private_profile" })).toBe(true);
  expect(showsHint({ shareable: false, reason: "not_public" })).toBe(true);
  expect(showsHint({ shareable: false, reason: "not_participant" })).toBe(false);
  expect(showsHint({ shareable: true })).toBe(false);
  expect(showsHint(null)).toBe(false);
});

test("„Bild teilen“ lädt das hohe Bild und öffnet das Teilen-Menü", async () => {
  mockSharing.isAvailableAsync.mockResolvedValue(true);
  mockFs.downloadAsync.mockResolvedValue({ uri: "file:///cache/ergebnis-fc26-cup-neonfalke-story.png", status: 200 });
  expect(await shareResultImage(OPTIONS)).toBe("shared");
  expect(mockFs.downloadAsync).toHaveBeenCalledWith("https://verein.example/api/share/result/fc26-cup/neonfalke/story.png", "file:///cache/ergebnis-fc26-cup-neonfalke-story.png");
  expect(mockSharing.shareAsync).toHaveBeenCalledWith("file:///cache/ergebnis-fc26-cup-neonfalke-story.png", { mimeType: "image/png", UTI: "public.png", dialogTitle: "Platz 2 im FC 26 Herbst-Cup" });

  mockFs.downloadAsync.mockResolvedValue({ uri: "file:///cache/x.png", status: 404 });
  expect(await shareResultImage(OPTIONS)).toBe("failed");
  mockFs.downloadAsync.mockRejectedValue(new Error("offline"));
  expect(await shareResultImage(OPTIONS)).toBe("failed");
  expect(await shareResultImage({ shareable: true })).toBe("failed");
});

test("ohne Teilen-Menü für Dateien teilt es den Link mit Text", async () => {
  mockSharing.isAvailableAsync.mockResolvedValue(false);
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
  expect(await shareResultImage(OPTIONS)).toBe("shared");
  expect(mockFs.downloadAsync).not.toHaveBeenCalled();
  const [content] = share.mock.calls[0];
  expect((content as { message: string }).message).toMatch(/^Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD\. .+\/tournaments\/fc26-cup\/ergebnis\/neonfalke$/);
  share.mockRejectedValueOnce(new Error("nein"));
  expect(await shareResultLink(OPTIONS)).toBe("failed");
  share.mockRestore();
});
