import { chatTime } from "./chats";

// Die Zeit in der Chat-Liste (#1148): heute die Uhrzeit, „gestern“, sonst der Tag - gezählt in Wien.

jest.mock("./api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const NOW = new Date("2026-10-07T12:30:00Z");

test("heute die Uhrzeit, gestern „gestern“, sonst der Tag", () => {
  expect(chatTime("2026-10-07T12:02:00Z", NOW)).toBe("14:02");
  expect(chatTime("2026-10-06T19:00:00Z", NOW)).toBe("gestern");
  expect(chatTime("2026-10-05T21:30:00Z", NOW)).toBe("05.10.");
  expect(chatTime(null, NOW)).toBe("");
});
