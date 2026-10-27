import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_GROUPS } from "@/components/tls/AdminLayout";

// Menüname = Seitentitel (#512): Der Eintrag im Admin-Menü und die Überschrift der Seite heißen gleich - sonst sucht man
// im Handbuch und in der Hilfe nach einem Namen, den die Seite nicht trägt. Geprüft wird jede Seite, deren Überschrift
// fest im Code steht. Ausnahme: die Startseite, deren Menüname „Dashboard“ heißt und deren Seite „Kommandozentrale“.

const src = path.resolve(__dirname, "../..");
const read = (file) => readFileSync(path.join(src, file), "utf8").replace(/\r\n/g, "\n");
const EXEMPT = new Set(["/admin"]);

function pageFiles() {
  const app = read("App.jsx");
  const imports = Object.fromEntries([...app.matchAll(/const (\w+) = lazyPage\(\(\) => import\("@\/([^"]+)"\)/g)].map((m) => [m[1], m[2]]));
  const routes = [...app.matchAll(/path="(\/admin[^"]*)" element=\{<ProtectedRoute[^>]*><(\w+)/g)];
  return Object.fromEntries(routes.map((m) => [m[1], imports[m[2]]]).filter(([, file]) => file));
}

function heading(file) {
  for (const ext of [".jsx", ".js"]) {
    const full = `${file}${ext}`;
    if (!existsSync(path.join(src, full))) continue;
    const match = read(full).match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (!match) return null;
    // Der Titel ist der Text nach dem letzten Tag (Symbole davor sind selbstschließend); es wird nichts "bereinigt", nur gelesen.
    const inner = match[1];
    const raw = inner.slice(inner.lastIndexOf(">") + 1);
    const text = raw.split("&shy;").join("").split("&amp;").join("&").split(/\s+/).filter(Boolean).join(" ");
    return text.startsWith("{") ? null : text;
  }
  return null;
}

test("Menüname = Seitentitel: jede Admin-Seite mit fester Überschrift heißt wie ihr Menüeintrag", () => {
  const files = pageFiles();
  const mismatches = [];
  let checked = 0;
  for (const item of ADMIN_GROUPS.flatMap((group) => group.items)) {
    if (item.searchOnly || EXEMPT.has(item.to) || !files[item.to]) continue;
    const title = heading(files[item.to]);
    if (!title) continue;
    checked += 1;
    if (title !== item.label) mismatches.push(`${item.to}: Menü „${item.label}“, Seite „${title}“`);
  }
  expect(checked).toBeGreaterThan(30);
  expect(mismatches).toEqual([]);
});
