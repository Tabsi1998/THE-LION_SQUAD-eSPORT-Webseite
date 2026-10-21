import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Mitgliederprofile an einer Stelle (#1365): der Reiter heißt „Öffentliche Profile“ und lässt sich per Adresse öffnen
// (`/admin/members?tab=profiles`); die alte Adresse `/admin/member-profiles` leitet dorthin.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatMemberSince: () => "", formatRequestError: (e, f) => f }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/pages/admin/AdminClubMemberProfilesPage", () => ({ ClubMemberProfilesAdminContent: () => <div data-testid="profiles-content" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminMembersPage } = await import("./AdminMembersPage");

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/membership/meta" ? { statuses: [], types: [] } : [] }));
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/members" element={<><AdminMembersPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

test("der Reiter heißt „Öffentliche Profile“ und öffnet sich über ?tab=profiles", async () => {
  renderAt("/admin/members?tab=profiles");
  expect(await screen.findByTestId("profiles-content")).toBeInTheDocument();
  expect(screen.getByTestId("members-main-tab-profiles")).toHaveTextContent("Öffentliche Profile");
  expect(screen.getByTestId("members-main-tab-profiles")).toHaveAttribute("aria-selected", "true");
});

test("ohne Angabe stehen die Mitgliedschaften offen; der Reiterwechsel schreibt die Adresse mit", async () => {
  const user = userEvent.setup();
  renderAt("/admin/members");
  expect(screen.queryByTestId("profiles-content")).toBeNull();
  await user.click(screen.getByTestId("members-main-tab-profiles"));
  expect(await screen.findByTestId("profiles-content")).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent("/admin/members?tab=profiles");
  await user.click(screen.getByTestId("members-main-tab-status"));
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/admin\/members$/);
});

test("die alte Adresse /admin/member-profiles leitet auf den Reiter", () => {
  const app = readFileSync(path.resolve(__dirname, "../../App.jsx"), "utf8");
  expect(app).toContain('<Route path="/admin/member-profiles" element={<Navigate to="/admin/members?tab=profiles" replace />} />');
  expect(app).not.toContain("AdminClubMemberProfilesPage");
});
