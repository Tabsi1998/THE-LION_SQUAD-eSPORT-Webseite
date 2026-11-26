import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

// Newsletter abbestellen (#2119 ML4): erst der Knopf meldet ab - das Öffnen des Links allein nicht.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const NewsletterUnsubscribePage = (await import("./NewsletterUnsubscribePage")).default;

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><NewsletterUnsubscribePage /><Where /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

test("Öffnen allein meldet nicht ab; der Knopf schon", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, already: false } });
  const user = userEvent.setup();
  open("/newsletter/abbestellen?token=u1.sig");
  expect(apiMock.post).not.toHaveBeenCalled();
  // Prüfung 26.11.: Der Schlüssel verschwindet aus der Adresse und geht im Body - nicht als Query.
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/newsletter\/abbestellen$/));
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/newsletter/unsubscribe", { token: "u1.sig" }));
  expect(await screen.findByText("Erledigt – du bekommst keinen Newsletter mehr.")).toBeInTheDocument();
});

test("Schon abgemeldet und ungültiger Link sagen es klar", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, already: true } });
  const { unmount } = open("/newsletter/abbestellen?token=u1.sig");
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  expect(await screen.findByText("Du warst schon abgemeldet – es kommt kein Newsletter mehr.")).toBeInTheDocument();
  unmount();

  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Der Abmeldelink ist ungültig." } } });
  open("/newsletter/abbestellen?token=kaputt");
  await user.click(screen.getByTestId("newsletter-unsubscribe-confirm"));
  expect(await screen.findByText("Der Abmeldelink ist ungültig.")).toBeInTheDocument();
});

test("Ohne Schlüssel kein Knopf, sondern der Weg übers Profil", () => {
  open("/newsletter/abbestellen");
  expect(screen.queryByTestId("newsletter-unsubscribe-confirm")).toBeNull();
  expect(screen.getByText(/Im Link fehlt der Schlüssel/)).toBeInTheDocument();
});

// Vierte Prüfrunde: Das Meta „no-referrer“ bleibt nicht stehen, sobald der Schlüssel aus der Adresse ist (Navigation in der App).
test("gibt die Referrer-Regel frei, sobald der Schlüssel aus der Adresse ist", async () => {
  document.head.querySelectorAll('meta[name="referrer"]').forEach((node) => node.remove());
  const guard = document.createElement("meta");
  guard.name = "referrer";
  guard.content = "no-referrer";
  document.head.prepend(guard);
  open("/newsletter/abbestellen?token=u1.sig");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/newsletter\/abbestellen$/));
  await waitFor(() => expect(document.querySelector('meta[name="referrer"]').getAttribute("content")).toBe("strict-origin-when-cross-origin"));
});
