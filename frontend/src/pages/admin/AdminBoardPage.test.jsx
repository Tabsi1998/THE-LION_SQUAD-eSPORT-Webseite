import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Vorstand (#1355): besetzt wird über die Personensuche mit Rückfrage; der Satz nennt die Rechte bzw. „die Rechte kommen
// aus Dolibarr“; führt Dolibarr den Vorstand, ist die Liste nur zum Lesen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminBoardPage = (await import("./AdminBoardPage")).default;

const POSITIONS = [
  { id: "bp-1", slug: "obmann", title_male: "Obmann", title_female: "Obfrau", is_default: true, allow_deputy: true, is_active: true, user_id: "prof-1", user: { display_name: "Leo Löwe" }, user_since: "2024-03-01T10:00:00+00:00" },
  { id: "bp-2", slug: "kassier", title_male: "Kassier", title_female: "Kassierin", is_default: true, allow_deputy: true, is_active: true, user_id: null },
  { id: "bp-3", slug: "medien", title_male: "Medienreferent", title_female: "Medienreferentin", is_default: false, allow_deputy: false, is_active: true, user_id: null },
];

function mockApi({ state = { dolibarr_leads: false, rights_from_dolibarr: false }, source = { dolibarr: false } } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/board?manual=true") return { data: POSITIONS };
    if (url === "/board/source") return { data: source };
    if (url === "/board/admin/state") return { data: state };
    if (url === "/board?active_only=true") return { data: [] };
    if (url === "/admin/people/search") return { data: [{ id: "u-7", name: "Erika Beispiel", context: "Mitglied", has_account: true }] };
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter><AdminBoardPage /></MemoryRouter>);
}

async function chooseErika(user) {
  await user.type(screen.getByTestId("board-person-search"), "eri");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  await user.click(await screen.findByTestId("board-person-option-u-7"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  confirmMock.mockImplementation(async () => true);
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("besetzen: Personensuche nur für Vereinsmitglieder, Satz zu den Rechten, erst nach Rückfrage", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("board-assign-kassier"));
  const sheet = screen.getByTestId("board-assign-sheet");
  await chooseErika(user);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/people/search", expect.objectContaining({ params: expect.objectContaining({ purpose: "board" }) })));
  expect(within(sheet).getByTestId("board-assign-sentence")).toHaveTextContent("Erika Beispiel wird Kassier:in und bekommt damit die Vereinsverwaltung: Mitgliederdaten, Anträge, Dokumente, Benutzer.");
  expect(apiMock.patch).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("board-assign-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/board/bp-2", { user_id: "u-7" }));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Kassier:in besetzen?", description: expect.stringContaining("bekommt damit die Vereinsverwaltung") }));
});

test("lehnt die Rückfrage ab, bleibt der Posten offen", async () => {
  mockApi();
  confirmMock.mockImplementation(async () => false);
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("board-assign-kassier"));
  await chooseErika(user);
  await user.click(screen.getByTestId("board-assign-save"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("mit Dolibarr-Funktionen: der Satz sagt, dass die Rechte aus Dolibarr kommen", async () => {
  mockApi({ state: { dolibarr_leads: false, rights_from_dolibarr: true } });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByTestId("board-rights-intro")).toHaveTextContent("Die Rechte kommen aus den Funktionen in Dolibarr");
  await user.click(screen.getByTestId("board-assign-kassier"));
  await chooseErika(user);
  expect(screen.getByTestId("board-assign-sentence")).toHaveTextContent("Der Posten ist nur für die Anzeige – die Rechte kommen aus Dolibarr.");
});

test("führt Dolibarr den Vorstand, ist die Liste nur zum Lesen", async () => {
  mockApi({ state: { dolibarr_leads: true, rights_from_dolibarr: false }, source: { dolibarr: true, switch_on: true, has_board: true } });
  renderPage();
  expect(await screen.findByTestId("board-dolibarr")).toHaveTextContent("Der Vorstand kommt aus Dolibarr");
  expect(screen.getByTestId("board-holder-obmann")).toHaveTextContent("Leo Löwe");
  expect(screen.queryByTestId("board-assign-kassier")).toBeNull();
  expect(screen.queryByTestId("board-more-kassier")).toBeNull();
  expect(screen.queryByTestId("board-new-btn")).toBeNull();
});

test("Löschen steht unter „Mehr“ und fragt nach - Standard-Posten lassen sich nicht löschen", async () => {
  mockApi();
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByTestId("board-row-medien")).toBeInTheDocument();
  expect(screen.queryByTestId("board-delete-medien")).toBeNull();
  await user.click(screen.getByTestId("board-more-medien"));
  await user.click(screen.getByTestId("board-delete-medien"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/board/bp-3"));
  await user.click(screen.getByTestId("board-more-kassier"));
  expect(screen.queryByTestId("board-delete-kassier")).toBeNull();
});
