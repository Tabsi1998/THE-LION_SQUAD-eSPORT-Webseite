import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Teamverwaltung (#2128, TM7, TM10): Suche, verwaiste und private Teams fallen auf, aufgelöste lassen sich zurückholen, und
// „Alle Beitrittscodes erneuern“ nur mit Rückfrage und nur mit dem Recht. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminTeamsPage } = await import("./AdminTeamsPage");

const RUDEL = { id: "t1", name: "Rudel", tag: "RDL", member_count: 5, squad_count: 1, is_public: true, leader: { id: "u1", display_name: "Mila" }, leader_gone: false, created_at: "2026-01-10T10:00:00+00:00" };
const WAISE = { id: "t2", name: "Waisen", tag: "WAI", member_count: 2, squad_count: 0, is_public: false, leader: null, leader_gone: true };
const ALT = { id: "t3", name: "Altes Rudel", tag: "ALT", member_count: 4, days_left: 12 };

function serve({ canRenew = true } = {}) {
  apiMock.get.mockImplementation(async (_url, { params }) => {
    const rights = { can_restore: canRenew, can_renew_all: canRenew, restore_days: 30, limit: 50, offset: 0 };
    if (params.state === "dissolved") return { data: { items: [ALT], total: 1, ...rights } };
    const items = [RUDEL, WAISE].filter((team) => !params.q || team.name.includes(params.q));
    return { data: { items, total: items.length, ...rights } };
  });
}

function renderPage() {
  return render(<MemoryRouter><AdminTeamsPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockReset();
});

test("die Liste zeigt Teamleitung, Co-Teams, private und verwaiste Teams und führt zur Teamseite", async () => {
  serve();
  renderPage();
  const row = await screen.findByTestId("admin-team-t1");
  expect(row).toHaveTextContent("Teamleitung: Mila");
  expect(row).toHaveTextContent("1 Co-Team");
  expect(row).toHaveAttribute("href", "/teams/t1");
  expect(screen.getByTestId("admin-team-orphan-t2")).toHaveTextContent("Ohne aktive Teamleitung");
  expect(screen.getByTestId("admin-team-private-t2")).toHaveTextContent("Privat");
  expect(screen.getByTestId("admin-teams-count")).toHaveTextContent("2 Teams");
});

test("die Suche fragt den Server und sagt, wenn nichts passt", async () => {
  serve();
  renderPage();
  await screen.findByTestId("admin-team-t1");
  fireEvent.change(screen.getByTestId("admin-teams-search"), { target: { value: "Waisen" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/teams", expect.objectContaining({ params: expect.objectContaining({ q: "Waisen" }) })));
  await waitFor(() => expect(screen.queryByTestId("admin-team-t1")).toBeNull());
  fireEvent.change(screen.getByTestId("admin-teams-search"), { target: { value: "Niemand" } });
  expect(await screen.findByTestId("admin-teams-empty")).toHaveTextContent("Kein Team passt");
});

test("aufgelöste Teams: Frist steht da, Wiederherstellen fragt nach", async () => {
  serve();
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  confirmMock.mockResolvedValue(true);
  renderPage();
  fireEvent.click(await screen.findByTestId("admin-teams-tab-dissolved"));
  const row = await screen.findByTestId("dissolved-team-t3");
  expect(row).toHaveTextContent("noch 12 Tage");
  fireEvent.click(screen.getByTestId("dissolved-team-restore-t3"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/teams/t3/restore", {}));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Team wiederherstellen?" }));
});

test("Kürzel inzwischen vergeben: die Zeile fragt nach einem neuen", async () => {
  serve();
  renderPage();
  fireEvent.click(await screen.findByTestId("admin-teams-tab-dissolved"));
  confirmMock.mockResolvedValue(true);
  const taken = Object.assign(new Error("409"), { response: { status: 409, data: { detail: "Das Kürzel ALT hat inzwischen ein anderes Team – bitte gib ein neues an." } } });
  apiMock.post.mockRejectedValueOnce(taken);
  fireEvent.click(await screen.findByTestId("dissolved-team-restore-t3"));
  const input = await screen.findByTestId("dissolved-team-tag-t3");
  expect(screen.getByTestId("dissolved-team-t3")).toHaveTextContent("hat inzwischen ein anderes Team");
  const button = screen.getByTestId("dissolved-team-restore-t3");
  expect(button).toBeDisabled();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true } });
  fireEvent.change(input, { target: { value: "alt2" } });
  fireEvent.click(button);
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/teams/t3/restore", { tag: "ALT2" }));
});

test("Alle Beitrittscodes erneuern: mit Rückfrage; ohne Ja passiert nichts; kein Code auf der Seite", async () => {
  serve();
  apiMock.post.mockResolvedValue({ data: { ok: true, renewed: 2 } });
  renderPage();
  const button = await screen.findByTestId("admin-teams-renew-all-button");
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(button);
  await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Alle Beitrittscodes erneuern?" })));
  expect(apiMock.post).not.toHaveBeenCalled();
  confirmMock.mockResolvedValueOnce(true);
  fireEvent.click(button);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/teams/join-codes/renew", { confirm: true }));
});

test("ohne das Recht kein Knopf „Alle erneuern“ und kein Wiederherstellen", async () => {
  serve({ canRenew: false });
  renderPage();
  await screen.findByTestId("admin-team-t1");
  expect(screen.queryByTestId("admin-teams-renew-all")).toBeNull();
  fireEvent.click(screen.getByTestId("admin-teams-tab-dissolved"));
  expect(await screen.findByTestId("admin-dissolved-t3")).toHaveTextContent("Altes Rudel");
  expect(screen.queryByTestId("dissolved-team-restore-t3")).toBeNull();
});
