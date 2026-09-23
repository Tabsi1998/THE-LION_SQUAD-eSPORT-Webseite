import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AwardBanner, awardLines, awardTone } from "./AwardBanner";

// Auszeichnungen (#230): das Banner steht aus den Daten – Platz, Bilanz, Turnier, Spiel, Saison;
// Platz 1–3 sind Trophäen mit Gold/Silber/Bronze, ein hochgeladenes Bild liegt dahinter.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => (value ? `https://x.example${value}` : "") }));

const cup = {
  id: "a1", kind: "trophy", rank: 1, rank_label: "1. Platz", participants: 12, record: "4 Siege · 0 Niederlagen",
  tournament: { id: "t1", slug: "herbst-cup", title: "Herbst-Cup", start_date: "2026-10-02T17:00:00+02:00" },
  game: { id: "g1", name: "FIFA 26" }, season: { id: "s1", name: "Saison 2026" }, team: null, image_url: "/api/static/uploads/gold.png", date: "2026-10-02T17:00:00+02:00",
};

test("Trophäe mit Gold, Bilanz und den Zeilen zum Turnier; das hochgeladene Bild liegt dahinter", () => {
  render(<MemoryRouter><AwardBanner award={cup} linkTo="/tournaments/herbst-cup" /></MemoryRouter>);
  const card = screen.getByTestId("award-a1");
  expect(card).toHaveTextContent("1. Platz");
  expect(card).toHaveTextContent("Gold");
  expect(card).toHaveTextContent("Herbst-Cup");
  expect(screen.getByTestId("award-record-a1")).toHaveTextContent("4 Siege · 0 Niederlagen");
  expect(card.querySelector("img")).toHaveAttribute("src", "https://x.example/api/static/uploads/gold.png");
  expect(screen.getByRole("link")).toHaveAttribute("href", "/tournaments/herbst-cup");
  expect(awardLines(cup)).toEqual(["FIFA 26", "2.10.2026", "12 Teilnehmer", "Saison 2026"]);
  expect(awardTone(cup).label).toBe("Gold");
});

test("Teilnahme-Banner ohne Platz, ohne Bild, mit Team", () => {
  const part = { ...cup, id: "a2", kind: "banner", rank: null, rank_label: "Teilnahme", record: "", image_url: null, team: { id: "tm", name: "Team Lions" } };
  render(<MemoryRouter><AwardBanner award={part} size="hero" /></MemoryRouter>);
  const card = screen.getByTestId("award-a2");
  expect(card).toHaveTextContent("Teilnahme");
  expect(card).toHaveTextContent("Team Lions");
  expect(card).not.toHaveTextContent("Gold");
  expect(card.querySelector("img")).toBeNull();
  expect(screen.queryByTestId("award-record-a2")).toBeNull();
  expect(awardTone(part).label).toBe("");
});
