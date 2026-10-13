import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// „+ Fast Lap“ im Event (#1371): mit ?event= kommt der Zeitraum vom Event, angelegt wird über das Event. Eine
// Event-Auswahl gibt es im Formular nicht mehr.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => null }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminF1NewPage = (await import("./AdminF1NewPage")).default;
const { toDateTimeLocalInput } = await import("@/lib/datetime");

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/admin/f1/new${search}`]}>
      <Routes>
        <Route path="/admin/f1/new" element={<AdminF1NewPage />} />
        <Route path="/admin/f1/:id" element={<div data-testid="f1-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("im Event: Zeitraum vom Event, Zeile statt Auswahl, Anlegen über das Event", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/events/ev-1/program"
    ? { data: { event: { id: "ev-1", name: "Herbst-LAN" }, defaults: { fastlap: { start_date: "2026-11-14T10:00:00+01:00", end_date: "2026-11-15T23:00:00+01:00" } } } }
    : { data: [] }));
  apiMock.post.mockResolvedValue({ data: { id: "f-new" } });
  renderAt("?event=ev-1");
  expect(await screen.findByTestId("f1-new-event")).toHaveTextContent("Gehört zu Herbst-LAN");
  // Das Feld zeigt die Uhrzeit des Geräts (wie überall in der Verwaltung) - erwartet wird daher dieselbe Umrechnung.
  await waitFor(() => expect(screen.getByTestId("f1-new-start")).toHaveValue(toDateTimeLocalInput("2026-11-14T10:00:00+01:00")));
  expect(screen.getByTestId("f1-new-end")).toHaveValue(toDateTimeLocalInput("2026-11-15T23:00:00+01:00"));

  fireEvent.change(screen.getByTestId("f1-new-title"), { target: { value: "LAN-Lap" } });
  fireEvent.submit(screen.getByTestId("f1-new-form"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/events/ev-1/fastlaps", expect.objectContaining({ title: "LAN-Lap" })));
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("event_id");
  expect(await screen.findByTestId("f1-detail")).toBeInTheDocument();
});
