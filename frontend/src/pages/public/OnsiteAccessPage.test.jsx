import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Vor-Ort-Zugang (#1592): Die Seite hinter dem QR-Code löst den Code ein und führt zum Turnier - ohne den Code je in
// eine Adresse zu schreiben.

const apiMock = { post: vi.fn() };
const tokenMock = { peekOnsiteToken: vi.fn(), forgetOnsiteToken: vi.fn(), captureOnsiteToken: vi.fn(() => false) };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/lib/onsiteToken", () => tokenMock);
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");
const OnsiteAccessPage = (await import("./OnsiteAccessPage")).default;

function Target() {
  return <div data-testid="target-page">{window.location.pathname}</div>;
}

const renderPage = () => render(
  <MemoryRouter initialEntries={["/vor-ort"]}>
    <Routes>
      <Route path="/vor-ort" element={<OnsiteAccessPage />} />
      <Route path="/tournaments/:slug" element={<Target />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.captureOnsiteToken.mockReturnValue(false);
});

test("löst den Code im Rumpf ein und führt zum Turnier", async () => {
  tokenMock.peekOnsiteToken.mockReturnValue("code-aus-dem-qr-1234567890");
  apiMock.post.mockResolvedValue({ data: { tournament: { id: "t1", slug: "lan-cup", title: "LAN Cup" } } });
  renderPage();
  expect(await screen.findByTestId("target-page")).toBeInTheDocument();
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/onsite/redeem", { token: "code-aus-dem-qr-1234567890" });
  expect(tokenMock.forgetOnsiteToken).toHaveBeenCalled();
  expect(useDocumentTitle).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ robots: "noindex, nofollow" }));
});

test("ohne Code: neu scannen, keine Anfrage", async () => {
  tokenMock.peekOnsiteToken.mockReturnValue("");
  renderPage();
  expect(await screen.findByTestId("onsite-access-invalid")).toHaveTextContent(/neu scannen/i);
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Code gilt nicht mehr: Hinweis vom Server, kein Weiterleiten", async () => {
  tokenMock.peekOnsiteToken.mockReturnValue("alter-code-1234567890");
  apiMock.post.mockRejectedValue({ response: { status: 404, data: { detail: "Dieser Vor-Ort-Code gilt nicht (mehr)." } } });
  renderPage();
  expect(await screen.findByTestId("onsite-access-invalid")).toHaveTextContent("gilt nicht (mehr)");
  expect(screen.queryByTestId("target-page")).not.toBeInTheDocument();
});

test("ein neuer Scan im selben Tab (nur der Anker ändert sich) löst den neuen Code ein", async () => {
  const { act } = await import("@testing-library/react");
  tokenMock.peekOnsiteToken.mockReturnValue("");
  renderPage();
  await screen.findByTestId("onsite-access-invalid");
  tokenMock.captureOnsiteToken.mockReturnValue(true);
  tokenMock.peekOnsiteToken.mockReturnValue("neuer-code-1234567890");
  apiMock.post.mockResolvedValue({ data: { tournament: { id: "t1", slug: "lan-cup" } } });
  await act(async () => { window.dispatchEvent(new window.HashChangeEvent("hashchange")); });
  expect(await screen.findByTestId("target-page")).toBeInTheDocument();
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/onsite/redeem", { token: "neuer-code-1234567890" });
});
