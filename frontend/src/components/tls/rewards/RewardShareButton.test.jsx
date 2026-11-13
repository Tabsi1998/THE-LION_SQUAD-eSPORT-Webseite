import { rewardImagePath, rewardShareLink } from "./RewardShareButton";

// Teilen-Link einer Belohnung (F.4, #2214; F.5, #2215): Belohnungen einer Staffel führen zur Staffel, die der Gesamtwertung zur
// Ligaseite der Gesamtwertung - nie auf eine Adresse, die es nicht gibt.

test("Gesamtwertung: der Link kommt vom Server und führt zur Gesamtwertung", () => {
  const award = { id: "w1", url: "/liga/probe-liga/season-2/gesamtwertung", tournament: { id: "overall:p1:1", slug: null } };
  expect(rewardShareLink(award, "https://lsw.test")).toBe("https://lsw.test/liga/probe-liga/season-2/gesamtwertung");
  expect(rewardImagePath(award)).toBe("/api/rewards/w1/share.png");
});

test("Gegenprobe: eine Staffel-Belohnung führt wie bisher zur Turnierseite, ohne alles zur Startseite", () => {
  expect(rewardShareLink({ id: "w2", url: null, tournament: { id: "t1", slug: "probe-a" } }, "https://lsw.test")).toBe("https://lsw.test/tournaments/probe-a");
  expect(rewardShareLink({ id: "w3" }, "https://lsw.test")).toBe("https://lsw.test");
});
