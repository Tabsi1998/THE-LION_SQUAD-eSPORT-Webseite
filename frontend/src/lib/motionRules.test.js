import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowlistGrowth, allowlistProblems, compare, countFindings, cssDeclarations, markChanged, parseDiffLines, scanCss, scanJs,
  scanTree, slackProblems, tightened, transitionProperties,
} from "../../scripts/check-motion-rules.mjs";

// Bewegungsregeln (#1660, Entscheidung 15.10.2026): nur transform/opacity animieren, „Bewegung reduzieren“ beachten,
// Dauern und Kurven aus den Tokens. Bestehende Verstöße stehen mit Begründung in motion-rules-allowlist.json; dieser
// Wächter schlägt nur bei neuen an. Das Prüftor in der CI liest dasselbe Skript.

const root = process.cwd();
const rules = (findings) => findings.map((finding) => finding.rule).sort();

describe("Bewegungsregeln: CSS", () => {
  it("lässt transform und opacity mit Token-Dauer und Token-Kurve durch", () => {
    const css = ".a { transition: transform var(--tls-motion-mid) var(--tls-ease), opacity var(--tls-motion-fast) var(--tls-ease); }";
    expect(scanCss(css)).toEqual([]);
  });

  it("meldet Breite, Höhe und `all` als Layout - auch die Kurzform ohne Eigenschaft", () => {
    expect(rules(scanCss(".a { transition: width var(--tls-motion-mid) var(--tls-ease); }"))).toEqual(["layout-property"]);
    expect(rules(scanCss(".a { transition-property: max-height; }"))).toEqual(["layout-property"]);
    expect(rules(scanCss(".a { transition: all var(--tls-motion-mid); }"))).toEqual(["layout-property"]);
    expect(transitionProperties("var(--tls-motion-mid)")).toEqual([]);
    expect(transitionProperties("0.2s ease")).toEqual(["all"]);
    expect(transitionProperties("opacity 0.2s, top 0.3s")).toEqual(["opacity", "top"]);
  });

  it("meldet Keyframes, die das Layout ändern, einmal je Keyframes-Block", () => {
    const css = "@keyframes grow { from { height: 0; width: 0; } to { height: 10px; } } @keyframes fade { to { opacity: 0; } }";
    expect(scanCss(css)).toEqual([expect.objectContaining({ rule: "layout-property", detail: "@keyframes grow ändert height" })]);
  });

  it("Farbe und Schatten sind kein Layout", () => {
    expect(scanCss(".a { transition: color var(--tls-motion-fast) var(--tls-ease), box-shadow var(--tls-motion-fast) var(--tls-ease); }")).toEqual([]);
  });

  it("meldet feste Dauern und Kurven, lässt linear, steps() und Nullwerte durch", () => {
    expect(rules(scanCss(".a { transition: opacity 300ms ease-in-out; }"))).toEqual(["token-duration", "token-easing"]);
    expect(rules(scanCss(".a { transition: transform var(--tls-motion-mid) cubic-bezier(0.4, 0, 0.2, 1); }"))).toEqual(["token-easing"]);
    expect(rules(scanCss(".a { transition-duration: .2s; }"))).toEqual(["token-duration"]);
    expect(scanCss(".a { transition: opacity 0s linear; }")).toEqual([]);
    expect(scanCss(".a { transition-timing-function: steps(4); }")).toEqual([]);
  });

  it("zählt nichts in Blöcken für „Bewegung reduzieren“ und nichts in eigenen Variablen", () => {
    const css = ":root { --x-ease: cubic-bezier(0.2, 0, 0, 1); } @media (prefers-reduced-motion: reduce) { .a { transition: width 0.01ms ease; } }";
    expect(scanCss(css)).toEqual([]);
  });

  it("Animation mit fester Dauer braucht ein Gegenstück für „Bewegung reduzieren“", () => {
    const bare = "@keyframes pulse { to { opacity: 0.5; } } .live { animation: pulse 1.6s linear infinite; }";
    expect(rules(scanCss(bare))).toEqual(["reduced-motion", "token-duration"]);
    const handled = `${bare} @media (prefers-reduced-motion: reduce) { .live { animation: none; } }`;
    expect(rules(scanCss(handled))).toEqual(["token-duration"]);
    // Global in index.css abgestellt zählt auch.
    expect(rules(scanCss(bare, { globalReduced: new Set([".live"]) }))).toEqual(["token-duration"]);
    // Nur bei „keine Vorliebe“ - dann bewegt sich mit „Bewegung reduzieren“ ohnehin nichts.
    expect(rules(scanCss("@media (prefers-reduced-motion: no-preference) { .live { animation: pulse 1.6s linear infinite; } }"))).toEqual(["token-duration"]);
    // Token-Dauer: der zentrale Block in index.css stellt sie ab.
    expect(scanCss(".a { animation: fade var(--tls-motion-mid) var(--tls-ease) both; }")).toEqual([]);
    expect(scanCss(".a { animation: none !important; }")).toEqual([]);
  });

  it("liest Deklarationen mit Zeile und Umfeld, Kommentare zählen nicht", () => {
    const declarations = cssDeclarations("/* .x { transition: width 1s; } */\n@media (min-width: 10px) {\n  .a { transition: opacity 1s; }\n}");
    expect(declarations).toEqual([{ prop: "transition", value: "opacity 1s", line: 3, context: ["@media (min-width: 10px)", ".a"] }]);
  });
});

describe("Bewegungsregeln: JS und JSX", () => {
  it("Tailwind: transition-all, Zahlen-Dauern und Standard-Kurven werden gemeldet, Token-Namen nicht", () => {
    expect(rules(scanJs('<div className="transition-all duration-300 ease-in-out" />'))).toEqual(["layout-property", "token-duration", "token-easing"]);
    expect(rules(scanJs('<div className="transition-[height] hover:duration-150" />'))).toEqual(["layout-property", "token-duration"]);
    expect(scanJs('<div className="transition-transform duration-mid ease-tls duration-0" />')).toEqual([]);
  });

  it("Tailwind animate-*: nur mit motion-safe:/motion-reduce:, der Spinner ist erlaubt", () => {
    expect(rules(scanJs('<span className="animate-pulse" />'))).toEqual(["reduced-motion"]);
    expect(scanJs('<span className="motion-safe:animate-pulse" />')).toEqual([]);
    expect(scanJs('<span className="animate-pulse motion-reduce:animate-none" />')).toEqual([]);
    expect(scanJs('<Loader2 className="h-4 w-4 animate-spin" />')).toEqual([]);
    expect(scanJs('<span className="animate-live" />', { globalReduced: new Set([".animate-live"]) })).toEqual([]);
  });

  it("Inline-Stile werden wie CSS gelesen", () => {
    expect(rules(scanJs('const style = { transition: "width 300ms ease" };'))).toEqual(["layout-property", "token-duration", "token-easing"]);
    expect(scanJs("const style = { transition: `opacity var(--tls-motion-mid) var(--tls-ease)` };")).toEqual([]);
  });

  it("framer-motion: Layout in animate, feste Dauer und Kurve, Endlos-Schleife ohne Abfrage", () => {
    const head = 'import { motion } from "framer-motion";\n';
    expect(rules(scanJs(`${head}<motion.div animate={{ height: open ? "auto" : 0, opacity: 1 }} />`))).toEqual(["layout-property"]);
    expect(scanJs(`${head}<motion.div animate={{ x: 0, opacity: 1, scale: 1 }} transition={motionTransition("mid")} />`)).toEqual([]);
    expect(rules(scanJs(`${head}const t = { duration: 0.35, ease: "easeOut" };`))).toEqual(["token-duration", "token-easing"]);
    expect(rules(scanJs(`${head}const t = { ease: [0.4, 0, 0.2, 1] };`))).toEqual(["token-easing"]);
    expect(scanJs(`${head}const t = { duration: 0, ease: [...MOTION.ease] }; const u = { ease: "linear" };`)).toEqual([]);
    expect(rules(scanJs(`${head}const t = { repeat: Infinity };`))).toEqual(["reduced-motion"]);
    expect(scanJs(`${head}const reduce = useReducedMotion(); const t = { repeat: reduce ? 0 : Infinity };`)).toEqual([]);
  });

  it("Dateien ohne framer-motion: Zahlen wie duration: 5000 (Hinweis-Dauer) zählen nicht", () => {
    expect(scanJs('toast.success("Gespeichert", { duration: 5000 });')).toEqual([]);
  });
});

describe("Bewegungsregeln: Ausnahmeliste", () => {
  const findings = { "src/a.css": [{ rule: "token-duration", line: 1 }, { rule: "token-duration", line: 2 }], "src/b.jsx": [{ rule: "layout-property", line: 3 }] };
  const grund = "Bestand vor dem Prüftor (#1660): Umbau steht aus.";

  it("meldet nur, was über der erlaubten Zahl liegt, und zeigt Luft", () => {
    const allowlist = { ausnahmen: { "src/a.css": { "token-duration": { anzahl: 3, grund } }, "src/b.jsx": { "layout-property": { anzahl: 1, grund } } } };
    expect(compare(findings, allowlist)).toMatchObject({ fresh: [], total: 3, allowedTotal: 4, slack: [{ file: "src/a.css", count: 2, allowed: 3 }] });
    const tight = { ausnahmen: { "src/a.css": { "token-duration": { anzahl: 1, grund } } } };
    expect(compare(findings, tight).fresh.map((item) => [item.file, item.rule, item.count, item.allowed])).toEqual([
      ["src/a.css", "token-duration", 2, 1], ["src/b.jsx", "layout-property", 1, 0],
    ]);
  });

  it("verlangt Regel, Zahl und Begründung", () => {
    expect(allowlistProblems({ ausnahmen: { "src/a.css": { "token-duration": { anzahl: 2, grund } } } })).toEqual([]);
    expect(allowlistProblems({ ausnahmen: { "src/a.css": { foo: { anzahl: 0, grund: "kurz" } } } })).toHaveLength(3);
  });

  it("liest geänderte Zeilen aus dem Diff und nennt deren Funde zuerst", () => {
    const diff = [
      "diff --git a/src/a.css b/src/a.css", "--- a/src/a.css", "+++ b/src/a.css", "@@ -10,0 +11,2 @@ .x {", "+a", "+b",
      "@@ -40 +42 @@", "-c", "+d", "diff --git a/src/gone.css b/src/gone.css", "--- a/src/gone.css", "+++ /dev/null", "@@ -1,3 +0,0 @@",
    ].join("\n");
    expect(parseDiffLines(diff)).toEqual({ "src/a.css": new Set([11, 12, 42]) });
    const fresh = [{ file: "src/a.css", rule: "token-duration", count: 2, allowed: 1, findings: [{ rule: "token-duration", line: 2 }, { rule: "token-duration", line: 12 }] }];
    expect(markChanged(fresh, parseDiffLines(diff))[0].findings).toEqual([
      { rule: "token-duration", line: 12, geaendert: true }, { rule: "token-duration", line: 2, geaendert: false },
    ]);
  });

  it("nennt Luft mit dem Hinweis auf --tighten", () => {
    expect(slackProblems([{ file: "src/a.css", rule: "token-duration", count: 2, allowed: 3 }]))
      .toEqual(['src/a.css – token-duration: erlaubt 3, gefunden 2 – "--tighten" ausführen']);
  });

  it("erkennt eine gewachsene Liste gegenüber main und senkt nur, nie hinauf", () => {
    const base = { ausnahmen: { "src/a.css": { "token-duration": { anzahl: 1, grund } } } };
    const current = { ausnahmen: { "src/a.css": { "token-duration": { anzahl: 2, grund } }, "src/c.css": { "token-easing": { anzahl: 1, grund } } } };
    expect(allowlistGrowth(current, base).map((item) => [item.file, item.before, item.after])).toEqual([["src/a.css", 1, 2], ["src/c.css", 0, 1]]);
    const lowered = tightened({ ausnahmen: { "src/a.css": { "token-duration": { anzahl: 5, grund } }, "src/gone.css": { "token-easing": { anzahl: 1, grund } } } }, findings);
    expect(lowered.ausnahmen).toEqual({ "src/a.css": { "token-duration": { anzahl: 2, grund } } });
    expect(countFindings(findings)).toEqual({ "src/a.css": { "token-duration": 2 }, "src/b.jsx": { "layout-property": 1 } });
  });
});

describe("Bewegungsregeln: Wächter über src", () => {
  const allowlist = JSON.parse(readFileSync(path.join(root, "motion-rules-allowlist.json"), "utf8"));

  it("jede Ausnahme hat eine bekannte Regel, eine Zahl und eine Begründung", () => {
    expect(allowlistProblems(allowlist)).toEqual([]);
  });

  // Liest alle Quelldateien: allein gut 2 s, auf einem ausgelasteten Rechner (volle Suite parallel) mehr als die
  // 5 s Vorgabe - darum ein eigenes Zeitlimit.
  it("keine neuen Verstöße gegenüber der Ausnahmeliste und keine Luft darin", () => {
    const { fresh, slack } = compare(scanTree(root), allowlist);
    const report = fresh.map((item) => `${item.file} ${item.rule}: ${item.count} statt höchstens ${item.allowed} `
      + `(${item.findings.map((finding) => `Zeile ${finding.line}`).join(", ")})`);
    expect(report).toEqual([]);
    // Luft: Die Liste erlaubt mehr, als es gibt - sonst kämen später unbemerkt neue Verstöße bis zur alten Zahl dazu.
    // Behebung: node scripts/check-motion-rules.mjs --tighten
    expect(slackProblems(slack)).toEqual([]);
  }, 30_000);
});
