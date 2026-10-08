import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mitgliedskarte im Web (#346, #1335, #1256): die Karte wie auf „Mitglied werden“, daneben der QR-Code mit dem Prüflink,
// der sich vor Ablauf erneuert; „Als Bild speichern“ nimmt die Karte ohne Code; ohne Netz die zuletzt geladene Karte mit
// „Stand“ und „Prüfcode braucht Netz“; ohne gültige Karte bleibt die Stelle leer.

const apiMock = { get: vi.fn() };
const toBlobMock = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
const shareMock = vi.fn(async () => "downloaded");
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("html-to-image", () => ({ toBlob: (...args) => toBlobMock(...args) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-paula" } }) }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="qr">{value}</div> }));
vi.mock("@/lib/memberCardOffline", async () => {
  const actual = await vi.importActual("@/lib/memberCardOffline");
  return { ...actual, shareOrDownload: (...args) => shareMock(...args), storeOfflineCardImage: vi.fn(async () => true) };
});

const { MemberCardPanel } = await import("./MemberCardPanel");
const { clearOfflineCard, saveOfflineCard } = await import("@/lib/memberCardOffline");

function card(expiresInMs) {
  return {
    status: "valid", club_name: "THE LION SQUAD", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied",
    member_since: "2024-03-01", valid_until: "2026-12-31", verify_url: "https://lionsquad.at/karte/pruefen/abc123",
    token_expires_at: new Date(Date.now() + expiresInMs).toISOString(), accent_color: "#FFD700",
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearOfflineCard();
});

test("zeigt die Karte und den QR-Code mit dem Prüflink; „Code erneuern“ holt einen neuen", async () => {
  apiMock.get.mockResolvedValue({ data: card(5 * 60 * 1000) });
  const user = userEvent.setup();
  render(<MemberCardPanel />);
  expect(await screen.findByTestId("member-card")).toBeInTheDocument();
  expect(screen.getByTestId("qr")).toHaveTextContent("https://lionsquad.at/karte/pruefen/abc123");
  expect(screen.getByTestId("member-card-art")).toHaveTextContent("PaulaNr. TLS-0007 · seit 2024Ordentliches Mitglied · gültig bis 31.12.2026");
  expect(screen.getByText("Gültig bis 31.12.2026")).toBeInTheDocument();
  expect(screen.queryByTestId("member-card-art-offline")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledTimes(1);

  await user.click(screen.getByTestId("member-card-refresh"));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  expect(apiMock.get).toHaveBeenLastCalledWith("/account/member-card");
});

test("„Als Bild speichern“: die Karte ohne gültigen Prüfcode, am Handy teilen, sonst herunterladen", async () => {
  apiMock.get.mockResolvedValue({ data: card(5 * 60 * 1000) });
  const user = userEvent.setup();
  render(<MemberCardPanel />);
  await screen.findByTestId("member-card");
  await user.click(screen.getByTestId("member-card-save-image"));
  await waitFor(() => expect(shareMock).toHaveBeenCalledWith(expect.any(Blob), "mitgliedskarte.png"));
  const node = toBlobMock.mock.calls.at(-1)[0];
  expect(node).toBe(screen.getByTestId("member-card-image"));
  expect(node).toHaveTextContent("Prüfcode braucht Netz");
  expect(node.textContent).not.toContain("abc123");
  expect(node.querySelector("[data-testid=qr]")).toBeNull();
});

test("ohne Netz: die zuletzt geladene Karte mit Stand und „Prüfcode braucht Netz“", async () => {
  saveOfflineCard("u-paula", card(60 * 1000), new Date("2026-10-07T16:05:00Z"));
  apiMock.get.mockRejectedValue(new Error("Network Error"));
  render(<MemberCardPanel />);
  expect(await screen.findByTestId("member-card-offline")).toHaveTextContent("Stand: 7.10.2026, 18:05");
  expect(screen.getByTestId("member-card-art-offline")).toHaveTextContent("Prüfcode braucht Netz");
  expect(screen.queryByTestId("qr")).toBeNull();
});

test("ohne Netz und ohne gespeicherte Karte ein Hinweis; ohne gültige Karte bleibt die Stelle leer", async () => {
  apiMock.get.mockRejectedValue(new Error("Network Error"));
  const { unmount } = render(<MemberCardPanel />);
  expect(await screen.findByTestId("member-card-error")).toHaveTextContent("Die Karte konnte gerade nicht geladen werden.");
  unmount();
  apiMock.get.mockResolvedValue({ data: { status: "none", club_name: "THE LION SQUAD" } });
  const { container } = render(<MemberCardPanel />);
  await vi.waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});

test("erneuert den Code von selbst, bevor er abläuft", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    apiMock.get.mockResolvedValue({ data: card(90 * 1000) });
    render(<MemberCardPanel />);
    expect(await screen.findByTestId("member-card")).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 1000); });
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
