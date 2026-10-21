import { api } from "./api";
import { chatTime, markChatRead } from "./chats";

// Die Zeit in der Chat-Liste (#1148): heute die Uhrzeit, „gestern“, sonst der Tag - gezählt in Wien.

jest.mock("./api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const NOW = new Date("2026-10-07T12:30:00Z");

test("heute die Uhrzeit, gestern „gestern“, sonst der Tag", () => {
  expect(chatTime("2026-10-07T12:02:00Z", NOW)).toBe("14:02");
  expect(chatTime("2026-10-06T19:00:00Z", NOW)).toBe("gestern");
  expect(chatTime("2026-10-05T21:30:00Z", NOW)).toBe("05.10.");
  expect(chatTime(null, NOW)).toBe("");
});

// #1049: Serverzeiten ohne Zone sind Wiener Uhr (asInstant) - nie die Uhr des Geräts. Mit Zone gilt die Zone. Der
// CI-Rechner läuft in UTC; lokal zusätzlich mit $env:TZ="UTC" bzw. "America/Los_Angeles" (PowerShell) prüfen.
test("ohne Zone gilt Wiener Uhr, mit Zone die Zone - gemischt und über Mitternacht", () => {
  expect(chatTime("2026-10-07T14:02:00", NOW)).toBe("14:02");
  expect(chatTime("2026-10-07T00:30:00", NOW)).toBe("00:30");
  expect(chatTime("2026-10-06T23:30:00", NOW)).toBe("gestern");
  expect(chatTime("2026-10-05T23:30:00", NOW)).toBe("05.10.");
  expect(chatTime("2026-10-07T14:02:00+02:00", NOW)).toBe("14:02");
  expect(chatTime("2026-10-07T07:02:00-05:00", NOW)).toBe("14:02");
  expect(chatTime("2026-10-06T22:30:00Z", NOW)).toBe("00:30");
  expect(chatTime("kein datum", NOW)).toBe("");
});

test("„Gelesen“ (#1512): die Kennung als ein Pfadteil - schon kodiert aus einer Adresse nicht doppelt, mit Pfadzeichen gar nicht", async () => {
  const post = api.post as jest.Mock;
  post.mockReset().mockResolvedValue({ data: {} });
  await markChatRead("team", "löwen team");
  expect(post).toHaveBeenLastCalledWith("/chats/team/l%C3%B6wen%20team/read");
  await markChatRead("tournament", "l%C3%B6wen-cup");
  expect(post).toHaveBeenLastCalledWith("/chats/tournament/l%C3%B6wen-cup/read");
  post.mockClear();
  await markChatRead("team", "../admin");
  await markChatRead("team", "");
  expect(post).not.toHaveBeenCalled();
});
