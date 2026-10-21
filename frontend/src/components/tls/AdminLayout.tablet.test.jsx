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

// Barrierefreiheit (Codex-Prüfung): eingeklappt ist das Menü nicht fokussierbar (inert); beim Öffnen springt der Fokus
// hinein, Escape schließt und gibt den Fokus an den Menü-Knopf zurück. Ab lg steht das Menü fest und bleibt bedienbar.
function setWide(wide) {
  window.matchMedia = vi.fn((query) => ({
    matches: wide && query.includes("1024"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

test("eingeklappt ist das Menü inert; Öffnen setzt den Fokus hinein, Escape gibt ihn an den Menü-Knopf zurück", async () => {
  setWide(false);
  authState.user = SYSTEM;
  window.localStorage.clear();
  renderLayout("/admin");
  const user = userEvent.setup();
  const aside = document.querySelector("aside");
  expect(aside).toHaveAttribute("inert");
  expect(aside).toHaveAttribute("aria-hidden", "true");

  const open = screen.getByTestId("admin-menu-open");
  open.focus();
  await user.click(open);
  expect(aside).not.toHaveAttribute("inert");
  expect(aside).not.toHaveAttribute("aria-hidden");
  // Ohne „Zuletzt“ landet der Fokus auf dem ersten Eintrag des Menüs.
  expect(document.activeElement).toBe(document.querySelector("nav.admin-scroll a[href]"));

  await user.keyboard("{Escape}");
  expect(open).toHaveAttribute("aria-expanded", "false");
  expect(aside).toHaveAttribute("inert");
  expect(document.activeElement).toBe(open);
});

test("mit „Zuletzt“ springt der Fokus beim Öffnen auf diese Gruppe", async () => {
  setWide(false);
  authState.user = SYSTEM;
  window.localStorage.setItem(`tls_admin_recent_v1:${SYSTEM.id}`, JSON.stringify(["/admin/news"]));
  renderLayout("/admin");
  await userEvent.setup().click(screen.getByTestId("admin-menu-open"));
  expect(document.activeElement).toBe(screen.getByTestId("admin-nav-group-Zuletzt"));
  window.localStorage.clear();
});

test("ab lg steht das Menü fest und bleibt fokussierbar", () => {
  setWide(true);
  authState.user = SYSTEM;
  renderLayout("/admin");
  const aside = document.querySelector("aside");
  expect(aside).not.toHaveAttribute("inert");
  expect(aside).not.toHaveAttribute("aria-hidden");
});
