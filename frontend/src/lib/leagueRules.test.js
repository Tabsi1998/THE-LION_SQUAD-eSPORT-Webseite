import {
  addAnnex, annexLabel, changeRows, clearHits, dayLabel, findRanges, insertBlock, moveAnnex, paintHits, removeAnnex, renderRulesMarkdown,
  renderRulesSection, rulesApiPath, rulesMediaProps, rulesPagePath, tocOf,
} from "./leagueRules";

const SECTIONS = [
  { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort" },
  { anchor: "fairplay", title: "§ 1 Fairplay", level: 1, kind: "main", body_md: "Text" },
  { anchor: "maps", title: "Maps", level: 2, kind: "main", body_md: "Text" },
  { anchor: "details", title: "Details", level: 3, kind: "main", body_md: "Text" },
  { anchor: "anlage-a", title: "Anlage A: Strafen", level: 1, kind: "annex", body_md: "Text" },
];

test("Adressen je Liga und Season", () => {
  expect(rulesApiPath("probe", "season-1")).toBe("/league-rules/seasons/probe/season-1");
  expect(rulesApiPath("probe")).toBe("/league-rules/leagues/probe");
  expect(rulesPagePath("probe", "season-1")).toBe("/liga/probe/season-1/regeln");
  expect(rulesPagePath("probe")).toBe("/liga/probe/regeln");
});

test("Inhaltsverzeichnis: Überschriften bis Ebene 2, Anlagen getrennt, kein Eintrag ohne Titel", () => {
  const toc = tocOf(SECTIONS);
  expect(toc.main.map((row) => row.anchor)).toEqual(["fairplay", "maps"]);
  expect(toc.annexes.map((row) => row.anchor)).toEqual(["anlage-a"]);
});

test("Tag in Wiener Schreibweise, Unbekanntes bleibt leer", () => {
  expect(dayLabel("2030-03-05")).toBe("05.03.2030");
  expect(dayLabel(null)).toBe("");
});

test("Änderungsliste: neu und geändert verlinkt, entfernt nur als Titel", () => {
  const rows = changeRows({ new: [{ anchor: "dazu", title: "Dazu" }], changed: [{ anchor: "anders", title: "Anders" }],
    removed: [{ anchor: "weg", title: "Weg" }, { anchor: "einleitung", title: null }] });
  expect(rows).toEqual([
    { kind: "changed", word: "Geändert", anchor: "anders", title: "Anders" },
    { kind: "new", word: "Neu", anchor: "dazu", title: "Dazu" },
    { kind: "removed", word: "Entfernt", anchor: null, title: "Weg" },
    { kind: "removed", word: "Entfernt", anchor: null, title: "Einleitung" },
  ]);
});

describe("Markdown sicher", () => {
  test("rohes HTML bleibt Text, Skript-Links fallen weg", () => {
    const html = renderRulesMarkdown("<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=y>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
  });

  test("nur eigene Uploads werden als Bild geladen, fremde Adressen bleiben Link oder Text", () => {
    const own = renderRulesMarkdown("![Plan](/api/static/uploads/plan-1.webp?v=3)");
    expect(own).toContain('<img src="/api/static/uploads/plan-1.webp?v=3"');
    const foreign = renderRulesMarkdown("![Plan](https://bilder.example.test/plan.png)");
    expect(foreign).not.toContain("<img");
    expect(foreign).toContain('<a href="https://bilder.example.test/plan.png"');
    expect(foreign).toContain(">Plan</a>");
    for (const address of ["//bilder.example.test/a.png", "/api/static/uploads/a.svg", "/api/static/uploads/../a.png", "/anderswo/a.png"]) {
      expect(renderRulesMarkdown(`![Plan](${address})`)).not.toContain("<img");
    }
    expect(renderRulesMarkdown("![Plan](javascript:alert)")).toBe("<p>Plan</p>");
  });

  test("ausgelieferte Abschnitte: Namen mit Escapes bleiben Text, freier Text wie geschrieben; der Editor zeigt den Text roh (#2218)", () => {
    // So kommt `sections[].body_md` von der API (services/markdown_text.served).
    const section = renderRulesSection("| Name | Gilt in |\n| --- | --- |\n| Schild \\[Test\\] \\*x\\* | alle |\n\nPfad C:\\\\Daten und \\\\_frei\\\\_");
    expect(section).toContain("<td>Schild [Test] *x*</td>");
    expect(section).toContain("Pfad C:\\Daten und \\_frei\\_");
    expect(section).not.toContain("<em>");
    expect(renderRulesMarkdown("Pfad C:\\Daten und \\_frei\\_")).toContain("Pfad C:\\Daten und \\_frei\\_");
  });

  test("Sprünge bleiben in der Seite, Links nach außen öffnen neu, @ wird kein Profil-Link", () => {
    const html = renderRulesMarkdown("[oben](#fairplay) [außen](https://example.org) @leitung");
    expect(html).toContain('<a href="#fairplay">oben</a>');
    expect(html).toContain('href="https://example.org" target="_blank"');
    expect(html).not.toContain("/u/leitung");
  });
});

describe("Suche in der Seite", () => {
  function article(html) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }
  afterEach(() => { document.body.innerHTML = ""; clearHits(); });

  test("findet Treffer über Absätze, groß und klein egal, Umlaute und Sonderzeichen wörtlich", () => {
    const root = article("<h2>Größe (Teams)</h2><p>Die <strong>größe</strong> zählt. GRÖSSE nicht.</p>");
    expect(findRanges(root, "größe")).toHaveLength(2);
    expect(findRanges(root, "(teams)")).toHaveLength(1);
    expect(findRanges(root, "nichtda")).toHaveLength(0);
  });

  test("unter zwei Zeichen sucht nichts", () => {
    expect(findRanges(article("<p>a b c</p>"), "a")).toHaveLength(0);
    expect(findRanges(article("<p>a b c</p>"), "  ")).toHaveLength(0);
  });

  test("ohne Highlight-Schnittstelle im Browser geht nichts kaputt", () => {
    const root = article("<p>Regel eins, Regel zwei</p>");
    const ranges = findRanges(root, "regel");
    expect(() => paintHits(ranges, 0)).not.toThrow();
  });
});

describe("Pflege", () => {
  test("Anlagen bekommen ihren Buchstaben aus der Reihenfolge", () => {
    expect(annexLabel(0)).toBe("Anlage A");
    expect(annexLabel(2)).toBe("Anlage C");
    const list = addAnnex(addAnnex([]));
    expect(list).toHaveLength(2);
    const named = [{ title: "Eins", body_md: "" }, { title: "Zwei", body_md: "" }];
    expect(moveAnnex(named, 1, -1).map((row) => row.title)).toEqual(["Zwei", "Eins"]);
    expect(moveAnnex(named, 0, -1).map((row) => row.title)).toEqual(["Eins", "Zwei"]);
    expect(removeAnnex(named, 0).map((row) => row.title)).toEqual(["Zwei"]);
  });

  test("Baustein kommt als eigener Absatz ans Ende", () => {
    expect(insertBlock("", "[[baustein:map_pool]]")).toBe("[[baustein:map_pool]]\n");
    expect(insertBlock("# Maps\n", "[[baustein:map_pool]]")).toBe("# Maps\n\n[[baustein:map_pool]]\n");
  });
});

test("Bilder im Editor: Admin-Medien nur mit der Rolle, Zuständige laden eigene Bilder", () => {
  for (const role of ["tournament_admin", "club_admin", "superadmin", "admin"]) expect(rulesMediaProps({ role })).toEqual({});
  for (const user of [{ role: "player", areas: [] }, { role: "moderator", areas: ["leagues"] }, null]) {
    expect(rulesMediaProps(user)).toEqual({ mediaScope: "user", libraryEndpoint: "/media?type=images" });
  }
});
