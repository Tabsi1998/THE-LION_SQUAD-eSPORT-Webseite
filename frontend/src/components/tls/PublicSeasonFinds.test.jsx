import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Saison-Fundstücke auf dem öffentlichen Profil (#678): nur mit dem Schalter der Person, nur die Summen; ohne Fund oder
// versteckt keine Karte; die Person selbst bekommt den Hinweis, ob andere sie sehen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
const { PublicSeasonFinds } = await import("./PublicSeasonFinds");

const SHOWN = { hidden: false, public: true, total: 12, seasons: [{ key: "halloween", label: "Halloween", count: 12, items: [{ signal: "halloween_bats_scared", label: "Fledermäuse verscheucht", icon: "bat", count: 12 }] }] };

afterEach(() => apiMock.get.mockReset());

test("sichtbar: Summen je Saison und Fundstück, sonst nichts", async () => {
  apiMock.get.mockResolvedValue({ data: SHOWN });
  render(<MemoryRouter><PublicSeasonFinds userId="u1" /></MemoryRouter>);
  expect(await screen.findByTestId("public-season-finds")).toBeTruthy();
  expect(apiMock.get).toHaveBeenCalledWith("/achievements/collectibles/user/u1");
  expect(screen.getByTestId("public-season-finds-total")).toHaveTextContent("12");
  expect(screen.getByTestId("public-season-find-halloween_bats_scared")).toHaveTextContent("Fledermäuse verscheucht");
  expect(screen.queryByTestId("public-season-finds-note")).toBeNull();
});

test("versteckt oder ohne Fund: keine Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { hidden: true, total: 0, seasons: [] } });
  const { container } = render(<MemoryRouter><PublicSeasonFinds userId="u1" /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container.innerHTML).toBe("");
});

test("eigenes Profil ohne Schalter: Karte mit dem Hinweis auf die Privatsphäre", async () => {
  apiMock.get.mockResolvedValue({ data: { ...SHOWN, public: false } });
  render(<MemoryRouter><PublicSeasonFinds userId="u1" own /></MemoryRouter>);
  expect(await screen.findByTestId("public-season-finds-note")).toHaveTextContent("Nur du siehst diese Karte.");
  expect(screen.getByRole("link", { name: "Unter Privatsphäre kannst du sie zeigen." }).getAttribute("href")).toBe("/profile?tab=privacy");
});
