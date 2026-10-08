import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Nur für dich“ (#1149, #1255): die Zeile „Deine Unterlagen“ steht da, sobald die Vereinsakte eigene Schreiben
// liefert - mit Anzahl und dem Datum des neuesten; ohne Unterlagen, ohne Mitgliedschaft oder bei einem Ausfall keine Zeile.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: () => "" }));
vi.mock("@/pages/user/profile/AchievementsTab", () => ({ AchievementsTab: () => null }));
vi.mock("@/components/achievements/ceremony/queue", () => ({ enqueueCeremony: () => {} }));

const { PrivateBox, documentsLine } = await import("./OwnProfileParts");

const OWN = [
  { id: "dolibarr-22", title: "Beitrittsbestätigung", created_at: "2026-03-02T10:00:00+00:00" },
  { id: "dolibarr-23", title: "Spendenbestätigung 2025", created_at: "2026-09-01T10:00:00+00:00" },
];

function mockApi(documents) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/account/documents") {
      if (documents instanceof Error) throw documents;
      return { data: documents };
    }
    if (url === "/account/invoices") return { data: { summary: { open_count: 0 }, currency: "EUR" } };
    if (url === "/users/me/profile-completeness") return { data: { score: 100, missing: [] } };
    return { data: [] };
  });
}

function renderBox() {
  return render(<MemoryRouter><PrivateBox /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

test("die Zeile „Deine Unterlagen“ mit Anzahl und neuestem Datum", async () => {
  mockApi({ available: true, reason: null, documents: OWN });
  renderBox();
  const row = await screen.findByTestId("profile-private-documents");
  expect(row).toHaveAttribute("href", "/account/documents");
  expect(row).toHaveTextContent("Deine Unterlagen");
  expect(row).toHaveTextContent("2 Dokumente · neuestes vom 01.09.2026");
});

test("ohne eigene Unterlagen, ohne Mitgliedschaft oder bei einem Ausfall: keine Zeile", async () => {
  for (const response of [{ available: true, reason: "not_bound", documents: [] }, { available: false, reason: "not_member", documents: [] },
    { available: false, reason: "unreachable", documents: [] }, new Error("offline")]) {
    mockApi(response);
    const { unmount } = renderBox();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/account/documents"));
    expect(await screen.findByTestId("profile-private-invoices")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-private-documents")).toBeNull();
    unmount();
    apiMock.get.mockClear();
  }
});

test("die Zeile in Worten", () => {
  expect(documentsLine(OWN.slice(0, 1))).toBe("1 Dokument · neuestes vom 02.03.2026");
  expect(documentsLine([{ id: "x" }, { id: "y" }])).toBe("2 Dokumente");
  expect(documentsLine([])).toBe("");
  expect(documentsLine(null)).toBe("");
});
