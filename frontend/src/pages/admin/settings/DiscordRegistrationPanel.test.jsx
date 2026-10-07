import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Anmeldung im Discord (#885): ein Schalter, der sofort speichert; dazu die Zahl der Anmeldungen über Discord.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordRegistrationPanel } = await import("./DiscordRegistrationPanel");

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: { registration: { enabled: true, events: 4, tournaments: 1 } } });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
});

test("Schalter und Zähler; Ausschalten speichert sofort", async () => {
  const user = userEvent.setup();
  render(<DiscordRegistrationPanel />);
  const box = await screen.findByTestId("discord-registration-enabled");
  expect(box).toBeChecked();
  expect(screen.getByTestId("discord-registration-counts")).toHaveTextContent("4 Event-Anmeldungen, 1 Turnier-Anmeldungen");
  expect(screen.getByTestId("discord-registration")).toHaveTextContent("/anmelden");

  apiMock.get.mockResolvedValue({ data: { registration: { enabled: false, events: 4, tournaments: 1 } } });
  await user.click(box);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord", { registration: { enabled: false } }));
  await waitFor(() => expect(screen.getByTestId("discord-registration-enabled")).not.toBeChecked());
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("aus"));
});

test("ohne Stand vom Server bleibt der Kasten weg", async () => {
  apiMock.get.mockResolvedValue({ data: {} });
  const { container } = render(<DiscordRegistrationPanel />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
