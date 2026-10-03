import React from "react";
import { render, screen } from "@testing-library/react-native";

// Saison-Fundstücke auf einem fremden Profil in der App (#678): nur mit dem Schalter der Person, nur die Summen; die
// Person selbst bekommt den Hinweis, ob andere sie sehen.

const mockApi = { get: jest.fn() };
jest.mock("../lib/api", () => ({ api: mockApi }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { PublicSeasonFindsCard } = require("./SeasonFinds");

const SHOWN = { hidden: false, public: true, total: 12, seasons: [{ key: "halloween", label: "Halloween", count: 12, items: [{ signal: "halloween_bats_scared", label: "Fledermäuse verscheucht", icon: "bat", count: 12 }] }] };

afterEach(() => mockApi.get.mockReset());

test("sichtbar: Summen je Saison und Fundstück", async () => {
  mockApi.get.mockResolvedValue({ data: SHOWN });
  await render(<PublicSeasonFindsCard userId="u1" />);
  expect(await screen.findByTestId("public-season-finds")).toBeTruthy();
  expect(mockApi.get).toHaveBeenCalledWith("/achievements/collectibles/user/u1");
  expect(screen.getByTestId("public-season-finds-total")).toHaveTextContent("12");
  expect(screen.getByTestId("public-season-find-halloween_bats_scared")).toHaveTextContent(/Fledermäuse verscheucht/);
  expect(screen.queryByTestId("public-season-finds-note")).toBeNull();
});

test("versteckt: keine Karte; eigenes Profil ohne Schalter: mit Hinweis", async () => {
  mockApi.get.mockResolvedValue({ data: { hidden: true, total: 0, seasons: [] } });
  const hidden = await render(<PublicSeasonFindsCard userId="u1" />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByTestId("public-season-finds")).toBeNull();
  await hidden.unmount();
  mockApi.get.mockResolvedValue({ data: { ...SHOWN, public: false } });
  await render(<PublicSeasonFindsCard userId="u1" own />);
  expect(await screen.findByTestId("public-season-finds-note")).toHaveTextContent(/Nur du siehst diese Karte/);
});
