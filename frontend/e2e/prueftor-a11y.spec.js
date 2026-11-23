const { test, expect } = require("@playwright/test");
const { withoutKnown } = require("./prueftor-bekannt");

// Prüftor (#1660): die wichtigsten öffentlichen Seiten ohne Anmeldung - Startseite, Turniere, Events, News, Anmelden,
// Registrieren und Mitglied werden. Turnier-, Match-, Event-Detail, Dashboard, Einstellungen und FAQ prüft
// a11y-pages.spec.js (läuft ebenfalls im Tor).
// - axe (WCAG 2.1 A/AA) ohne schwere Funde, bei 390 und 1440 px.
// - Kontrast: die axe-Regel color-contrast (WCAG AA, 4,5 : 1 bzw. 3 : 1 für große Schrift), bei 390 und 1440 px.
// - Tastatur: Der erste Tab trifft „Zum Inhalt springen“ (auf Seiten mit Kopfleiste), jedes weitere Ziel zeigt einen
//   sichtbaren Fokus und trägt einen Namen, der Fokus geht nicht verloren und hängt nicht fest; Umschalt+Tab führt
//   zurück.
// Funde aus der Zeit vor dem Tor stehen mit Begründung in prueftor-bekannt.json - nur neue machen den Test rot.
// Die API ist nachgestellt, alle Inhalte sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const EMPTY = { events: [], tournaments: [], challenges: [] };
const NEWS = [
  { id: "n1", slug: "rueckblick", title: "Rückblick aufs LAN-Wochenende", excerpt: "Drei Tage, zwei Turniere.", published_at: "2026-10-01T10:00:00+00:00", visibility: "public" },
  { id: "n2", slug: "winter-cup", title: "Winter Cup: Anmeldung offen", excerpt: "Jetzt Team melden.", published_at: "2026-09-28T10:00:00+00:00", visibility: "public" },
];
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: NEWS, featured_news: NEWS.slice(0, 1), stats: {}, club_numbers: {} };
const SETTINGS = {
  club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.example",
  social_links: [{ platform: "discord", label: "Discord", url: "https://discord.test/lions" }],
};

const PAGES = [
  { name: "Startseite", path: "/" },
  { name: "Turniere", path: "/tournaments" },
  { name: "Events", path: "/events" },
  { name: "News", path: "/news" },
  { name: "Anmelden", path: "/login" },
  { name: "Registrieren", path: "/register" },
  { name: "Mitglied werden", path: "/membership/join" },
];

// So viele Tab-Schritte je Seite: Kopf, Menü und der Anfang des Inhalts.
const TAB_STEPS = 25;

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/settings/public") return route.fulfill(json(SETTINGS));
    if (path === "/home/state") return route.fulfill(json(HOME));
    if (path === "/news") return route.fulfill(json(NEWS));
    return route.fulfill(json([]));
  });
}

async function open(page, entry) {
  await mockServer(page);
  await page.goto(entry.path);
  // Anmelden und Registrieren stehen ohne Kopfleiste und ohne <main> - die Überschrift gibt es überall.
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function axeViolations(page, { contrastOnly }) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async (onlyContrast) => {
    const options = onlyContrast
      ? { runOnly: { type: "rule", values: ["color-contrast"] } }
      : { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { "color-contrast": { enabled: false } } };
    const result = await window.axe.run(document, options);
    // Ein Fund je Element: Schlüssel „Regel: Ziel“ (für prueftor-bekannt.json), beim Kontrast samt Farben.
    return result.violations
      .filter((violation) => onlyContrast || ["serious", "critical"].includes(violation.impact))
      .flatMap((violation) => violation.nodes.map((node) => {
        const key = `${violation.id}: ${node.target.join(" ")}`;
        return { key, text: onlyContrast ? `${key} – ${node.any.map((check) => check.message).join(" ")}` : key };
      }));
  }, contrastOnly);
}

/** Zustand des fokussierten Elements: Name, Lage und alles, woran man einen Fokus sehen kann. */
function focusState(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body || element === document.documentElement) return null;
    const visual = (node) => {
      const own = getComputedStyle(node);
      const pseudo = (which) => {
        const style = getComputedStyle(node, which);
        return [style.content, style.boxShadow, style.outlineStyle, style.outlineColor, style.opacity, style.borderColor].join("|");
      };
      return [own.boxShadow, own.outlineStyle, own.outlineWidth, own.outlineColor, own.borderColor, own.backgroundColor,
        own.color, own.textDecorationLine, pseudo("::before"), pseudo("::after")].join("¦");
    };
    const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");
    const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => text(document.getElementById(id))).join(" ").trim();
    const labelFor = element.id ? text(document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) : "";
    const wrappingLabel = text(element.closest("label"));
    const imageAlt = [...element.querySelectorAll("img[alt], svg[aria-label]")]
      .map((node) => node.getAttribute("alt") || node.getAttribute("aria-label") || "").join(" ").trim();
    const name = (element.getAttribute("aria-label") || labelledBy || labelFor || wrappingLabel || text(element)
      || imageAlt || element.getAttribute("title") || element.getAttribute("placeholder") || "").trim();
    const focused = visual(element);
    element.blur();
    const resting = visual(element);
    element.focus();
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    return {
      key: element.getAttribute("data-testid") || `${tag}#${element.id || ""}.${String(element.className || "").slice(0, 40)}|${text(element).slice(0, 30)}`,
      label: `${element.getAttribute("data-testid") || tag} „${name.slice(0, 40) || text(element).slice(0, 40)}“`,
      href: element.getAttribute("href") || "",
      name,
      visible: rect.width > 0 && rect.height > 0,
      focusVisible: focused !== resting,
    };
  });
}

async function keyboardProblems(page) {
  // Ohne Übergänge: sonst liest der Test den Fokusring mitten im Einblenden.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  const problems = [];
  const seen = [];
  await page.keyboard.press("Tab");
  const first = await focusState(page);
  // Sprunglink nur, wo es etwas zu überspringen gibt: Seiten mit Kopfleiste (Anmelden und Registrieren haben keine).
  if (await page.locator("header").count()) {
    if (!first || first.href !== "#main-content") problems.push(`erster Tab trifft nicht „Zum Inhalt springen“, sondern ${first ? first.label : "nichts"}`);
    if (!(await page.locator("#main-content").count())) problems.push("Sprungziel #main-content fehlt");
  }
  let stillOnPage = true;
  for (let step = 0; step < TAB_STEPS; step += 1) {
    const state = step === 0 ? first : await (async () => {
      await page.keyboard.press("Tab");
      return focusState(page);
    })();
    if (!state) {
      // Fokus am Seitenende zurück in den Browser: nur ein Fehler, wenn das schon ganz am Anfang passiert.
      if (seen.length < 3) problems.push(`Fokus nach ${seen.length} Schritten verloren`);
      stillOnPage = false;
      break;
    }
    if (seen.length && seen[seen.length - 1] === state.key) {
      problems.push(`Fokus hängt fest bei ${state.label}`);
      stillOnPage = false;
      break;
    }
    seen.push(state.key);
    if (!state.name) problems.push(`ohne Namen: ${state.label}`);
    if (!state.visible) problems.push(`unsichtbares Ziel: ${state.label}`);
    if (!state.focusVisible) problems.push(`kein sichtbarer Fokus: ${state.label}`);
  }
  // Zurück nur prüfen, solange der Fokus noch auf der Seite ist (am Ende geht er in die Leiste des Browsers).
  if (stillOnPage && seen.length >= 3) {
    await page.keyboard.press("Shift+Tab");
    const back = await focusState(page);
    if (!back || back.key !== seen[seen.length - 2]) problems.push(`Umschalt+Tab führt nicht zurück (jetzt ${back ? back.label : "nichts"})`);
  }
  return [...new Set(problems)];
}

test.describe("Prüftor: öffentliche Hauptseiten (#1660)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const entry of PAGES) {
    test(`${entry.name}: axe ohne schwere Funde bei 390 und 1440 px`, async ({ page }) => {
      // Erst beide Breiten sammeln, dann prüfen: so steht jeder Fund im Bericht.
      const found = [];
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, entry);
        found.push(...withoutKnown(entry.name, "a11y", await axeViolations(page, { contrastOnly: false })).map((text) => `${width} px: ${text}`));
      }
      expect([...new Set(found)]).toEqual([]);
    });

    test(`${entry.name}: Kontrast nach WCAG AA bei 390 und 1440 px`, async ({ page }) => {
      // Ohne Bewegung: Eingeblendetes steht sofort in voller Deckkraft, axe misst die Endfarben.
      await page.emulateMedia({ reducedMotion: "reduce" });
      const found = [];
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, entry);
        found.push(...withoutKnown(entry.name, "kontrast", await axeViolations(page, { contrastOnly: true })).map((text) => `${width} px: ${text}`));
      }
      expect([...new Set(found)]).toEqual([]);
    });

    test(`${entry.name}: Tastatur - Sprunglink zuerst, sichtbarer Fokus, jedes Ziel mit Namen`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, entry);
      expect(withoutKnown(entry.name, "tastatur", await keyboardProblems(page))).toEqual([]);
    });
  }
});
