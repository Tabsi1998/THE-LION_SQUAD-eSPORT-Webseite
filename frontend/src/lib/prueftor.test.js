import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKS, MARKER, checkForTest, collectPlaywright, evaluate, firstFinding, knownGrowth, parseExceptions, raisedBudgets, renderComment,
  safeText, withoutHtmlComments,
} from "../../scripts/prueftor.mjs";
import bekannt from "../../e2e/prueftor-bekannt.js";
import { resolveFile } from "../../scripts/serve-dist.mjs";

// Prüftor (#1660): Auswertung, Ausnahmen aus dem PR-Text und der eine Kommentar im PR.

const passing = (file, title) => ({ file, title, status: "expected", error: "" });
const GOOD = {
  bundle: { ok: true, jsGzip: 287000, cssGzip: 58000, budgetJs: 305000, budgetCss: 60500, goalJs: 290000, failures: [] },
  kontrast: { ok: true, total: 35, failed: [] },
  bewegung: { total: 947, allowedTotal: 947, fresh: [], allowlistProblems: [], grown: [] },
  ladezeit: { lcpMs: 1800, fcpMs: 900, cls: 0.002, bytes: 400000, budgetLcpMs: 3000, goalLcpMs: 2000, budgetClsMilli: 100 },
  tests: [
    passing("a11y-pages.spec.js", "Barrierefreiheit (#1155) › Turnier: axe ohne schwere Funde"),
    passing("prueftor-a11y.spec.js", "Prüftor › Startseite: Kontrast nach WCAG AA bei 390 und 1440 px"),
    passing("no-layout-jump.spec.js", "kein Sprung"),
    passing("prueftor-ladezeit.spec.js", "Startseite am Handy"),
    passing("ui-motion.spec.js", "Kopfleiste"),
  ],
};

describe("Prüftor: Ausnahmen aus dem PR-Text", () => {
  it("liest eine Zeile je Prüfung, auch als Listenpunkt und in anderer Schreibung", () => {
    const body = "## Warum\nText\n- Prüftor-Ausnahme bewegung: Die Leiste wächst absichtlich in der Breite (Fortschritt).\nPRUEFTOR-AUSNAHME Bundle: Der neue Kalender muss im Start sein, weil er oben steht.";
    expect(parseExceptions(body)).toEqual({
      exceptions: {
        bewegung: "Die Leiste wächst absichtlich in der Breite (Fortschritt).",
        bundle: "Der neue Kalender muss im Start sein, weil er oben steht.",
      },
      problems: [],
    });
  });

  it("das Beispiel der PR-Vorlage (im HTML-Kommentar) ist keine Ausnahme", () => {
    const template = readFileSync(path.join(process.cwd(), "../.github/pull_request_template.md"), "utf8");
    expect(template).toContain("Prüftor-Ausnahme bewegung: Begründung");
    expect(parseExceptions(template)).toEqual({ exceptions: {}, problems: [] });
    expect(parseExceptions("<!-- offen\nPrüftor-Ausnahme bundle: das ist eine lange Begründung")).toEqual({ exceptions: {}, problems: [] });
    expect(withoutHtmlComments("a<!-- x -->b<!--y-->c")).toBe("abc");
  });

  it("verlangt eine bekannte Prüfung und eine Begründung", () => {
    const { exceptions, problems } = parseExceptions("Prüftor-Ausnahme bewegung: weil\nPrüftor-Ausnahme alles: Bitte einfach durchlassen, danke schön");
    expect(exceptions).toEqual({});
    expect(problems).toHaveLength(2);
    expect(parseExceptions(null)).toEqual({ exceptions: {}, problems: [] });
  });
});

describe("Prüftor: Auswertung", () => {
  it("ordnet Browser-Tests den Prüfungen zu, „Kontrast“ im Titel zählt zum Kontrast", () => {
    expect(checkForTest(passing("a11y-pages.spec.js", "Turnier: Kontrast (axe) bei 390 und 1440 px"))).toBe("kontrast");
    expect(checkForTest(passing("a11y-pages.spec.js", "Turnier: axe"))).toBe("a11y");
    expect(checkForTest(passing("ui-motion.spec.js", "x"))).toBe("bewegung");
    expect(checkForTest(passing("public.spec.js", "x"))).toBeNull();
  });

  it("liest den JSON-Bericht von Playwright samt Fehlermeldung", () => {
    const report = { suites: [{ file: "prueftor-a11y.spec.js", specs: [], suites: [{ title: "Prüftor", specs: [
      { title: "Startseite: Tastatur", file: "prueftor-a11y.spec.js", tests: [{ status: "unexpected", results: [{ error: { message: "\u001b[31mexpect(received).toEqual\u001b[39m\n- []" } }] }] },
    ] }] }] };
    expect(collectPlaywright([report])).toEqual([
      { file: "prueftor-a11y.spec.js", title: "Prüftor › Startseite: Tastatur", status: "unexpected", error: "expect(received).toEqual" },
    ]);
  });

  it("nennt aus einer Fehlermeldung den ersten Fund statt der Vergleichszeile", () => {
    const message = 'Error: expect(received).toEqual(expected)\n\n- Expected  - 0\n+ Received  + 1\n\n- Array []\n+ Array [\n+   "390 px: color-contrast: footer a – 3.1:1",\n+ ]';
    expect(firstFinding(message)).toBe("390 px: color-contrast: footer a – 3.1:1");
    expect(firstFinding("Test timeout of 60000ms exceeded.")).toBe("Test timeout of 60000ms exceeded.");
  });

  it("alles da und grün: Tor grün", () => {
    const result = evaluate(GOOD);
    expect(result.ok).toBe(true);
    expect(CHECKS.map((check) => result.checks[check.id].status)).toEqual(["gruen", "gruen", "gruen", "gruen", "gruen"]);
  });

  it("fehlende Teile sind rot - ein Tor, das nicht lief, ist nicht grün", () => {
    const result = evaluate({});
    expect(result.ok).toBe(false);
    expect(result.blocking).toEqual(["a11y", "kontrast", "bundle", "ladezeit", "bewegung"]);
  });

  it("neue Bewegungs-Verstöße und ein roter Browser-Test machen rot", () => {
    const bewegung = { ...GOOD.bewegung, total: 948, fresh: [{ file: "src/x.css", rule: "layout-property", count: 1, allowed: 0, findings: [{ line: 3, detail: "transition: width 1s" }] }] };
    const tests = [...GOOD.tests, { file: "a11y-pages.spec.js", title: "Match: axe", status: "unexpected", error: "button-name" }];
    const result = evaluate({ ...GOOD, bewegung, tests });
    expect(result.blocking).toEqual(["a11y", "bewegung"]);
    expect(result.checks.bewegung.details[0]).toContain("src/x.css – layout-property: 1 statt höchstens 0 (Zeile 3: transition: width 1s)");
  });

  it("eine begründete Ausnahme macht eine rote Prüfung zur Ausnahme, das Tor bleibt offen", () => {
    const bundle = { ...GOOD.bundle, ok: false, failures: ["Start-JS ist 1 Byte über der Grenze."] };
    const result = evaluate({ ...GOOD, bundle, prText: "Prüftor-Ausnahme bundle: Kalender gehört bewusst in den Start (#9999)." });
    expect(result.ok).toBe(true);
    expect(result.checks.bundle.status).toBe("ausnahme");
  });

  it("gelockerte Regeln (Ausnahmeliste erweitert, Grenze erhöht) brauchen eine Begründung", () => {
    const bewegung = { ...GOOD.bewegung, grown: [{ file: "src/x.css", rule: "token-duration", before: 0, after: 1 }] };
    const raised = raisedBudgets("<!-- budget:startup-js-gzip 400000 --><!-- budget:home-mobile-lcp-ms 3000 -->", "<!-- budget:startup-js-gzip 305000 --><!-- budget:home-mobile-lcp-ms 3000 -->");
    expect(raised).toEqual([{ key: "startup-js-gzip", before: 305000, after: 400000 }]);
    expect(evaluate({ ...GOOD, bewegung, raised }).blocking).toEqual(["bundle", "bewegung"]);
    const justified = evaluate({ ...GOOD, bewegung, raised, prText: "Prüftor-Ausnahme bewegung: Ticker läuft bewusst mit 1,2 s.\nPrüftor-Ausnahme bundle: Grenze nach Messung neu gesetzt (#1234)." });
    expect(justified.ok).toBe(true);
  });
});

describe("Prüftor: Kommentar", () => {
  it("trägt die Marke zum Wiederfinden, die Tabelle und den Vergleich mit main", () => {
    const base = { sha: "abcdef1234567", date: "2026-11-20", checks: { bundle: { metrics: { jsGzip: 286000, cssGzip: 58000 } }, ladezeit: { metrics: { lcpMs: 1700, cls: 0.002 } }, bewegung: { metrics: { funde: 950 } } } };
    const text = renderComment(evaluate(GOOD), { base, sha: "1234567890", runUrl: "https://github.com/o/r/actions/runs/1" });
    expect(text.startsWith(MARKER)).toBe(true);
    expect(text).toContain("**Ergebnis: grün**");
    expect(text).toContain("JS 287.000 B (+1.000 B) / Grenze 305.000 B");
    expect(text).toContain("LCP 1.800 ms (+100 ms) / Grenze 3.000 ms");
    expect(text).toContain("Bestand 947 (−3)");
    expect(text).toContain("Vergleich: main abcdef123 vom 2026-11-20");
  });

  it("zeigt Ausnahmen mit Begründung und entschärft Text aus dem PR", () => {
    const result = evaluate({ ...GOOD, kontrast: { ok: false, total: 35, failed: ["Gold auf Weiß: 1.4:1"] }, prText: "Prüftor-Ausnahme kontrast: @team <b>bitte</b> `so` lassen | weil Marke" });
    const text = renderComment(result);
    expect(text).toContain("**Ergebnis: grün mit Ausnahme**");
    expect(text).toContain("„@​team ‹b›bitte‹/b› 'so' lassen / weil Marke“");
    expect(text).toContain("Vergleich: noch kein Ergebnis von main");
    expect(safeText("a\n\nb", 3)).toBe("a b");
  });
});

describe("Prüftor: bekannte Funde bei Barrierefreiheit und Kontrast", () => {
  const grund = "Bestand vor dem Prüftor (#1660), Umbau folgt.";
  const list = { funde: [{ seite: "Startseite", art: "kontrast", ziel: "color-contrast: footer a", grund }] };

  it("filtert nur bekannte Funde derselben Seite und Art heraus", () => {
    const findings = [{ key: "color-contrast: footer a", text: "color-contrast: footer a – 3.1:1" }, "color-contrast: main p"];
    expect(bekannt.withoutKnown("Startseite", "kontrast", findings, list)).toEqual(["color-contrast: main p"]);
    expect(bekannt.withoutKnown("News", "kontrast", findings, list)).toHaveLength(2);
    expect(bekannt.withoutKnown("Startseite", "a11y", findings, list)).toHaveLength(2);
  });

  it("jeder Eintrag der echten Liste hat Seite, Art, Ziel und Begründung", () => {
    expect(bekannt.problems()).toEqual([]);
    expect(bekannt.problems({ funde: [{ seite: "X", art: "farbe", ziel: "", grund: "kurz" }] })).toHaveLength(3);
  });

  it("ein neuer bekannter Fund gegenüber main braucht eine Begründung im PR", () => {
    const current = { funde: [...list.funde, { seite: "Events", art: "tastatur", ziel: "ohne Namen: button", grund }] };
    const added = knownGrowth(current, list);
    expect(added).toEqual([{ seite: "Events", art: "tastatur", ziel: "ohne Namen: button", grund, check: "a11y" }]);
    expect(evaluate({ ...GOOD, knownAdded: added }).blocking).toEqual(["a11y"]);
    expect(knownGrowth(list, list)).toEqual([]);
  });
});

describe("Prüftor: dist-Server", () => {
  const root = path.resolve("dist-gibt-es-nicht");
  it("bleibt in dist und fällt sonst auf index.html zurück", () => {
    expect(resolveFile(root, "/../../etc/passwd")).toBe(path.join(root, "index.html"));
    expect(resolveFile(root, "/tournaments/herbst-cup?x=1")).toBe(path.join(root, "index.html"));
    expect(resolveFile(root, "/%E0%A4%A")).toBe(path.join(root, "index.html"));
  });
});
