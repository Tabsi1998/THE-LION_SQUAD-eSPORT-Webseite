import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";

// Druckansicht (#1283): Blätter je Teil mit Druckzeit und QR-Code, kein Druck beim Laden (erst der Knopf), und die
// Check-in-Liste nur mit Turnier-Recht - ohne Recht fragt die Seite den Server gar nicht erst.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));

const PrintPage = (await import("./PrintPage")).default;

const bracket = {
  tournament: { id: "t1", slug: "herbst-cup" },
  stages: [{ id: "s1", number: 1 }],
  registrations: [{ id: "a", display_name: "Anna" }, { id: "b", display_name: "Ben" }],
  matches_v2: [
    { id: "m1", stage_id: "s1", section: "WB", round: 1, order: 0, match_key: "A", round_label: "Halbfinale", status: "pending", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }], scheduled_at: "2026-10-31T09:00:00Z" },
    { id: "m2", stage_id: "s1", section: "WB", round: 1, order: 1, match_key: "B", round_label: "Halbfinale", status: "pending", slots: [{ slot: 1 }, { slot: 2 }] },
    { id: "m3", stage_id: "s1", section: "WB", round: 2, order: 0, match_key: "C", round_label: "Finale", status: "pending", slots: [{ slot: 1, source: { raw: "W:A:1" } }, { slot: 2, source: { raw: "W:B:1" } }] },
  ],
};

function serve({ canCheckIn }) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tournaments/herbst-cup") return { data: { id: "t1", slug: "herbst-cup", title: "Herbst-Cup", can_check_in: canCheckIn } };
    if (url === "/tournaments/t1/bracket") return { data: bracket };
    if (url === "/tournaments/t1/print/checkin") return { data: { expected: [{ id: "a", name: "Anna", seed: 1, checked_in: true }], waitlist: [], counts: { expected: 1, checked_in: 1, waitlist: 0 } } };
    throw Object.assign(new Error("unerwartet"), { response: { status: 404 } });
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/print/tournaments/:slug" element={<PrintPage scope="tournament" />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  window.print = vi.fn();
});

test("Baum und Spielplan: je Blatt Druckzeit und QR-Code zur Live-Seite; gedruckt wird erst auf Knopfdruck", async () => {
  serve({ canCheckIn: false });
  renderAt("/print/tournaments/herbst-cup");
  expect(await screen.findByTestId("print-sheet-baum")).toBeInTheDocument();
  expect(screen.getByTestId("print-sheet-spielplan")).toBeInTheDocument();
  expect(screen.getAllByTestId("print-stamp").every((node) => /^Stand \d\d\.\d\d\. \d\d:\d\d$/.test(node.textContent))).toBe(true);
  const qr = screen.getAllByTestId("branded-qr-code").map((node) => node.dataset.value);
  expect(qr).toEqual([`${window.location.origin}/tournaments/herbst-cup/bracket`, `${window.location.origin}/tournaments/herbst-cup/matches`]);
  expect(screen.getAllByTestId("print-round-title").map((node) => node.textContent)).toEqual(["Halbfinale", "Finale"]);
  expect(screen.getAllByText("Sieger aus A").length).toBeGreaterThan(0);
  expect(window.print).not.toHaveBeenCalled();
  await userEvent.click(screen.getByTestId("print-button"));
  expect(window.print).toHaveBeenCalledTimes(1);
});

test("ohne Turnier-Recht: keine Liste zur Wahl, auch nicht über die Adresse, und keine Anfrage an den Server", async () => {
  serve({ canCheckIn: false });
  renderAt("/print/tournaments/herbst-cup?teile=liste,baum");
  expect(await screen.findByTestId("print-sheet-baum")).toBeInTheDocument();
  expect(screen.queryByTestId("print-part-liste")).not.toBeInTheDocument();
  expect(screen.queryByTestId("print-sheet-liste")).not.toBeInTheDocument();
  expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/tournaments/t1/print/checkin");
});

test("mit Turnier-Recht: Check-in-Liste mit Kästchen und Live-Link zur Turnierleitung", async () => {
  serve({ canCheckIn: true });
  renderAt("/print/tournaments/herbst-cup?teile=liste");
  expect(await screen.findByTestId("print-sheet-liste")).toBeInTheDocument();
  const rows = await screen.findAllByTestId("print-checkin-row");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("Anna");
  expect(screen.getByLabelText("schon da")).toBeInTheDocument();
  expect(screen.getByTestId("branded-qr-code").dataset.value).toBe(`${window.location.origin}/tournaments/herbst-cup/leitung`);
  await waitFor(() => expect(screen.queryByTestId("print-sheet-baum")).not.toBeInTheDocument());
});

test("Wechsel zu einem anderen Turnier: nichts vom vorigen bleibt stehen (keine Liste von A unter dem Kopf von B)", async () => {
  serve({ canCheckIn: true });
  const fallback = apiMock.get.getMockImplementation();
  // B lädt langsam: solange darf weder Kopf noch Liste von A zu sehen sein.
  apiMock.get.mockImplementation((url) => (url.startsWith("/tournaments/winter-cup") ? new Promise(() => {}) : fallback(url)));
  render(
    <MemoryRouter initialEntries={["/print/tournaments/herbst-cup?teile=liste"]}>
      <Routes><Route path="/print/tournaments/:slug" element={<><Link to="/print/tournaments/winter-cup?teile=liste">weiter</Link><PrintPage scope="tournament" /></>} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("print-checkin-row")).toHaveTextContent("Anna");
  await userEvent.click(screen.getByText("weiter"));
  await waitFor(() => expect(screen.queryByTestId("print-checkin-row")).not.toBeInTheDocument());
  expect(screen.queryByText("Herbst-Cup")).not.toBeInTheDocument();
  expect(screen.getByTestId("print-loading")).toBeInTheDocument();
});
