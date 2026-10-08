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
