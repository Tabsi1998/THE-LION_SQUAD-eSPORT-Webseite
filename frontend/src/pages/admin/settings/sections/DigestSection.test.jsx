import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// E-Mail → Sammel-Mail (#1662): Vorgaben laden, ändern, speichern; die Vorschau steht ohne Skripte im Rahmen.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DigestSection } = await import("./DigestSection");

const SETTINGS = { default_rhythm: "instant", daily_time: "07:00", weekly_weekday: 0, weekly_time: "07:00" };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => ({
    data: url.endsWith("/preview")
      ? { subject: "Deine Sammel-Mail: 4 Neuigkeiten", html: "<html><body>Hallo Paula</body></html>" }
      : { settings: SETTINGS, defaults: SETTINGS, schedules: {} },
  }));
  apiMock.put.mockImplementation(async (_url, body) => ({ data: { settings: body, defaults: SETTINGS, schedules: {} } }));
});

test("lädt die Vorgaben, speichert erst nach einer Änderung und schickt alles zusammen", async () => {
  render(<DigestSection />);
  expect(await screen.findByTestId("digest-default-instant")).toBeChecked();
  expect(screen.getByTestId("digest-save")).toBeDisabled();
  fireEvent.click(screen.getByTestId("digest-default-daily"));
  fireEvent.change(screen.getByTestId("digest-daily-time"), { target: { value: "18:00" } });
  fireEvent.change(screen.getByTestId("digest-weekday"), { target: { value: "6" } });
  fireEvent.click(screen.getByTestId("digest-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/notification-digest",
    { default_rhythm: "daily", daily_time: "18:00", weekly_weekday: 6, weekly_time: "07:00" }));
  await waitFor(() => expect(screen.getByTestId("digest-save")).toBeDisabled());
});

test("eine leere Uhrzeit lässt nicht speichern", async () => {
  render(<DigestSection />);
  fireEvent.change(await screen.findByTestId("digest-weekly-time"), { target: { value: "" } });
  expect(screen.getByTestId("digest-time-error")).toHaveTextContent("Uhrzeit wie 07:00");
  expect(screen.getByTestId("digest-save")).toBeDisabled();
});

test("die Vorschau steht mit Betreff in einem Rahmen ohne Skripte", async () => {
  render(<DigestSection />);
  const frame = await screen.findByTestId("digest-preview-frame");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain("Hallo Paula");
  expect(screen.getByTestId("digest-preview-subject")).toHaveTextContent("Deine Sammel-Mail: 4 Neuigkeiten");
});
