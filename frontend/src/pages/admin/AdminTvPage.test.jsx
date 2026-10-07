import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// TV & Beamer (#1110): Grundwerte speichern nur, was sich geändert hat; der Baukasten baut Links mit den gewählten
// Abweichungen, beim Turnierbaum mit Anzeige-Schlüssel; Schlüssel lassen sich widerrufen. Meilenstein 59: „Ton beim
// Ergebnis“ (#1118, Standard aus) und die Stations-Ansicht (#1120) mit demselben Schlüssel.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn();
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="qr" data-value={value} /> }));

const AdminTvPage = (await import("./AdminTvPage")).default;

const DEFAULTS = { text_size: "normal", contrast: false, safe_area: 0, pixel_shift: true, season_header: true, reduce_motion: false, result_sound: false };
let keys;

beforeEach(() => {
  vi.clearAllMocks();
  keys = [{ id: "k1", label: "Beamer Halle", tournament_id: "t1", tournament_title: "Lions Herbst-Cup", created_at: "2026-10-07T10:00:00+00:00", last_used_at: null }];
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: { ...DEFAULTS, contrast: true }, defaults: DEFAULTS } };
    if (url === "/tv/keys") return { data: keys };
    if (url.startsWith("/tournaments")) return { data: [{ id: "t1", title: "Lions Herbst-Cup" }] };
    if (url.startsWith("/events")) return { data: [{ id: "e1", name: "Lions LAN Herbst" }] };
    if (url.startsWith("/f1/challenges")) return { data: [{ id: "f1", title: "Lions Fast Lap" }] };
    if (url === "/stations?tournament_id=t1") return { data: [{ id: "st-pc-3", name: "PC 3" }, { id: "st-pc-4", name: "PC 4" }] };
    return { data: [] };
  });
  apiMock.put.mockImplementation(async (_url, patch) => ({ data: { settings: { ...DEFAULTS, contrast: true, ...patch }, defaults: DEFAULTS } }));
  apiMock.post.mockResolvedValue({ data: { id: "k2", label: "Fernseher Bar", tournament_id: "t1", tournament_title: "Lions Herbst-Cup", token: "neuer-schluessel", path: "/display/bracket/t1?key=neuer-schluessel" } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  confirmMock.mockResolvedValue(true);
});

test("Grundwerte: zeigt die gespeicherten Werte, merkt Abweichungen vom Standard, speichert nur Änderungen", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  const contrast = await screen.findByTestId("tv-input-contrast");
  await waitFor(() => expect(contrast).toBeChecked());
  expect(screen.getByTestId("tv-setting-contrast")).toHaveTextContent("Standard: Aus");
  expect(screen.getByTestId("tv-setting-pixel_shift")).toHaveTextContent("Standard");
  expect(screen.getByTestId("tv-defaults-save")).toBeDisabled();

  await user.click(screen.getByTestId("tv-input-text_size-large"));
  await user.click(screen.getByTestId("tv-input-safe_area-5"));
  await user.click(screen.getByTestId("tv-defaults-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/tv/settings", { text_size: "large", safe_area: 5 }));
  expect(toastMock.success).toHaveBeenCalled();
});

test("Auf Standard fragt nach und setzt alles zurück", async () => {
  const user = userEvent.setup();
  apiMock.delete.mockResolvedValueOnce({ data: { settings: DEFAULTS, defaults: DEFAULTS } });
  render(<AdminTvPage />);
  await waitFor(() => expect(screen.getByTestId("tv-input-contrast")).toBeChecked());
  await user.click(screen.getByTestId("tv-defaults-reset"));
  expect(confirmMock).toHaveBeenCalled();
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/tv/settings"));
  await waitFor(() => expect(screen.getByTestId("tv-input-contrast")).not.toBeChecked());
});

test("Baukasten: Event-Link mit Abweichung, ohne Schlüssel", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  await user.click(screen.getByTestId("tv-view-event"));
  await waitFor(() => expect(within(screen.getByTestId("tv-target")).getByText("Lions LAN Herbst")).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId("tv-target"), "e1");
  await user.selectOptions(screen.getByTestId("tv-override-input-season_header"), "false");
  const link = screen.getByTestId("tv-link").textContent;
  expect(link).toBe(`${window.location.origin}/display/event/e1?season_header=0`);
  expect(screen.getByTestId("qr")).toHaveAttribute("data-value", link);
  expect(screen.getByTestId("tv-link-result")).toHaveTextContent("Jahreszeiten in der TV-Kopfleiste Aus");
});

test("Baukasten: der Turnierbaum braucht erst einen Schlüssel, dann trägt der Link ihn", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  await waitFor(() => expect(within(screen.getByTestId("tv-target")).getByText("Lions Herbst-Cup")).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId("tv-target"), "t1");
  expect(screen.getByTestId("tv-link-missing")).toHaveTextContent("Link erstellen");
  await user.type(screen.getByTestId("tv-key-label"), "Fernseher Bar");
  await user.click(screen.getByTestId("tv-key-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tv/keys", { tournament_id: "t1", label: "Fernseher Bar" }));
  const link = await screen.findByTestId("tv-link");
  expect(link.textContent).toBe(`${window.location.origin}/display/bracket/t1?key=neuer-schluessel`);
  // Eine Abweichung ändert den Link, der Schlüssel bleibt.
  await user.selectOptions(screen.getByTestId("tv-override-input-contrast"), "true");
  expect(screen.getByTestId("tv-link").textContent).toBe(`${window.location.origin}/display/bracket/t1?key=neuer-schluessel&contrast=1`);
});

test("vorhandenen Link übernehmen: Ansicht, Ziel, Schlüssel und Abweichungen", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  await user.type(screen.getByTestId("tv-link-paste"), "https://club.example/display/bracket/t1?key=alt&text_size=large");
  await user.click(screen.getByTestId("tv-link-takeover"));
  expect(screen.getByTestId("tv-override-input-text_size")).toHaveValue("large");
  expect(screen.getByTestId("tv-link").textContent).toBe(`${window.location.origin}/display/bracket/t1?key=alt&text_size=large`);
});

test("aus der Turnier-Bearbeitung: Ansicht und Turnier stehen schon da", async () => {
  window.history.pushState({}, "", "/admin/tv?view=bracket&target=t1");
  try {
    render(<AdminTvPage />);
    await waitFor(() => expect(screen.getByTestId("tv-target")).toHaveValue("t1"));
    expect(screen.getByTestId("tv-link-missing")).toHaveTextContent("Link erstellen");
  } finally {
    window.history.pushState({}, "", "/");
  }
});

test("Schlüssel-Liste: wie lange er gilt - eine Woche nach dem Turnier, sonst bis zum Widerruf", async () => {
  keys = [
    { ...keys[0], expires_at: "2026-10-17T18:00:00+00:00", expired: false },
    { ...keys[0], id: "k2", label: "Bar", expires_at: "2026-10-01T18:00:00+00:00", expired: true },
    { ...keys[0], id: "k3", label: "Foyer", expires_at: null, expired: false },
  ];
  render(<AdminTvPage />);
  expect(await screen.findByTestId("tv-key-until-k1")).toHaveTextContent("gilt bis 17.10.26");
  expect(screen.getByTestId("tv-key-until-k2")).toHaveTextContent("abgelaufen");
  expect(screen.getByTestId("tv-key-until-k3")).toHaveTextContent("gilt bis zum Widerruf");
});

test("aktive Schlüssel: Liste ohne Schlüssel selbst, Widerrufen fragt nach", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  const row = await screen.findByTestId("tv-key-k1");
  expect(row).toHaveTextContent("Beamer Halle");
  expect(row).toHaveTextContent("Lions Herbst-Cup");
  expect(row).toHaveTextContent("noch nie geöffnet");
  await user.click(screen.getByTestId("tv-key-revoke-k1"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Widerrufen" }));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/tv/keys/k1"));
});

test("Ton beim Ergebnis: Standard aus, einschalten speichert nur diesen Wert", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  const sound = await screen.findByTestId("tv-input-result_sound");
  await waitFor(() => expect(screen.getByTestId("tv-input-contrast")).toBeChecked());
  expect(sound).not.toBeChecked();
  expect(screen.getByTestId("tv-setting-result_sound")).toHaveTextContent("Ton beim Ergebnis");
  expect(screen.getByTestId("tv-setting-result_sound")).toHaveTextContent("Für Ton einmal klicken");
  await user.click(sound);
  await user.click(screen.getByTestId("tv-defaults-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/tv/settings", { result_sound: true }));
});

test("Stations-Ansicht: Turnier und Station wählen - der Link trägt den Schlüssel des Turniers", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  await user.click(screen.getByTestId("tv-view-station"));
  await waitFor(() => expect(within(screen.getByTestId("tv-target")).getByText("Lions Herbst-Cup")).toBeInTheDocument());
  expect(screen.getByTestId("tv-station")).toBeDisabled();
  await user.selectOptions(screen.getByTestId("tv-target"), "t1");
  await waitFor(() => expect(within(screen.getByTestId("tv-station")).getByText("PC 3")).toBeInTheDocument());
  expect(screen.getByTestId("tv-link-missing")).toHaveTextContent("Station auswählen");
  await user.selectOptions(screen.getByTestId("tv-station"), "st-pc-3");
  await user.click(screen.getByTestId("tv-key-create"));
  const link = await screen.findByTestId("tv-link");
  expect(link.textContent).toBe(`${window.location.origin}/display/bracket/t1/station/st-pc-3?key=neuer-schluessel`);
  // Dieselbe Abweichung wie beim Turnierbaum, zum Beispiel Ton nur an diesem Bildschirm.
  await user.selectOptions(screen.getByTestId("tv-override-input-result_sound"), "true");
  expect(screen.getByTestId("tv-link").textContent).toBe(`${window.location.origin}/display/bracket/t1/station/st-pc-3?key=neuer-schluessel&result_sound=1`);
});

test("einen Stations-Link übernehmen: Ansicht, Turnier, Station und Schlüssel bleiben", async () => {
  const user = userEvent.setup();
  render(<AdminTvPage />);
  await user.type(screen.getByTestId("tv-link-paste"), "https://club.example/display/bracket/t1/station/st-pc-4?key=alt&contrast=1");
  await user.click(screen.getByTestId("tv-link-takeover"));
  await waitFor(() => expect(screen.getByTestId("tv-station")).toHaveValue("st-pc-4"));
  expect(screen.getByTestId("tv-link").textContent).toBe(`${window.location.origin}/display/bracket/t1/station/st-pc-4?key=alt&contrast=1`);
});
