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
