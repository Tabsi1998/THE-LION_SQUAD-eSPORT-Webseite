import { readFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_AREAS, AREAS, GRANTABLE_AREAS, MFA_AREAS, ROLE_AREAS } from "@/lib/permissions";

// Eine Rechte-Liste, zwei Orte (#1353): `lib/permissions.js` spiegelt `backend/services/permissions.py`. Menü,
// Seiten-Schutz und Knöpfe fragen das Web, der Server prüft selbst - laufen die Listen auseinander, zeigt das Web Knöpfe,
// die der Server ablehnt (oder versteckt, was er erlaubt). Dieser Test vergleicht beide Dateien.

const repo = path.resolve(__dirname, "../../..");
const server = readFileSync(path.join(repo, "backend/services/permissions.py"), "utf8");
const auth = readFileSync(path.join(repo, "backend/auth.py"), "utf8");
const strings = (text) => [...text.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

function block(source, pattern) {
  const match = source.match(pattern);
  if (!match) throw new Error(`nicht gefunden: ${pattern}`);
  return match[1];
}

test("Bereiche, vergebbare Bereiche und Bereiche mit Zwei-Faktor wie im Server", () => {
  expect(strings(block(server, /^AREAS: tuple\[str, \.\.\.\] = \(([^)]*)\)/m))).toEqual(AREAS);
  expect(strings(block(server, /^GRANTABLE_AREAS: tuple\[str, \.\.\.\] = \(([^)]*)\)/m))).toEqual(GRANTABLE_AREAS);
  expect(strings(block(server, /^MFA_AREAS: frozenset\[str\] = frozenset\(\{([^}]*)\}\)/m)).sort()).toEqual([...MFA_AREAS].sort());
});

test("Bereiche je Rolle wie im Server", () => {
  const roles = block(server, /^ROLE_AREAS: dict\[str, frozenset\[str\]\] = \{([\s\S]*?)^\}/m);
  const parsed = Object.fromEntries([...roles.matchAll(/"([a-z_]+)": frozenset\(([^\n]*)\),/g)].map(([, role, body]) => [
    role,
    body.trim() === "AREAS" ? [...AREAS] : body.trim() === "" ? [] : strings(body),
  ]));
  const web = Object.fromEntries(Object.entries(ROLE_AREAS).map(([role, areas]) => [role, [...areas].sort()]));
  expect(Object.fromEntries(Object.entries(parsed).map(([role, areas]) => [role, areas.sort()]))).toEqual(web);
});

test("Shop (#1706): Menüeintrag, Seiten-Schutz und alle Server-Routen verlangen genau den Bereich Finanzen", () => {
  // Einstellungen und Bestellungen (#1704, #1706), Designs (#1708) und Produkte (#1707) - alle Adminrouten nur mit Finanzen.
  for (const file of ["shop_admin_routes.py", "shop_design_routes.py", "shop_product_routes.py"]) {
    const shopRoutes = readFileSync(path.join(repo, "backend/routes", file), "utf8");
    const guards = [...shopRoutes.matchAll(/Depends\(require_area\(([^)]*)\)\)/g)].map((m) => strings(m[1]).join(","));
    const routes = [...shopRoutes.matchAll(/^@router\.(get|post|put|patch|delete)\(/gm)];
    expect(guards.length, file).toBe(routes.length);
    expect([...new Set(guards)], file).toEqual(["finance"]);
  }

  const layout = readFileSync(path.join(repo, "frontend/src/components/tls/AdminLayout.jsx"), "utf8");
  expect(layout).toMatch(/\{ to: "\/admin\/shop", label: "Shop", icon: ShoppingBag, areas: \["finance"\] \}/);
  const app = readFileSync(path.join(repo, "frontend/src/App.jsx"), "utf8");
  expect(app).toMatch(/path="\/admin\/shop" element=\{<ProtectedRoute requireArea=\{\["finance"\]\}>/);
  expect(app).toMatch(/path="\/admin\/shop\/designs" element=\{<ProtectedRoute requireArea=\{\["finance"\]\}>/);
  expect(app).toMatch(/path="\/admin\/shop\/products" element=\{<ProtectedRoute requireArea=\{\["finance"\]\}>/);
  expect(app).toMatch(/path="\/admin\/shop\/products\/:productId" element=\{<ProtectedRoute requireArea=\{\["finance"\]\}>/);
});

test("Startseite der Verwaltung: der Server-Wächter verlangt genau die Verwaltungsbereiche des Webs", () => {
  const guard = block(auth, /def require_dashboard\(\):[\s\S]*?return require_area\(([^)]*)\)/);
  expect(strings(guard).sort()).toEqual([...ADMIN_AREAS].sort());
});
