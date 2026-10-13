import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Eventliste (#1373): „Rückblick schreiben“ gibt es erst nach dem Event, dann als ersten Knopf der Zeile und in der
// Karte am Handy. Die Sichtbarkeit steht in Worten aus der Server-Liste, nie als Rohwert.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() };
const navigateMock = vi.fn();
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-router-dom", async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigateMock }));

const AdminEventsPage = (await import("./AdminEventsPage")).default;

const META = {
  types: [{ k: "lan_party", l: "LAN-Party" }],
  statuses: [{ k: "scheduled", l: "Angekündigt" }, { k: "completed", l: "Beendet" }],
  visibilities: [{ k: "public", l: "Öffentlich", short: "Alle" }, { k: "members", l: "Nur Vereinsmitglieder", short: "Mitglieder" }],
};
const EVENTS = [
  { id: "past", name: "Sommer-LAN", slug: "sommer-lan", status: "scheduled", event_type: "lan_party", visibility: "members",
    start_date: "2026-07-10T10:00:00+02:00", days: [{ end_at: "2026-07-10T20:00:00+00:00" }, { end_at: "2026-07-12T14:00:00+00:00" }],
    end_date: "2026-07-12T14:00:00+00:00" },
  { id: "future", name: "Winter-LAN", slug: "winter-lan", status: "scheduled", event_type: "lan_party", visibility: "public",
    start_date: "2099-12-18T10:00:00+01:00", end_date: "2099-12-19T18:00:00+01:00" },
];

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/meta") return { data: META };
    if (url.startsWith("/events?")) return { data: EVENTS };
    return { data: [] };
  });
  apiMock.post.mockReset();
  navigateMock.mockReset();
});

function renderList() {
  return render(<MemoryRouter><AdminEventsPage /></MemoryRouter>);
}

test("Rückblick nur beim vergangenen Event – als erster Knopf, legt den Entwurf an und öffnet ihn", async () => {
  apiMock.post.mockResolvedValue({ data: { created: true, post: { id: "n1" } } });
  renderList();
  const recap = await screen.findByTestId("event-recap-past");
  expect(recap).toHaveTextContent("Rückblick schreiben");
  expect(screen.queryByTestId("event-recap-future")).toBeNull();
  const actions = recap.closest("td");
  expect(within(actions).getAllByRole("button")[0]).toBe(recap);

  fireEvent.click(recap);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events/past/recap-draft"));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/admin/news/n1"));
});

test("Handy-Karten: Rückblick in der Karte nur beim vergangenen Event", async () => {
  renderList();
  const pastCard = await screen.findByTestId("event-card-past");
  expect(within(pastCard).getByTestId("event-card-recap-past")).toBeInTheDocument();
  expect(within(screen.getByTestId("event-card-future")).queryByText("Rückblick schreiben")).toBeNull();
  expect(pastCard).toHaveTextContent("Sichtbar für: Mitglieder");
});

test("Sichtbarkeit in Worten, kein Rohwert in der Liste", async () => {
  renderList();
  expect(await screen.findByTestId("event-visibility-past")).toHaveTextContent("Mitglieder");
  expect(screen.getByTestId("event-visibility-future")).toHaveTextContent("Alle");
  expect(screen.queryByText(/^members$/i)).toBeNull();
  expect(screen.queryByText(/^public$/i)).toBeNull();
  expect(screen.queryByText("VEREINS-CMS")).toBeNull();
});
