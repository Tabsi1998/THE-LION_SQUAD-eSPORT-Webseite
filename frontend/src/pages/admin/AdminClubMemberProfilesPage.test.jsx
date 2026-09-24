import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Vereinsprofil ↔ Website-Konto (#506): der Kasten „Konto“ sucht Konten, verknüpft, löst; ein Konto mit anderem
// Profil lässt sich nicht verknüpfen; das Speichern schickt nur user_id.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "", suggestSlug: (v) => String(v || "").toLowerCase() }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: ({ testId }) => <div data-testid={testId} /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: ({ testId }) => <textarea data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/GermanDateField", () => ({ GermanDateField: ({ testId }) => <input data-testid={testId} readOnly /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminClubMemberProfilesPage = (await import("./AdminClubMemberProfilesPage")).default;

const PROFILES = [
  { id: "p1", display_name: "Paula Beispiel", gamertag: "paula-b", slug: "paula-b", user_id: null, linked_account: null, games: [], platforms: [], is_active: true, account_unlinked_at: "2026-09-24T10:00:00Z" },
  { id: "p2", display_name: "Max Muster", gamertag: "maxi", slug: "maxi", user_id: "u-max", linked_account: { id: "u-max", username: "max", display_name: "Max", email: "max@example.test" }, games: ["F1 25"], platforms: ["PC"], is_active: true },
];
const USERS = [
  { id: "u-paula", username: "paula", display_name: "Paula", email: "paula@example.test", avatar_url: "/uploads/paula.png" },
  { id: "u-max", username: "max", display_name: "Max", email: "max@example.test" },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url, config) => {
    if (url === "/membership/profiles/admin/all") return { data: PROFILES };
    if (url === "/users") return { data: USERS.filter((u) => JSON.stringify(u).toLowerCase().includes(String(config?.params?.q || "").toLowerCase())) };
    if (url === "/users/u-paula") return { data: { ...USERS[0], favorite_games: ["Rocket League"], main_platforms: ["PC", "PS5"] } };
    return { data: [] };
  });
  apiMock.patch.mockResolvedValue({ data: {} });
});

function renderPage() {
  return render(<MemoryRouter><AdminClubMemberProfilesPage /></MemoryRouter>);
}

test("ohne Konto: suchen, ein fremd verknüpftes Konto ist gesperrt, verknüpfen und speichern schickt user_id", async () => {
  const user = userEvent.setup();
  renderPage();
  const edit = (await screen.findAllByRole("button", { name: /Bearbeiten/ }))[0];
  await user.click(edit);
  const box = await screen.findByTestId("club-member-account");
  expect(box).toHaveTextContent("Zuletzt hat der Vorstand ein Konto gelöst");
  expect(screen.queryByTestId("club-member-account-name")).toBeNull();
  await user.type(screen.getByTestId("club-member-account-search"), "ma");
  await waitFor(() => expect(screen.getByTestId("club-member-account-link-max")).toBeDisabled());
  expect(screen.getByTestId("club-member-account-results")).toHaveTextContent("hat schon das Profil „Max Muster“");
  await user.clear(screen.getByTestId("club-member-account-search"));
  await user.type(screen.getByTestId("club-member-account-search"), "paula@");
  await user.click(await screen.findByTestId("club-member-account-link-paula"));
  expect(screen.getByTestId("club-member-account-name")).toHaveTextContent("Paula");
  expect(screen.getByTestId("club-member-account-profile")).toHaveAttribute("href", "/u/paula");
  await user.click(screen.getByTestId("club-member-account-takeover"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Profilbild")));
  await user.click(screen.getByTestId("club-member-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/membership/profiles/admin/p1", expect.objectContaining({ user_id: "u-paula", photo_url: "/uploads/paula.png", games: ["Rocket League"], platforms: ["PC", "PS5"] })));
});

test("mit Konto: Name, Spielerprofil-Link und Lösen; Lösen schickt user_id null", async () => {
  const user = userEvent.setup();
  renderPage();
  const edit = (await screen.findAllByRole("button", { name: /Bearbeiten/ }))[1];
  await user.click(edit);
  expect(await screen.findByTestId("club-member-account-name")).toHaveTextContent("Max");
  expect(screen.getByTestId("club-member-account-profile")).toHaveAttribute("href", "/u/max");
  await user.click(screen.getByTestId("club-member-account-unlink"));
  expect(screen.getByTestId("club-member-account-search")).toBeInTheDocument();
  await user.click(screen.getByTestId("club-member-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/membership/profiles/admin/p2", { user_id: null }));
});
