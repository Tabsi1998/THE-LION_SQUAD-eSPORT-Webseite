import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

// Zurück auf Einzelmails (#1662, Fabian 26.11.): der Link aus der Sammel-Mail führt hierher. Erst der Knopf stellt um - das
// Öffnen allein nicht (Linkvorschau, Virenscanner). Kein Login nötig.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const DigestInstantPage = (await import("./DigestInstantPage")).default;

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><DigestInstantPage /><Where /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

test("Öffnen allein ändert nichts; der Knopf stellt auf Einzelmails", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true, rhythm: "instant" } });
  const user = userEvent.setup();
  open("/sammel-mail/einzeln?token=u1.sig");
  expect(apiMock.post).not.toHaveBeenCalled();
  // Prüfung 26.11.: Der Schlüssel verschwindet aus der Adresse und geht im Body - nicht als Query.
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/sammel-mail\/einzeln$/));
  await user.click(screen.getByTestId("digest-instant-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/notification-digest/instant", { token: "u1.sig" }));
  expect(await screen.findByText("Erledigt – jede Mail kommt wieder einzeln, sobald etwas passiert.")).toBeInTheDocument();
});

test("schon umgestellt, ungültiger und fehlender Schlüssel sagen es klar", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, rhythm: "instant", already: true } });
  const { unmount } = open("/sammel-mail/einzeln?token=u1.sig");
  await user.click(screen.getByTestId("digest-instant-confirm"));
  expect(await screen.findByText("Das war schon so eingestellt – deine Mails kommen einzeln.")).toBeInTheDocument();
  unmount();

  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Der Link ist ungültig." } } });
  const second = open("/sammel-mail/einzeln?token=kaputt");
  await user.click(screen.getByTestId("digest-instant-confirm"));
  expect(await screen.findByText("Der Link ist ungültig.")).toBeInTheDocument();
  second.unmount();

  open("/sammel-mail/einzeln");
  expect(screen.getByText(/Im Link fehlt der Schlüssel/)).toBeInTheDocument();
  expect(screen.queryByTestId("digest-instant-confirm")).toBeNull();
});

// Vierte Prüfrunde: Das Meta „no-referrer“ bleibt nicht stehen, sobald der Schlüssel aus der Adresse ist (Navigation in der App).
test("gibt die Referrer-Regel frei, sobald der Schlüssel aus der Adresse ist", async () => {
  document.head.querySelectorAll('meta[name="referrer"]').forEach((node) => node.remove());
  const guard = document.createElement("meta");
  guard.name = "referrer";
  guard.content = "no-referrer";
  document.head.prepend(guard);
  open("/sammel-mail/einzeln?token=u1.sig");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/sammel-mail\/einzeln$/));
  await waitFor(() => expect(document.querySelector('meta[name="referrer"]').getAttribute("content")).toBe("strict-origin-when-cross-origin"));
});
