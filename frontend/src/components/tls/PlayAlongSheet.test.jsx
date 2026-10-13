import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Spielst du auch mit?“ (#1184): Haken je Einzel-Turnier, Hinweise für Team und Fast Lap, „Nein danke“ ohne Rückfrage
// und das Ergebnis je Eintrag.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));

const { PlayAlongSheet } = await import("./PlayAlongSheet");

const SOLO = { kind: "tournament", id: "t1", slug: "lan-cup", title: "LAN-Cup", start_date: "2026-10-31T14:00:00+00:00", mode: "Einzel", game: "Rocket League",
  team: false, fee: { total_cents: 1000, currency: "EUR" }, spots_left: 3, full: false, selectable: true, reason: null, captain: false, my_status: null };
const FULL = { ...SOLO, id: "t2", slug: "mini", title: "Mini-Cup", fee: null, spots_left: 0, full: true };
const TEAM = { ...SOLO, id: "t3", slug: "team-cup", title: "Team-Cup", mode: "Team", team: true, fee: null, selectable: false, reason: "Dein Kapitän meldet das Team an." };
const LAP = { kind: "fastlap", id: "f1", slug: "lap", title: "LAN Fast Lap", mode: "Bestzeit fahren", selectable: false, reason: "Keine Anmeldung nötig – du fährst einfach deine Bestzeit." };
const EVENT = { id: "e1", schedule: { multi_day: false } };

function renderSheet({ entries, show = true, from = "" } = {}) {
  apiMock.get.mockResolvedValue({ data: { show, entries } });
  const onClose = vi.fn();
  render(<MemoryRouter><PlayAlongSheet event={EVENT} from={from} onClose={onClose} /></MemoryRouter>);
  return onClose;
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("ohne Turniere und Fast Laps gibt es den Schritt nicht", async () => {
  const onClose = renderSheet({ entries: [], show: false });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(screen.queryByTestId("play-along-sheet")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/events/e1/play-along");
});

test("Haken nur bei Einzel-Turnieren; Team-Turnier und Fast Lap als Hinweis", async () => {
  renderSheet({ entries: [SOLO, TEAM, LAP] });
  const sheet = await screen.findByTestId("play-along-sheet");
  expect(sheet).toHaveAttribute("role", "dialog");
  expect(screen.getByRole("heading", { name: "Spielst du auch mit?" })).toBeInTheDocument();
  const box = screen.getByLabelText(/LAN-Cup/);
  expect(box).toHaveAttribute("type", "checkbox");
  expect(screen.getByTestId("play-along-row-t1")).toHaveTextContent("Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei");
  expect(screen.queryByTestId("play-along-check-t3")).toBeNull();
  expect(screen.getByTestId("play-along-note-t3")).toHaveTextContent("Dein Kapitän meldet das Team an.");
  expect(screen.queryByTestId("play-along-team-t3")).toBeNull();
  expect(screen.queryByTestId("play-along-check-f1")).toBeNull();
  expect(screen.getByTestId("play-along-note-f1")).toHaveTextContent("Keine Anmeldung nötig");
});

test("Kapitäne bekommen den Link zur Team-Anmeldung", async () => {
  renderSheet({ entries: [{ ...TEAM, captain: true, reason: "Melde dein Team auf der Turnierseite an." }] });
  const link = await screen.findByTestId("play-along-team-t3");
  expect(link).toHaveAttribute("href", "/tournaments/team-cup");
  expect(screen.queryByTestId("play-along-submit")).toBeNull();
});

test("„Nein danke“ beendet ohne Rückfrage und ohne Anmeldung", async () => {
  const onClose = renderSheet({ entries: [SOLO] });
  fireEvent.click(await screen.findByTestId("play-along-skip"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Anmelden erst mit Regeln und Kosten; danach das Ergebnis je Eintrag mit Summe", async () => {
  renderSheet({ entries: [SOLO, FULL], from: "lan-cup" });
  expect(await screen.findByTestId("play-along-check-t1")).toBeChecked();
  fireEvent.click(screen.getByTestId("play-along-check-t2"));
  expect(screen.getByTestId("play-along-sum")).toHaveTextContent("10,00 €");
  const submit = screen.getByTestId("play-along-submit");
  expect(submit).toHaveTextContent("Anmelden (2)");
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByTestId("play-along-rules"));
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByTestId("play-along-costs"));
  expect(submit).toBeEnabled();

  apiMock.post.mockResolvedValue({ data: {
    results: [
      { id: "t1", title: "LAN-Cup", state: "registered", label: "Du bist dabei", detail: null, price: { total_cents: 1000, currency: "EUR" } },
      { id: "t2", title: "Mini-Cup", state: "waitlist", label: "Warteliste", detail: null, price: null },
    ],
    total_cents: 1000, currency: "EUR",
  } });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(await screen.findByTestId("play-along-result")).toBeInTheDocument();
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(apiMock.post).toHaveBeenCalledWith("/events/e1/play-along", { tournament_ids: ["t1", "t2"], accept_rules: true, accept_privacy: true, accept_costs: true });
  expect(screen.getByTestId("play-along-result-t1")).toHaveAttribute("data-state", "registered");
  expect(screen.getByTestId("play-along-result-t1")).toHaveTextContent("Du bist dabei · 10,00 €");
  expect(screen.getByTestId("play-along-result-t2")).toHaveTextContent("Warteliste");
  expect(screen.getByTestId("play-along-total")).toHaveTextContent("10,00 €");
  expect(screen.getByText("1 angemeldet, 1 auf der Warteliste.")).toBeInTheDocument();
  expect(screen.getByTestId("play-along-done")).toHaveTextContent("Zurück zum Turnier");
});

test("ein Fehler steht mit Grund beim Eintrag", async () => {
  renderSheet({ entries: [SOLO] });
  fireEvent.click(await screen.findByTestId("play-along-check-t1"));
  fireEvent.click(screen.getByTestId("play-along-rules"));
  fireEvent.click(screen.getByTestId("play-along-costs"));
  apiMock.post.mockResolvedValue({ data: { results: [{ id: "t1", title: "LAN-Cup", state: "error", label: "Nicht angemeldet", detail: "Für dieses Turnier fehlen Pflicht-IDs: Epic-ID", price: null }], total_cents: 0, currency: "EUR" } });
  fireEvent.click(screen.getByTestId("play-along-submit"));
  const row = await screen.findByTestId("play-along-result-t1");
  expect(row).toHaveAttribute("data-state", "error");
  expect(row).toHaveTextContent("Für dieses Turnier fehlen Pflicht-IDs: Epic-ID");
  expect(screen.queryByTestId("play-along-total")).toBeNull();
  expect(screen.getByTestId("play-along-done")).toHaveTextContent("Fertig");
});

test("geschlossene oder deaktivierte Turniere stehen ohne Haken mit Grund da", async () => {
  renderSheet({ entries: [SOLO, { ...SOLO, id: "t9", title: "Zu-Cup", selectable: false, reason: "Anmeldung für dieses Turnier geschlossen." }] });
  expect(await screen.findByTestId("play-along-check-t1")).toBeInTheDocument();
  expect(screen.queryByTestId("play-along-check-t9")).toBeNull();
  expect(screen.getByTestId("play-along-note-t9")).toHaveTextContent("Anmeldung für dieses Turnier geschlossen.");
  expect(screen.getByTestId("play-along-row-t9")).not.toHaveTextContent("Plätze frei");
});
