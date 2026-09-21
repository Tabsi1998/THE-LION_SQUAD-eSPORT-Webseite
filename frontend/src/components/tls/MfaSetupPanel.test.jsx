import { render, screen, waitFor } from "@testing-library/react";

// Zwei-Faktor (#348): freiwillig für alle, Pflicht nur, wenn das Konto einen Adminbereich hat –
// und das sagt der Server, nicht die Rolle (Freigabe, Vorstandsposten, Dolibarr-Funktion).

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => <div /> }));

const { MfaSetupPanel } = await import("./MfaSetupPanel");

beforeEach(() => vi.clearAllMocks());

test("ein Spieler darf Zwei-Faktor einrichten, und es steht da, dass es freiwillig ist", async () => {
  apiMock.get.mockResolvedValue({ data: { required_for_admin: false, enabled: false, session_verified: false, recovery_codes_remaining: 0 } });
  render(<MfaSetupPanel onChanged={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("profile-mfa-intro")).toHaveTextContent("Freiwillig"));
  expect(screen.getByText("MFA einrichten")).toBeInTheDocument();
  expect(screen.queryByText(/bleibt dein Adminbereich gesperrt/)).toBeNull();
});

test("mit einem Adminbereich – auch nur freigegeben – steht da, dass es Pflicht ist", async () => {
  apiMock.get.mockResolvedValue({ data: { required_for_admin: true, enabled: false, session_verified: false, recovery_codes_remaining: 0 } });
  render(<MfaSetupPanel onChanged={() => {}} highlight />);
  await waitFor(() => expect(screen.getByTestId("profile-mfa-intro")).toHaveTextContent("Für deinen Adminbereich Pflicht"));
  expect(screen.getByText(/bleibt dein Adminbereich gesperrt/)).toBeInTheDocument();
});
