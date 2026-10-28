import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// AMP-Panel (#2112): Zugang eintragen, testen, Passwort entfernen - das Passwort kommt nie zurück.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { AmpPanelCard } = await import("./AmpPanelCard");

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  apiMock.get.mockResolvedValue({ data: { base_url: "https://amp.example.test", username: "website", enabled: true, configured: true } });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
  apiMock.post.mockResolvedValue({ data: { ok: true, instance_count: 2, instances: [{ name: "Minecraft" }, { name: "Valheim" }] } });
});

test("lädt erst beim Aufklappen; Speichern ohne Passwort behält das gespeicherte", async () => {
  render(<AmpPanelCard />);
  expect(apiMock.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("amp-panel-toggle"));
  await waitFor(() => expect(screen.getByTestId("amp-base-url")).toHaveValue("https://amp.example.test"));
  expect(screen.getByTestId("amp-password")).toHaveValue("");
  fireEvent.change(screen.getByTestId("amp-username"), { target: { value: " leser " } });
  fireEvent.click(screen.getByTestId("amp-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/amp", { base_url: "https://amp.example.test", username: "leser", enabled: true }));
});

test("ein neues Passwort geht mit; http wird abgelehnt", async () => {
  render(<AmpPanelCard />);
  fireEvent.click(screen.getByTestId("amp-panel-toggle"));
  await screen.findByDisplayValue("https://amp.example.test");
  fireEvent.change(screen.getByTestId("amp-password"), { target: { value: "platzhalter" } });
  fireEvent.click(screen.getByTestId("amp-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/amp", expect.objectContaining({ password: "platzhalter" })));
  fireEvent.change(screen.getByTestId("amp-base-url"), { target: { value: "http://amp.example.test" } });
  fireEvent.click(screen.getByTestId("amp-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Die AMP-Adresse beginnt mit https://."));
  expect(apiMock.put).toHaveBeenCalledTimes(1);
});

test("Verbindung testen zeigt die Instanzen; Passwort entfernen fragt nach", async () => {
  render(<AmpPanelCard />);
  fireEvent.click(screen.getByTestId("amp-panel-toggle"));
  await screen.findByDisplayValue("https://amp.example.test");
  fireEvent.click(screen.getByTestId("amp-test"));
  expect(await screen.findByTestId("amp-test-result")).toHaveTextContent("Verbunden: 2 Instanzen – Minecraft, Valheim.");
  fireEvent.click(screen.getByTestId("amp-clear-password"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/amp", { clear_password: true, enabled: true }));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "AMP-Passwort entfernen?" }));
});

test("ohne gespeichertes Passwort: kein Test, kein Entfernen", async () => {
  apiMock.get.mockResolvedValue({ data: { configured: false } });
  render(<AmpPanelCard />);
  fireEvent.click(screen.getByTestId("amp-panel-toggle"));
  await waitFor(() => expect(screen.getByTestId("amp-test")).toBeDisabled());
  expect(screen.queryByTestId("amp-clear-password")).toBeNull();
});

test("neue Adresse ohne neues Passwort: Hinweis statt Speichern (#2112)", async () => {
  render(<AmpPanelCard />);
  fireEvent.click(screen.getByTestId("amp-panel-toggle"));
  await screen.findByDisplayValue("https://amp.example.test");
  expect(screen.queryByTestId("amp-password-needed")).toBeNull();
  fireEvent.change(screen.getByTestId("amp-base-url"), { target: { value: "https://neu.example.test" } });
  expect(screen.getByTestId("amp-password-needed")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("amp-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Neue Adresse: bitte das Passwort neu eintragen."));
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("amp-password"), { target: { value: "platzhalter" } });
  fireEvent.click(screen.getByTestId("amp-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/amp", expect.objectContaining({ base_url: "https://neu.example.test", password: "platzhalter" })));
});