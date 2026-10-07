import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sponsor werden pflegen (#1254): Zahlen (gezählt oder eingetragen), Stufen, Leistungen je Stufe; Speichern schickt nur
// Vollständiges, Leistungen nur mit den gezeigten Stufen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SponsoringOfferPanel, formToOffer, offerToForm } = await import("./SponsoringOfferPanel");

const ADMIN = {
  intro: "Danke!", numbers: [{ value: "2.400", label: "Besuche im Monat" }], auto_numbers: ["members"], tiers: ["gold", "silver", "bronze"],
  benefits: [{ label: "Logo im Laufband", tiers: ["gold", "silver", "bronze"] }], pdf_key: "", pdf_name: "",
  counted: { members: 42, discord: 214, events_year: 3, tournaments_year: 5 }, auto_labels: { members: "Mitglieder", discord: "im Discord", events_year: "Events im letzten Jahr", tournaments_year: "Turniere im letzten Jahr" },
  all_tiers: ["main", "platinum", "gold", "silver", "bronze"],
};

test("lädt, ändert und speichert: gezählte Zahl dazu, neue Leistung nur für Gold", async () => {
  apiMock.get.mockResolvedValue({ data: ADMIN });
  apiMock.put.mockResolvedValue({ data: ADMIN });
  render(<MemoryRouter><SponsoringOfferPanel /></MemoryRouter>);
  expect(await screen.findByTestId("sponsoring-auto-discord")).not.toBeChecked();
  expect(screen.getByTestId("sponsoring-offer-panel")).toHaveTextContent("im Discord (214)");
  fireEvent.click(screen.getByTestId("sponsoring-auto-discord"));
  fireEvent.click(screen.getByTestId("sponsoring-benefit-add"));
  fireEvent.change(screen.getByTestId("sponsoring-benefit-1").querySelector("input"), { target: { value: "Logo auf TV und Beamer" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Logo auf TV und Beamer: Silber" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Logo auf TV und Beamer: Bronze" }));
  fireEvent.click(screen.getByTestId("sponsoring-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.put.mock.calls[0];
  expect(url).toBe("/sponsoring/offer/admin");
  expect(payload.auto_numbers).toEqual(["members", "discord"]);
  expect(payload.benefits).toEqual([{ label: "Logo im Laufband", tiers: ["gold", "silver", "bronze"] }, { label: "Logo auf TV und Beamer", tiers: ["gold"] }]);
});

test("Formular-Umwandlung: unvollständige Zahlen und leere Leistungen fallen weg", () => {
  const form = offerToForm({ tiers: ["gold"], benefits: [{ label: "A", tiers: ["gold", "silver"] }] });
  expect(formToOffer({ ...form, numbers: [{ value: "1", label: "" }], benefits: [...form.benefits, { label: " ", tiers: [] }] })).toEqual({
    intro: "", numbers: [], auto_numbers: [], tiers: ["gold"], benefits: [{ label: "A", tiers: ["gold"] }],
  });
});
