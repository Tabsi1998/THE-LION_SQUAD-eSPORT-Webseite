import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// „Turnier anlegen“ mit Voreinstellung aus dem Leitfaden (#368): Format, Teilnahme, Teamgröße,
// Best of und Spielregel-Vorgabe sind gesetzt, ein Hinweis nennt die Turnierform; ohne
// `?preset=` ist alles wie immer, ein unbekannter Schlüssel ändert nichts.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: () => <div data-testid="markdown-editor" /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminTournamentNewPage = (await import("./AdminTournamentNewPage")).default;
const { toDateTimeLocalInput } = await import("@/lib/datetime");

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/admin/tournaments/new${search}`]}>
      <Routes><Route path="/admin/tournaments/new" element={<AdminTournamentNewPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: [] });
});

test("mit ?preset=arcade-sport sind Format, Team, Teamgröße, Best of und Spielregel gesetzt", async () => {
  renderAt("?preset=arcade-sport");
  expect(await screen.findByTestId("new-tr-preset-hint")).toHaveTextContent("Arcade-Sport 3v3");
  expect(screen.getByTestId("new-tr-format")).toHaveValue("groups");
  expect(screen.getByTestId("new-tr-mode")).toHaveValue("team");
  expect(screen.getByTestId("new-tr-team-size")).toHaveValue(3);
  expect(screen.getByTestId("new-tr-bestof")).toHaveValue(5);
  expect(screen.getByTestId("new-tr-event-mode")).toHaveValue("online");
  expect(screen.getByTestId("new-tr-result-entry-mode")).toHaveValue("player_confirmed");
});

test("Party und LAN übernimmt die Vor-Ort-Regel; ohne oder mit unbekanntem Schlüssel bleibt alles wie immer", async () => {
  renderAt("?preset=party-lan");
  expect(await screen.findByTestId("new-tr-preset-hint")).toHaveTextContent("Party und LAN");
  expect(screen.getByTestId("new-tr-event-mode")).toHaveValue("local");
  expect(screen.getByTestId("new-tr-schedule-mode")).toHaveValue("fixed_by_staff");
  expect(screen.getByTestId("new-tr-mode")).toHaveValue("solo");
  expect(screen.queryByTestId("new-tr-team-size")).not.toBeInTheDocument();
});

test("ohne Voreinstellung kein Hinweis und die Standardwerte", async () => {
  renderAt("?preset=gibt-es-nicht");
  expect(await screen.findByTestId("new-tr-format")).toHaveValue("single_elim");
  expect(screen.queryByTestId("new-tr-preset-hint")).not.toBeInTheDocument();
  expect(screen.getByTestId("new-tr-bestof")).toHaveValue(1);
});

// „+ Turnier in diesem Event“ (#1371): mit ?event= kommen Ort, Tag, Partner und Discord-Einstellungen vom Event; angelegt
// wird über das Event. Ohne Event gibt es keine Event-Auswahl mehr im Formular.
test("im Event: Vorbelegung vom Event, Ort nur als Zeile, Anlegen über das Event", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/events/ev-1/program") {
      return { data: {
        event: { id: "ev-1", name: "Herbst-LAN", window: "vom 14.11.2026 bis 15.11.2026" },
        defaults: { tournament: { start_date: "2026-11-14T10:00:00+01:00", location: "Vereinsheim · Telfs", partner_ids: [], discord_skip: true, discord_registration: false, event_mode: "local" } },
      } };
    }
    if (url === "/games") return { data: [{ id: "g1", name: "Mario Kart 8" }] };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: { id: "t-new" } });
  renderAt("?event=ev-1");
  expect(await screen.findByTestId("new-tr-event-hint")).toHaveTextContent("Herbst-LAN");
  expect(screen.getByTestId("new-tr-event")).toHaveTextContent("Gehört zu Herbst-LAN");
  // Das Feld zeigt die Uhrzeit des Geräts (wie überall in der Verwaltung) - erwartet wird daher dieselbe Umrechnung.
  await waitFor(() => expect(screen.getByTestId("new-tr-start")).toHaveValue(toDateTimeLocalInput("2026-11-14T10:00:00+01:00")));
  expect(screen.getByTestId("new-tr-discord-skip")).toBeChecked();
  expect(screen.getByTestId("new-tr-event-mode")).toHaveValue("local");
  expect(screen.getByTestId("new-tr-location-event")).toHaveTextContent("Vereinsheim · Telfs");
  expect(screen.queryByTestId("new-tr-location")).toBeNull();

  fireEvent.change(screen.getByTestId("new-tr-title"), { target: { value: "Kart-Cup" } });
  fireEvent.change(screen.getByTestId("new-tr-game"), { target: { value: "g1" } });
  fireEvent.submit(screen.getByTestId("new-tr-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events/ev-1/tournaments", expect.objectContaining({ title: "Kart-Cup", location: "Vereinsheim · Telfs", discord_skip: true })));
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("event_id");
});

test("ohne Event: keine Event-Auswahl, nur der Hinweis, angelegt über /tournaments", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/games" ? { data: [{ id: "g1", name: "Mario Kart 8" }] } : { data: [] }));
  apiMock.post.mockResolvedValue({ data: { id: "t-new" } });
  renderAt("");
  expect(await screen.findByTestId("new-tr-event")).toHaveTextContent("Gehört zu keinem Event");
  expect(screen.getByTestId("new-tr-location")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("new-tr-title"), { target: { value: "Freies Turnier" } });
  fireEvent.change(await screen.findByTestId("new-tr-game"), { target: { value: "g1" } });
  fireEvent.submit(screen.getByTestId("new-tr-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments", expect.objectContaining({ title: "Freies Turnier", requires_event_registration: false })));
  expect(apiMock.post.mock.calls.at(-1)[1]).not.toHaveProperty("event_id");
});

// Grand Final (#1549): nur beim Doppel-K.-o. wählbar, Vorgabe „mit Reset“, geht als `grand_final_mode` mit.
test("Doppel-K.-o.: Grand Final wählbar, Vorgabe mit Reset, wird mitgeschickt", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/games" ? { data: [{ id: "g1", name: "Mario Kart 8" }] } : { data: [] }));
  apiMock.post.mockResolvedValue({ data: { id: "t-new" } });
  renderAt("");
  expect(await screen.findByTestId("new-tr-format")).toHaveValue("single_elim");
  expect(screen.queryByTestId("new-tr-grand-final")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("new-tr-format"), { target: { value: "double_elim" } });
  const select = screen.getByTestId("new-tr-grand-final");
  expect(select).toHaveValue("reset");
  expect(select).toHaveTextContent("Reset");
  fireEvent.change(select, { target: { value: "single" } });
  fireEvent.change(screen.getByTestId("new-tr-title"), { target: { value: "Kart-Cup" } });
  fireEvent.change(await screen.findByTestId("new-tr-game"), { target: { value: "g1" } });
  fireEvent.submit(screen.getByTestId("new-tr-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments", expect.objectContaining({ format: "double_elim", grand_final_mode: "single" })));
});

// Weiterkommen in vier Modi (#1548, #1590): Vorgabe fester Baum; der Modus geht als advancement_mode mit, die
// Show-Minuten nur bei der Show-Auslosung.
test("Weiterkommen: Vorgabe fester Baum, der gewählte Modus wird mitgeschickt", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/games" ? { data: [{ id: "g1", name: "Mario Kart 8" }] } : { data: [] }));
  apiMock.post.mockResolvedValue({ data: { id: "t-new" } });
  renderAt("");
  const select = await screen.findByTestId("new-tr-advancement");
  expect(select).toHaveValue("fixed");
  expect(screen.getByTestId("new-tr-advancement-hint")).toHaveTextContent("Sieger aus A trifft Sieger aus B");
  expect(screen.queryByTestId("new-tr-draw-show-minutes")).toBeNull();
  fireEvent.change(select, { target: { value: "instant" } });
  expect(screen.getByTestId("new-tr-advancement-hint")).toHaveTextContent(/sofort auf einen zufälligen freien Platz/);
  fireEvent.change(select, { target: { value: "draw_show" } });
  fireEvent.change(screen.getByTestId("new-tr-draw-show-minutes"), { target: { value: "15" } });
  fireEvent.change(screen.getByTestId("new-tr-title"), { target: { value: "Kart-Cup" } });
  fireEvent.change(await screen.findByTestId("new-tr-game"), { target: { value: "g1" } });
  fireEvent.submit(screen.getByTestId("new-tr-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments", expect.objectContaining({ advancement_mode: "draw_show", draw_show_minutes: 15 })));
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("randomize_advancement_rounds");
});

// Format „Liga“ (#2111, F1): heißt „Jeder gegen jeden – Hin- und Rückrunde“, und darunter steht der Weg zur Vereinsliga.
test("Jeder gegen jeden: unter dem Format steht der Weg zur Vereinsliga", async () => {
  renderAt("");
  const format = await screen.findByTestId("new-tr-format");
  expect(screen.queryByTestId("new-tr-format-hint")).toBeNull();
  expect(format.querySelector("option[value='league']")).toHaveTextContent("Jeder gegen jeden – Hin- und Rückrunde");
  fireEvent.change(format, { target: { value: "league" } });
  expect(screen.getByTestId("new-tr-format-hint")).toHaveTextContent("Seasons, Ligen und Staffeln");
  expect(screen.getByRole("link", { name: "Admin → eSports → Liga" })).toHaveAttribute("href", "/admin/leagues");
});

// Adresse (#2111, TA1): sie folgt dem Titel Buchstabe für Buchstabe, bis jemand sie selbst ändert - vorher blieb nur der
// erste Buchstabe stehen („/tournaments/h“). Der Test tippt wirklich, statt das Feld in einem Zug zu füllen.
test("die Adresse folgt dem getippten Titel, bis sie selbst geändert wird", async () => {
  const user = userEvent.setup();
  renderAt("");
  const title = await screen.findByTestId("new-tr-title");
  await user.type(title, "Herbst Cup");
  const slug = screen.getByTestId("new-tr-slug");
  expect(slug).toHaveValue("herbst-cup");
  await user.clear(slug);
  await user.type(slug, "mein-cup ");
  expect(slug).toHaveValue("mein-cup-");
  await user.type(title, " 2026");
  expect(slug).toHaveValue("mein-cup-");
});

// Weiterkommen (#2111, T4): nur bei Formaten mit Turnierbaum; Hin- und Rückrunde hat „Spieltage auslosen“.
test("Weiterkommen nur mit Turnierbaum, bei Hin- und Rückrunde „Spieltage auslosen“", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/games" ? { data: [{ id: "g1", name: "Mario Kart 8" }] } : { data: [] }));
  apiMock.post.mockResolvedValue({ data: { id: "t-new" } });
  renderAt("");
  const format = await screen.findByTestId("new-tr-format");
  fireEvent.change(format, { target: { value: "swiss" } });
  expect(screen.queryByTestId("new-tr-advancement")).toBeNull();
  expect(screen.queryByTestId("new-tr-matchday-draw")).toBeNull();
  fireEvent.change(format, { target: { value: "league" } });
  fireEvent.click(screen.getByTestId("new-tr-matchday-draw"));
  fireEvent.change(screen.getByTestId("new-tr-title"), { target: { value: "Liga-Cup" } });
  fireEvent.change(await screen.findByTestId("new-tr-game"), { target: { value: "g1" } });
  fireEvent.submit(screen.getByTestId("new-tr-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments", expect.objectContaining({ format: "league", advancement_mode: "draw_round" })));
});