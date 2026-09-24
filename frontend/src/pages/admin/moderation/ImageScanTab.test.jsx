import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Bildprüfung (#415): Stand und Schwellen laden (als Prozent), Speichern schickt Bruchzahlen; die
// Warteschlange zeigt Vorschau, Werte und Absender; Freigeben und Entfernen gehen mit Notiz an den Server.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (v) => `https://api.test${v}` }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: ImageScanTab, settingsPayload, percent } = await import("./ImageScanTab");

const STATUS = {
  settings: { provider: "local", review_threshold: 0.6, block_threshold: 0.85, strike_on_block: true, retention_days: 90, google_api_key_masked: false },
  health: { provider: "local", label: "Selbst gehostet (NudeNet)", ok: true, detail: "" },
  counts_30d: { pending: 0, safe: 12, review: 2, blocked: 1, failed: 0 },
  pending: 0, review_open: 1, last_scanned_at: "2026-09-24T08:00:00Z", last_provider: "local",
};
const ROW = {
  id: "s1", kind: "chat", kind_label: "Chat-Bild", context_label: "Team-Chat", state: "review", scores: { nudity: 0.71, violence: 0.02, racy: 0.3 },
  provider: "local", provider_label: "Selbst gehostet (NudeNet)", created_at: "2026-09-24T08:00:00Z", owner: { id: "u1", username: "paula", display_name: "Paula" },
  preview_url: "/api/moderation/media-scan/s1/preview", note: null, error: null, decided_by: "system",
};

beforeEach(() => {
  apiMock.put.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/moderation/media-scan/status") return { data: STATUS };
    if (url.startsWith("/moderation/media-scan/queue?state=review")) return { data: [ROW] };
    if (url.startsWith("/moderation/media-scan/queue?state=blocked")) return { data: [{ ...ROW, id: "s2", state: "blocked", preview_url: null }] };
    return { data: [] };
  });
});

test("Stand, Schwellen in Prozent und Speichern als Bruchzahl", async () => {
  apiMock.put.mockResolvedValue({ data: { ...STATUS.settings, review_threshold: 0.5, block_threshold: 0.9 } });
  render(<ImageScanTab />);
  expect(await screen.findByTestId("image-scan-provider")).toHaveTextContent("Selbst gehostet (NudeNet)");
  expect(screen.getByTestId("image-scan-review-open")).toHaveTextContent("1 offen");
  expect(screen.getByTestId("image-scan-review")).toHaveValue(60);
  expect(screen.getByTestId("image-scan-block")).toHaveValue(85);
  expect(screen.queryByTestId("image-scan-google-key")).toBeNull();
  fireEvent.change(screen.getByTestId("image-scan-review"), { target: { value: "50" } });
  fireEvent.change(screen.getByTestId("image-scan-block"), { target: { value: "90" } });
  fireEvent.click(screen.getByTestId("image-scan-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/moderation/media-scan/settings", { provider: "local", review_threshold: 0.5, block_threshold: 0.9, strike_on_block: true, retention_days: 90 }));
  expect(toastMock.success).toHaveBeenCalledWith("Bildprüfung gespeichert.");
  fireEvent.change(screen.getByTestId("image-scan-provider-select"), { target: { value: "google_vision" } });
  expect(screen.getByTestId("image-scan-google-key")).toBeInTheDocument();
});

test("Warteschlange: Vorschau, Werte, Absender; Freigeben schickt die Notiz", async () => {
  apiMock.post.mockResolvedValue({ data: { ...ROW, state: "safe" } });
  render(<ImageScanTab />);
  const row = await screen.findByTestId("image-scan-row-s1");
  expect(row).toHaveTextContent("Prüfung nötig");
  expect(row).toHaveTextContent("Chat-Bild · Team-Chat");
  expect(row).toHaveTextContent("Paula (@paula)");
  expect(row).toHaveTextContent("Nacktheit 71 %");
  expect(screen.getByTestId("image-scan-preview-s1")).toHaveAttribute("src", "https://api.test/api/moderation/media-scan/s1/preview");
  fireEvent.change(screen.getByTestId("image-scan-note-s1"), { target: { value: "Badefoto" } });
  fireEvent.click(screen.getByTestId("image-scan-approve-s1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/moderation/media-scan/s1/approve", { note: "Badefoto" }));
  expect(toastMock.success).toHaveBeenCalledWith("Freigegeben.");

  fireEvent.click(screen.getByTestId("image-scan-filter-blocked"));
  const blocked = await screen.findByTestId("image-scan-row-s2");
  expect(blocked).toHaveTextContent("kein Bild mehr vorhanden");
  expect(screen.queryByTestId("image-scan-remove-s2")).toBeNull();
  expect(screen.getByTestId("image-scan-approve-s2")).toBeInTheDocument();
});

test("settingsPayload rechnet Prozent in Bruchzahlen um und schickt den Schlüssel nur, wenn er eingetippt ist", () => {
  expect(settingsPayload({ provider: "off", review_percent: "60", block_percent: "85", strike_on_block: false, retention_days: "30", google_api_key: "" })).toEqual({ provider: "off", review_threshold: 0.6, block_threshold: 0.85, strike_on_block: false, retention_days: 30 });
  expect(settingsPayload({ provider: "google_vision", review_percent: 60, block_percent: 120, strike_on_block: true, retention_days: 0, google_api_key: "k" })).toMatchObject({ block_threshold: 1, retention_days: 90, google_api_key: "k" });
  expect(percent(0.714)).toBe(71);
});
