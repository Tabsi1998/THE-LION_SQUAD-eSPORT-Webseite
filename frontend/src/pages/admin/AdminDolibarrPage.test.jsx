import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Dolibarr-Seite (#295, #297, #316): wer welchen Reiter sieht, und dass eine
// Zuordnung erst nach ausdrücklicher Bestätigung gesendet wird.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const authState = { isSuperAdmin: false, areas: ["club"] };
const confirmMock = vi.fn(async () => true);

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: authState.isSuperAdmin, can: (...wanted) => wanted.some((area) => authState.areas.includes(area)) }) }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminDolibarrPage = (await import("./AdminDolibarrPage")).default;

const STATUS = {
  mode: "preview", environment: "production", instance: "verein", entity: 1, base_url: "https://erp.example.test",
  api_key_configured: true, webhook_configured: false, auto_link_verified_email: false, type_map: { 2: "ordinary" },
  website_types: ["ordinary", "youth"], links: { verified: 3 }, open_links: 1, members_led_by_dolibarr: 0, unmapped_types: 0,
  sync: { last_run_at: "2026-09-21T10:00:00+00:00", last_ok_at: "2026-09-21T10:00:00+00:00", ok: true, applied_live: false, counts: { seen: 40 }, module_version: "0.5.12-beta", api_version: 1, capabilities: { member_summary: true, verified_identities: false } },
  policy: { active: false, version: null, map: {}, approved_at: null, derivable_areas: ["club"] },
};
const PREVIEW = {
  members_in_dolibarr: 40, users_checked: 12, members_without_account: [{ member_id: 17, ref: "17", name: "Ohne Konto" }],
  rows: [
    { user_id: "u1", username: "paula", display_name: "Paula", state: "match", local_status: "active", member_id: 12, member_ref: "12", member_name: "Paula Beispiel", dolibarr_status: "active", would_change_status: false },
    { user_id: "u2", username: "familie", display_name: "Familie", state: "shared_email", local_status: "none", member_id: null },
  ],
  types: [{ id: 2, label: "Ordentliches Mitglied", members: 38, mapped_to: "ordinary" }],
  function_codes: [{ code: "kassier", label: "Kassier:in", holders: 1 }, { code: "rechnungspruefung", label: "Rechnungsprüfer:in", holders: 2 }],
};

function mockApi() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/dolibarr/status") return { data: STATUS };
    if (url === "/admin/dolibarr/links") return { data: [] };
    if (url === "/admin/dolibarr/preview") return { data: PREVIEW };
    throw new Error(url);
  });
  apiMock.post.mockResolvedValue({ data: { status: "verified" } });
  apiMock.put.mockResolvedValue({ data: { ok: true, preview: true, map: { kassier: ["club"] }, affected: [{ user_id: "u1", display_name: "Paula", grants: [{ area: "club", function_label: "Kassier:in" }] }] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSuperAdmin = false;
  authState.areas = ["club"];
  confirmMock.mockResolvedValue(true);
  mockApi();
});

const renderPage = () => render(<MemoryRouter><AdminDolibarrPage /></MemoryRouter>);

test("die Vereinsverwaltung sieht Zuordnungen und Umstellung, aber nicht die Verbindung", async () => {
  renderPage();
  await waitFor(() => expect(screen.getByTestId("dolibarr-mode")).toHaveTextContent("Vorschau"));
  expect(screen.getByTestId("dolibarr-sync-tile")).toHaveTextContent("nichts übernommen (Vorschau)");
  expect(screen.getByTestId("dolibarr-tab-links")).toBeInTheDocument();
  expect(screen.getByTestId("dolibarr-tab-preview")).toBeInTheDocument();
  expect(screen.queryByTestId("dolibarr-tab-connection")).toBeNull();
});

test("wer nur System hat, sieht die Verbindung, aber keine Mitgliederdaten", async () => {
  authState.areas = ["system"];
  renderPage();
  await waitFor(() => expect(screen.getByTestId("dolibarr-tab-connection")).toBeInTheDocument());
  expect(screen.queryByTestId("dolibarr-tab-links")).toBeNull();
  expect(screen.queryByTestId("dolibarr-tab-preview")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/admin/dolibarr/links");
});

test("eine Zuordnung geht erst nach Bestätigung hinaus, und nur für einen eindeutigen Treffer", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("dolibarr-tab-preview"));
  await user.click(screen.getByTestId("dolibarr-preview-run"));
  await waitFor(() => expect(screen.getByTestId("dolibarr-preview-summary")).toHaveTextContent("40 Mitglieder in Dolibarr"));
  expect(screen.getByTestId("dolibarr-preview-familie")).toHaveTextContent("mehrere Mitglieder teilen sich die E-Mail");
  expect(screen.getByTestId("dolibarr-preview-familie").querySelector("button")).toBeNull();

  confirmMock.mockResolvedValueOnce(false);
  await user.click(screen.getByTestId("dolibarr-preview-paula").querySelector("button"));
  expect(apiMock.post).not.toHaveBeenCalled();

  await user.click(screen.getByTestId("dolibarr-preview-paula").querySelector("button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/dolibarr/links", { user_id: "u1", member_id: 12 }));
});

test("die Freigabe Funktion → Bereich kann nur der Superadmin ändern, und erst nach der Vorschau", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("dolibarr-tab-preview"));
  await user.click(screen.getByTestId("dolibarr-preview-run"));
  await waitFor(() => expect(screen.getByTestId("dolibarr-preview-summary")).toBeInTheDocument());
  await user.click(screen.getByTestId("dolibarr-tab-policy"));
  expect(screen.getByTestId("dolibarr-policy-kassier").querySelector("input")).toBeDisabled();
  expect(screen.queryByTestId("dolibarr-policy-approve")).toBeNull();
});

test("der Superadmin sieht erst, wer was bekäme, und gibt dann frei", async () => {
  authState.isSuperAdmin = true;
  authState.areas = ["club", "system"];
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId("dolibarr-tab-preview"));
  await user.click(screen.getByTestId("dolibarr-preview-run"));
  await waitFor(() => expect(screen.getByTestId("dolibarr-preview-summary")).toBeInTheDocument());
  await user.click(screen.getByTestId("dolibarr-tab-policy"));
  expect(screen.getByTestId("dolibarr-policy-approve")).toBeDisabled();
  await user.click(screen.getByTestId("dolibarr-policy-kassier").querySelector("input"));
  await user.click(screen.getByTestId("dolibarr-policy-preview"));
  await waitFor(() => expect(screen.getByTestId("dolibarr-policy-affected")).toHaveTextContent("Paula: Vereinsverwaltung (als Kassier:in)"));
  expect(apiMock.put).toHaveBeenLastCalledWith("/admin/dolibarr/function-policy", { map: { kassier: ["club"] }, confirm: false });
  await user.click(screen.getByTestId("dolibarr-policy-approve"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/admin/dolibarr/function-policy", { map: { kassier: ["club"] }, confirm: true }));
});
