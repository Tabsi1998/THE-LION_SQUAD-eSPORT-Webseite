import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// „Passwort vergessen“ mit Spamschutz (#2067): Token beim Laden holen, mit dem unsichtbaren Feld mitschicken.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ForgotPasswordPage } = await import("./PasswordRecoveryPage");

const TOKEN = "forgot_password.1700000000.0123456789abcdef.sig";

test("Token wird geholt und mitgeschickt, das unsichtbare Feld ist da, aber nicht zu sehen", async () => {
  apiMock.get.mockResolvedValue({ data: { token: TOKEN, honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null } });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const user = userEvent.setup();
  render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "forgot_password" } }));
  expect(screen.getByTestId("forgot-honeypot")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByTestId("forgot-honeypot-input")).toHaveAttribute("autocomplete", "off");
  expect(screen.queryByRole("textbox", { name: /Fax/ })).toBeNull();
  await user.type(screen.getByTestId("forgot-email"), "paula@lionsquad-test.at");
  await user.click(screen.getByTestId("forgot-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/forgot-password", {
    email: "paula@lionsquad-test.at", form_token: TOKEN, hp_fax: "",
  }));
});
