import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mail-Bestätigung mit Ziel (#1225): nach dem Klick in der Mail führt „Einloggen und weiter“ mit dem Ziel zum Login -
// das Ziel kommt vom Server (beim Registrieren gemerkt) oder aus dem Link; ein fremdes Ziel zählt nicht.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const EmailVerificationPage = (await import("./EmailVerificationPage")).default;

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/verify-email" element={<EmailVerificationPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("bestätigt: „Einloggen und weiter“ mit dem Ziel vom Server", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, next: "/tournaments/mk-cup" } });
  renderAt("/verify-email?token=abc");
  const link = await screen.findByTestId("verify-continue");
  expect(link).toHaveTextContent("Einloggen und weiter");
  expect(link).toHaveAttribute("href", "/login?next=%2Ftournaments%2Fmk-cup");
  expect(apiMock.post).toHaveBeenCalledWith("/auth/verify-email", { token: "abc" });
});

test("Spamschutz (#2067): „Bestätigungslink anfordern“ holt ein Token und schickt es mit dem unsichtbaren Feld", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const { waitFor } = await import("@testing-library/react");
  apiMock.get = vi.fn(async () => ({ data: { token: "resend_verification.1700000000.0123456789abcdef.sig", honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null } }));
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const user = userEvent.setup();
  try {
    renderAt("/verify-email?email=neonfalke%40lionsquad-test.at");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "resend_verification" } }));
    expect(screen.getByTestId("verify-resend-honeypot")).toHaveAttribute("aria-hidden", "true");
    await user.click(screen.getByTestId("verify-resend-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/resend-verification", {
      email: "neonfalke@lionsquad-test.at", form_token: "resend_verification.1700000000.0123456789abcdef.sig", hp_fax: "",
    }));
  } finally {
    delete apiMock.get;
  }
});

test("das Ziel aus dem Link zählt, ein fremdes nicht", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, next: null } });
  const { unmount } = renderAt("/verify-email?token=abc&next=%2Fevents%2Fherbst-lan");
  expect(await screen.findByTestId("verify-continue")).toHaveAttribute("href", "/login?next=%2Fevents%2Fherbst-lan");
  unmount();
  renderAt("/verify-email?token=abc&next=https%3A%2F%2Ffremd.example");
  const link = await screen.findByTestId("verify-continue");
  expect(link).toHaveTextContent("Zum Login");
  expect(link).toHaveAttribute("href", "/login");
});
