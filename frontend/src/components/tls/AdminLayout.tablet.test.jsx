import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const authState = { user: null, logout: () => {} };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));

const { AdminLayout } = await import("./AdminLayout");

const SYSTEM = { id: "sys-1", role: "superadmin", mfa_enabled: true, auth_mfa_verified: true };

beforeAll(() => {
  window.Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  authState.user = null;
});

function renderLayout(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminLayout><div>inhalt</div></AdminLayout>
    </MemoryRouter>,
  );
}

// Tablet hochkant (#1289): bis 1023 px ist das Menü ein Knopf mit ausklappender Leiste, erst ab 1024 px (lg) steht es
// fest links - vorher (md, 768 px) nahm es am iPad hochkant ein Drittel der Breite.
test("das Menü steht erst ab lg fest links; darunter Menü-Knopf und ausklappende Leiste", async () => {
  authState.user = SYSTEM;
  renderLayout("/admin");
  const aside = document.querySelector("aside");
  expect(aside.className).toContain("lg:sticky");
  expect(aside.className).toContain("lg:translate-x-0");
  expect(aside.className).not.toMatch(/\bmd:(sticky|translate-x-0)\b/);
  const open = screen.getByTestId("admin-menu-open");
  expect(open.parentElement.className).toContain("lg:hidden");
  expect(open.parentElement.className).not.toContain("md:hidden");
  expect(screen.getByLabelText("Admin-Menü schließen").className).toContain("lg:hidden");

  await userEvent.setup().click(open);
  expect(aside.className).toContain("translate-x-0");
  expect(open).toHaveAttribute("aria-expanded", "true");
  const overlay = document.querySelector("[data-testid='admin-menu-overlay']");
  expect(overlay.className).toContain("lg:hidden");
});
