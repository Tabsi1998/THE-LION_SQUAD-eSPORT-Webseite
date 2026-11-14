import { render, screen } from "@testing-library/react";
import { RewardShareButton, canShareReward, rewardImagePath, rewardShareLink } from "./RewardShareButton";

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

test("Gesamtwertung ohne öffentlichen Link: kein Teilen-Knopf", () => {
  const hidden = { id: "w4", url: null, reward: { name: "Gesamtsieg" }, tournament: { id: "overall:p1:1", slug: null } };
  expect(canShareReward(hidden)).toBe(false);
  const { container } = render(<RewardShareButton award={hidden} nav={null} testId="share" />);
  expect(container).toBeEmptyDOMElement();
  // Gegenprobe: mit Link bzw. als Staffel-Belohnung ist der Knopf da.
  render(<RewardShareButton award={{ ...hidden, url: "/liga/x/season-1/gesamtwertung" }} nav={null} testId="share-ok" />);
  expect(screen.getByTestId("share-ok-download")).toBeInTheDocument();
  expect(canShareReward({ id: "w5", tournament: { id: "t1", slug: "probe-a" } })).toBe(true);
});
