import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// #1230: die Fehlerseite verlinkt Admins mit der Kennung der Meldung hierher (?tab=app&q=…) - die Suche startet
// damit, und der aufgeklappte Eintrag zeigt die Kennung zum Abgleichen.

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { AppLogsTab } = await import("./AppLogsTab");

const LOG = { id: "log-4711-abcd", level: "error", status: "open", priority: "high", message: "liste.map is not a function", source: "web", screen: "/servers", platform: "web", received_at: "2026-10-07T10:15:30Z", username: "admin" };

test("übernimmt die Kennung aus der Adresse in die Suche und zeigt sie im Eintrag", async () => {
  apiMock.get.mockResolvedValue({ data: [LOG] });
  render(<MemoryRouter initialEntries={["/admin/ops?tab=app&q=log-4711"]}><AppLogsTab /></MemoryRouter>);
  expect(await screen.findByText("liste.map is not a function")).toBeInTheDocument();
  expect(apiMock.get.mock.calls[0][0]).toContain("q=log-4711");
  expect(screen.getByPlaceholderText(/Kennung suchen/)).toHaveValue("log-4711");
  fireEvent.click(screen.getByText("liste.map is not a function"));
  expect(screen.getByTestId("app-log-id-log-4711-abcd")).toHaveTextContent("log-4711-abcd");
});
