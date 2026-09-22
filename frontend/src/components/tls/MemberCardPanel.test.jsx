import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mitgliedskarte im Web (#346): QR-Code mit dem Prüflink, erneuert sich vor Ablauf; ohne gültige
// Karte bleibt die Stelle leer.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="qr">{value}</div> }));

const { MemberCardPanel } = await import("./MemberCardPanel");

function card(expiresInMs) {
  return {
    status: "valid", club_name: "THE LION SQUAD", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied",
    member_since: "2024-03-01", valid_until: "2026-12-31", verify_url: "https://lionsquad.at/karte/pruefen/abc123",
    token_expires_at: new Date(Date.now() + expiresInMs).toISOString(), accent_color: "#FFD700",
  };
}

beforeEach(() => vi.clearAllMocks());

test("zeigt Karte und QR-Code mit dem Prüflink; „Code erneuern“ holt einen neuen", async () => {
  apiMock.get.mockResolvedValue({ data: card(5 * 60 * 1000) });
  const user = userEvent.setup();
  render(<MemberCardPanel />);
  expect(await screen.findByTestId("member-card")).toBeInTheDocument();
  expect(screen.getByTestId("qr")).toHaveTextContent("https://lionsquad.at/karte/pruefen/abc123");
  expect(screen.getByText("TLS-0007")).toBeInTheDocument();
  expect(screen.getByText("Gültig bis 31.12.2026")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledTimes(1);

  await user.click(screen.getByTestId("member-card-refresh"));
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  expect(apiMock.get).toHaveBeenLastCalledWith("/account/member-card");
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

test("ohne gültige Karte bleibt die Stelle leer", async () => {
  apiMock.get.mockResolvedValue({ data: { status: "none", club_name: "THE LION SQUAD" } });
  const { container } = render(<MemberCardPanel />);
  await vi.waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
