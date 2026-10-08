import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Bewerbungen (#1356): einladen direkt hier mit Personensuche, jeder Stand als Satz mit nächstem Schritt, Annehmen und
// Ablehnen nur bei Anträgen der Website.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ usePrompt: () => async () => "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminMembershipApplicationsPage = (await import("./AdminMembershipApplicationsPage")).default;

const APPLICATIONS = [
  { id: "a-1", created_at: "2026-10-05T09:00:00+00:00", user_display_name: "Max Muster", user_username: "max", coupled: true, type_label: "Ordentliches Mitglied", status: "pending",
    motivation: "Ich spiele seit Jahren mit.", dolibarr: { application_status: "in_review", member_url: "https://erp.example.test/adherents/card.php?rowid=7" } },
  { id: "a-2", created_at: "2026-10-02T09:00:00+00:00", user_display_name: "Pia Pokal", user_username: "pia", coupled: false, contribution_pref: "youth", status: "pending", motivation: "Mein Bruder ist schon dabei." },
  { id: "a-3", created_at: "2026-09-20T09:00:00+00:00", user_display_name: "Ella Elf", user_username: "ella", coupled: true, type_label: "Fördermitglied", status: "pending",
    motivation: "Ich möchte unterstützen.", dolibarr: { application_status: "waiting_payment" } },
];

function mockApi({ hits = [{ id: "u-5", name: "Nina Neu", context: "Community" }] } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url.startsWith("/membership/applications")) return { data: APPLICATIONS };
    if (url.startsWith("/admin/membership-invitations")) return { data: [] };
    if (url === "/admin/people/search") return { data: hits };
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter><AdminMembershipApplicationsPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  apiMock.post.mockResolvedValue({ data: { id: "inv-1", status: "open", created_at: "2026-10-08T08:00:00+00:00" } });
});

test("jeder Stand als Satz mit nächstem Schritt – nie ein Rohwert; Annehmen nur bei Website-Anträgen", async () => {
  mockApi();
  renderPage();
  const dolibarr = await screen.findByTestId("app-state-a-1");
  expect(dolibarr).toHaveTextContent("In Prüfung in Dolibarr");
  expect(dolibarr).toHaveTextContent("Dort entscheiden – hier erscheint es von selbst.");
  expect(screen.getByTestId("app-state-a-2")).toHaveTextContent("Annehmen oder ablehnen – hier auf der Website.");
  expect(screen.getByTestId("app-state-a-3")).toHaveTextContent("Stand aus Dolibarr unbekannt");
  expect(screen.getByTestId("apps-table")).not.toHaveTextContent("waiting_payment");
  expect(screen.getByTestId("app-approve-a-2")).toBeInTheDocument();
  expect(screen.queryByTestId("app-approve-a-1")).toBeNull();
  expect(screen.getByTestId("app-dolibarr-a-1")).toHaveTextContent("In Dolibarr öffnen");
});

test("einladen geht hier: Personensuche, Einladung, die Liste lädt neu", async () => {
  mockApi();
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByTestId("invitations-box")).toHaveTextContent("Eingeladen wird oben mit „+ Zum Antrag einladen“.");
  await user.click(screen.getByTestId("apps-invite-open"));
  const sheet = screen.getByTestId("apps-invite-sheet");
  await user.type(within(sheet).getByTestId("apps-invite-person-search"), "nin");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/people/search", expect.objectContaining({ params: expect.objectContaining({ purpose: "invite", q: "nin" }) })));
  await user.click(await screen.findByTestId("apps-invite-person-option-u-5"));
  const invitationLoads = apiMock.get.mock.calls.filter(([url]) => url.startsWith("/admin/membership-invitations")).length;
  await user.click(screen.getByTestId("apps-invite-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/membership-invitations", { user_id: "u-5", note: null }));
  expect(toastMock.success).toHaveBeenCalledWith("Nina Neu ist zum Mitgliedsantrag eingeladen.");
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => url.startsWith("/admin/membership-invitations")).length).toBeGreaterThan(invitationLoads));
});

test("wer schon eingeladen ist, steht mit Datum da – kein zweites Einladen", async () => {
  mockApi({ hits: [{ id: "u-6", name: "Leo Löwe", context: "ist schon eingeladen", invited_at: "2026-10-01T10:00:00+00:00" }] });
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("apps-invite-open"));
  await user.type(screen.getByTestId("apps-invite-person-search"), "leo");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  await user.click(await screen.findByTestId("apps-invite-person-option-u-6"));
  expect(screen.getByTestId("apps-invite-already")).toHaveTextContent("Leo Löwe ist schon eingeladen – offen seit 1.10.2026.");
  await user.click(screen.getByTestId("apps-invite-save"));
  expect(apiMock.post).not.toHaveBeenCalled();
});
