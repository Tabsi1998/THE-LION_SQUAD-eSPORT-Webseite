import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ehrungen im eigenen Profil (#848): alle eigenen mit dem Hinweis, welche der Verein freigibt; der Schalter bringt sie
// aufs öffentliche Profil; ohne Verbindung oder Fähigkeit steht der Grund da.

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { HonoursPanel, HonourCard, honourDay } = await import("./HonoursPanel");

const HONORARY = { kind: "honorary", kind_label: "Ehrenmitgliedschaft", title: "Ehrenmitglied", years: 0, label: "Aufbau der Jugendarbeit", given_on: "2026-05-01", publishable: true };
const MERIT = { kind: "merit", kind_label: "Verdienstnadel", title: "Verdienstnadel in Silber", years: 0, label: "", given_on: "2026-03-14", publishable: false };

beforeEach(() => {
  vi.clearAllMocks();
});

test("Tag und Karte in Worten", () => {
  expect(honourDay("2026-05-01")).toBe("01.05.2026");
  render(<ul><HonourCard honour={{ ...HONORARY, kind: "jubilee", kind_label: "Jubiläum", title: "10 Jahre Mitgliedschaft", years: 10, label: "" }} /></ul>);
  expect(screen.getByTestId("honour-card")).toHaveTextContent("Jubiläum10 Jahre MitgliedschaftVerliehen am 01.05.2026 · 10 Jahre im Verein");
});

test("alle eigenen mit Hinweis; der Schalter bringt sie aufs Profil", async () => {
  apiMock.get.mockResolvedValue({ data: { available: true, public: false, shown: 0, honours: [HONORARY, MERIT] } });
  apiMock.put.mockResolvedValue({ data: { available: true, public: true, shown: 1, honours: [HONORARY, MERIT] } });
  render(<HonoursPanel />);
  const cards = await screen.findAllByTestId("honour-card");
  expect(cards[0]).toHaveTextContent("Darf aufs Profil");
  expect(cards[1]).toHaveTextContent("Nur für dich – der Verein gibt sie nicht frei");
  const toggle = screen.getByTestId("honours-public");
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/me/honours/public", { on: true }));
  await waitFor(() => expect(screen.getByTestId("honours-public")).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByTestId("honours-panel")).toHaveTextContent("Gerade öffentlich: 1");
  expect(toastMock.success).toHaveBeenCalledWith("Deine Ehrungen stehen jetzt auf deinem Profil.");
});

test("ohne Fähigkeit der Grund, ohne Ehrung ein klarer Satz", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Deine Verbindung erlaubt die Mitgliederakte noch nicht.", public: false, honours: [] } });
  const { unmount } = render(<HonoursPanel />);
  expect(await screen.findByTestId("honours-reason")).toHaveTextContent("Mitgliederakte noch nicht");
  expect(screen.queryByTestId("honours-public")).toBeNull();
  unmount();

  apiMock.get.mockResolvedValue({ data: { available: true, public: false, honours: [] } });
  render(<HonoursPanel />);
  expect(await screen.findByTestId("honours-empty")).toHaveTextContent("noch keine Ehrung");
});
