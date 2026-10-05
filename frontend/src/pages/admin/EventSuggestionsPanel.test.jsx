import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Öffentliche Events aus Dolibarr (#850): Vorschlag übernehmen führt zum Entwurf, ausblenden nimmt ihn weg, Änderungen
// stehen als Unterschied mit Übernehmen/Ignorieren; ohne Anbindung kein Kasten.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { EventSuggestionsPanel, daysText, differenceText } = await import("./EventSuggestionsPanel");

const WINTER = { id: 4, label: "Winter-Cup", day: "2026-12-05", end_day: "2026-12-06", place: "Vereinsheim", status: "planned", registration: "external", registration_label: "Anmeldung über eine Anwendung" };
const VIEW = { live: true, fetched_at: "2026-10-05T06:00:00+00:00", error_text: "", suggestions: [WINTER], changed: [], dismissed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
});

function show() {
  return render(
    <MemoryRouter initialEntries={["/admin/events"]}>
      <Routes>
        <Route path="/admin/events" element={<EventSuggestionsPanel />} />
        <Route path="/admin/events/:id" element={<div data-testid="event-editor" />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("Tage und Unterschiede in Worten", () => {
  expect(daysText(WINTER)).toBe("05.12.2026 – 06.12.2026");
  expect(daysText({ ...WINTER, end_day: "" })).toBe("05.12.2026");
  expect(differenceText({ field: "day", label: "Tag", dolibarr: "2026-12-06", before: "2026-12-05", website: "2026-12-05" }))
    .toBe("Tag: in Dolibarr jetzt 06.12.2026 (vorher 05.12.2026), auf der Website 05.12.2026");
  expect(differenceText({ field: "status", label: "Stand", dolibarr: "cancelled", before: "planned", website: "draft" }))
    .toBe("Stand: in Dolibarr jetzt abgesagt (vorher geplant), auf der Website Entwurf");
});

test("übernehmen führt zum Entwurf", async () => {
  apiMock.get.mockResolvedValue({ data: VIEW });
  apiMock.post.mockResolvedValue({ data: { ok: true, event_id: "e-1" } });
  show();
  expect(await screen.findByTestId("event-suggestion-4")).toHaveTextContent("Winter-Cup05.12.2026 – 06.12.2026 · Vereinsheim · Anmeldung über eine Anwendung");
  fireEvent.click(screen.getByTestId("event-suggestion-adopt-4"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/event-suggestions/4/adopt"));
  expect(await screen.findByTestId("event-editor")).toBeInTheDocument();
  expect(toastMock.success).toHaveBeenCalledWith("Als Entwurf übernommen – bitte Uhrzeit und Text ergänzen.");
});

test("ausblenden und Unterschiede klären", async () => {
  const diff = { field: "place", label: "Ort", dolibarr: "Stadthalle", before: "Vereinsheim", website: "Vereinsheim, Saal 2" };
  apiMock.get.mockResolvedValue({ data: { ...VIEW, changed: [{ event_id: "e-1", event_name: "Winter-Cup", dolibarr: WINTER, differences: [diff] }] } });
  apiMock.post.mockImplementation(async (url) => ({ data: { ...VIEW, suggestions: url.endsWith("/dismiss") ? [] : VIEW.suggestions, changed: [] } }));
  show();
  expect(await screen.findByTestId("event-changed-e-1")).toHaveTextContent("Ort: in Dolibarr jetzt Stadthalle (vorher Vereinsheim), auf der Website Vereinsheim, Saal 2");
  fireEvent.click(screen.getByTestId("event-changed-ignore-4-place"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/event-suggestions/4/settle", { field: "place", take: false }));
  await waitFor(() => expect(screen.queryByTestId("event-changed-e-1")).toBeNull());
  fireEvent.click(screen.getByTestId("event-suggestion-dismiss-4"));
  await waitFor(() => expect(screen.getByTestId("event-suggestions-empty")).toBeInTheDocument());
});

test("ohne Anbindung kein Kasten", async () => {
  apiMock.get.mockResolvedValue({ data: { live: false, suggestions: [], changed: [] } });
  show();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("event-suggestions")).toBeNull();
});
