// Selbsttest des Umbaus auf die Schrift-Treppe (#1302): node --test scripts/type-codemod.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, quietSmallText, rewriteTokens, transformCss, transformSource } from "./type-codemod.mjs";

const run = (code, file = "src/pages/public/X.jsx") => transformSource(code, { file });

test("kurzes GROSSES Etikett unter 12 px wird tls-type-label; Größe, Stärke, Sperrung und GROSS fallen weg", () => {
  const { code } = run('const a = <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Kalender</span>;');
  assert.equal(code, 'const a = <span className="tls-type-label text-[#29B6E8]">Kalender</span>;');
});

test("kleiner Text ohne GROSS wird tls-type-small (14 px), text-xs auch", () => {
  assert.equal(run('<div className="mt-2 text-[11px] text-white/40">{when}</div>').code, '<div className="mt-2 tls-type-small text-white/40">{when}</div>');
  assert.equal(run('<span className="text-xs text-white/60">vor 3 Std.</span>').code, '<span className="tls-type-small text-white/60">vor 3 Std.</span>');
});

test("ein Name in einem GROSSEN Etikett wird nicht GROSS geschrieben, sondern Klein", () => {
  const { code } = run('<span className="text-[10px] uppercase tracking-widest font-bold">{player.username}</span>');
  // Hervorhebung (fett) darf bleiben - Klein ist eine Größe, keine Stärke.
  assert.equal(code, '<span className="tls-type-small font-bold">{player.username}</span>');
  const team = run('<span className="text-xs uppercase">{match.team_a_name}</span>').code;
  assert.equal(team, '<span className="tls-type-small">{match.team_a_name}</span>');
});

test("ein Etikett mit berechnetem Zustand bleibt Etikett", () => {
  assert.equal(run('<span className="text-[10px] uppercase font-black">{item.status_label}</span>').code, '<span className="tls-type-label">{item.status_label}</span>');
});

test("langer GROSSER Text ist kein Etikett mehr", () => {
  const { code } = run('<p className="text-xs uppercase tracking-wider text-white/50">Bitte melde dich bis Freitag beim Turnierleiter an</p>');
  assert.equal(code, '<p className="tls-type-small text-white/50">Bitte melde dich bis Freitag beim Turnierleiter an</p>');
});

test("Seitentitel h1: tls-type-title ohne GROSS, kurzer fester Text bekommt <ShortCaps>", () => {
  const source = 'import { X } from "x";\nconst a = <h1 className="font-heading text-3xl md:text-5xl font-black uppercase break-words">Turniere</h1>;';
  const { code } = run(source);
  assert.match(code, /<h1 className="tls-type-title break-words"><ShortCaps>Turniere<\/ShortCaps><\/h1>/);
  assert.match(code, /import \{ ShortCaps \} from "@\/components\/tls\/ShortCaps";/);
});

test("Seitentitel mit Inhalt (Titel einer News, Name) bleibt, wie er eingetippt wurde - ohne ShortCaps", () => {
  const { code } = run('<h1 className="mt-3 font-heading text-3xl md:text-5xl xl:text-6xl font-black uppercase leading-[1.02] break-words">{post.title}</h1>');
  assert.equal(code, '<h1 className="mt-3 tls-type-title leading-[1.02] break-words">{post.title}</h1>');
});

test("Seitentitel aus einer Eigenschaft `title` bekommt ShortCaps", () => {
  const { code } = run('function A({ title }) { return <h1 className="font-heading text-4xl font-black uppercase">{title}</h1>; }');
  assert.match(code, /<h1 className="tls-type-title"><ShortCaps>\{title\}<\/ShortCaps><\/h1>/);
});

test("auch eine sehr große h1 ist Seitentitel - die Bühne setzt man von Hand", () => {
  const { code } = run('<h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.95] text-white">Galerie</h1>');
  assert.match(code, /<h1 className="tls-type-title leading-\[0\.95\] text-white"><ShortCaps>Galerie<\/ShortCaps><\/h1>/);
});

test("h2 wird Abschnitt (Outfit, normal geschrieben), h3 und Kartentitel werden Kartentitel", () => {
  assert.equal(run('<h2 className="font-heading text-2xl font-black uppercase">Aktuell ruht das Rudel</h2>').code, '<h2 className="tls-type-section">Aktuell ruht das Rudel</h2>');
  assert.equal(run('<h3 className="tls-card__title font-heading font-bold text-xl text-white line-clamp-2">{t.title}</h3>').code, '<h3 className="tls-card__title tls-type-card text-white line-clamp-2">{t.title}</h3>');
  assert.equal(run('<h3 className="text-lg font-semibold">Mitglieder</h3>').code, '<h3 className="tls-type-card">Mitglieder</h3>');
});

test("Überschrift ohne eigene Größe verliert nur die GROSS-Schreibung", () => {
  assert.equal(run('<h3 className="font-bold uppercase tracking-wide">Kontakt</h3>').code, '<h3 className="font-bold">Kontakt</h3>');
});

test("Zahlen: font-display, tabular-nums oder font-heading mit Zahl werden tls-type-num - Größe nach Stelle", () => {
  assert.equal(run('<div className="font-heading text-3xl md:text-4xl font-black text-white tabular-nums"><CountUp value={value} /></div>').code, '<div className="tls-type-title tls-type-num text-white"><CountUp value={value} /></div>');
  assert.equal(run('<span className="font-display font-bold text-lg tabular-nums">{showLapTime(t.time_str)}</span>').code, '<span className="tls-type-card tls-type-num">{showLapTime(t.time_str)}</span>');
  assert.equal(run('<span className="font-heading font-black text-2xl">{stats.points}</span>').code, '<span className="tls-type-section tls-type-num">{stats.points}</span>');
  assert.equal(run('<td className="text-xs tabular-nums">{row.wins}</td>').code, '<td className="tls-type-small tls-type-num">{row.wins}</td>');
  assert.equal(run('<span className="tabular-nums">{n}</span>').code, '<span className="tabular-nums">{n}</span>');
});

test("font-heading ohne Größe außerhalb von Überschriften: nur die Schrift fällt weg", () => {
  assert.equal(run('<div className="font-heading font-bold leading-tight flex">{x.label}</div>').code, '<div className="font-bold leading-tight flex">{x.label}</div>');
});

test("Fließtext: p mit langem Text oder Beschreibung wird tls-type-body, kurzer Hinweis Klein", () => {
  const long = "Hier steht ein längerer Absatz, der mehr als achtzig Zeichen lang ist und deshalb Fließtext sein muss.";
  assert.equal(run(`<p className="text-sm text-white/70">${long}</p>`).code, `<p className="tls-type-body text-white/70">${long}</p>`);
  assert.equal(run('<p className="text-sm text-white/70">{news.excerpt}</p>').code, '<p className="tls-type-body text-white/70">{news.excerpt}</p>');
  assert.equal(run('<p className="text-sm text-white/50">Noch keine Einträge.</p>').code, '<p className="tls-type-small text-white/50">Noch keine Einträge.</p>');
  assert.equal(run('<p className="text-base md:text-lg text-white/70">{intro}</p>').code, '<p className="tls-type-body text-white/70">{intro}</p>');
});

test("Knöpfe dürfen GROSS bleiben", () => {
  assert.equal(run('<button className="tls-btn tls-btn--primary px-4 py-2 text-sm font-bold uppercase tracking-wider">Anmelden</button>').code, '<button className="tls-btn tls-btn--primary px-4 py-2 tls-type-small font-bold uppercase tracking-wider">Anmelden</button>');
  assert.equal(run('<button className="text-[10px] uppercase tracking-widest font-bold">Mehr</button>').code, '<button className="tls-type-label">Mehr</button>');
});

test("Eingabefelder, SVG-Text, Zähler an Symbolen und sehr große Einzelwerte bleiben", () => {
  for (const source of [
    '<input className="w-full text-sm bg-black" />',
    '<text className="text-[10px] fill-white">A</text>',
    '<span className="absolute -top-1 -right-1 rounded-full text-[9px] font-bold">{count}</span>',
    '<div className="font-heading text-[160px] leading-none">404</div>',
  ]) assert.equal(run(source).code, source);
});

test("Vorlagen: Zweige mit derselben Stufe werden umgebaut, sonst kommt die Stelle in den Bericht", () => {
  const same = run('<span className={`tls-card__title font-heading font-black leading-tight ${size === "lg" ? "text-lg md:text-xl" : "text-base"}`}>{names.primary}</span>');
  // Leer gewordene Zweige fallen ganz weg.
  assert.equal(same.code, '<span className="tls-card__title tls-type-card leading-tight">{names.primary}</span>');
  const mixed = run('<h3 className={`tls-card__title font-heading uppercase ${featured ? "text-2xl" : "text-sm"}`}>{news.title}</h3>');
  assert.equal(mixed.changed, 0);
  assert.equal(mixed.manual.length, 1);
});

test("Klassen in Objekten und Konstanten werden nach Größe umgebaut; Stil-Objekte bleiben", () => {
  assert.equal(run('const SIZES = { sm: "text-[10px] px-2", md: "text-xs px-3" };').code, 'const SIZES = { sm: "tls-type-small px-2", md: "tls-type-small px-3" };');
  assert.equal(run('const S = { live: "bg-live/20 text-live" };').code, 'const S = { live: "bg-live/20 text-live" };');
  assert.equal(run('const s = { textTransform: "uppercase" };').code, 'const s = { textTransform: "uppercase" };');
  assert.equal(run('const label = "Turniere uppercase";').code, 'const label = "Turniere uppercase";');
});

test("Farben mit text-[…] sind keine Größen", () => {
  assert.equal(run('<span className="text-[#FFD700] text-[var(--x)]">x</span>').code, '<span className="text-[#FFD700] text-[var(--x)]">x</span>');
});

test("schon umgebaute Stellen bleiben (zweiter Lauf ändert nichts)", () => {
  const once = run('<h2 className="font-heading text-2xl font-black uppercase">Aktuell</h2>').code;
  assert.equal(run(once).code, once);
  assert.equal(classify(["tls-type-small", "text-xs"]), null);
});

test("rewriteTokens setzt die Stufe an die Stelle der ersten entfernten Klasse", () => {
  assert.deepEqual(rewriteTokens(["mt-2", "text-xs", "text-white", "uppercase"], { step: "label" }), ["mt-2", "tls-type-label", "text-white"]);
});

test("TV-Bausteine (Klassen tv-…) behalten ihre Schrift - auch in geteilten Bausteinen", () => {
  const source = '<h3 className="tv-tree__phase tv-t-head font-heading">{stage.name}</h3>';
  assert.equal(run(source).code, source);
});

test("Zahl nur bei Zahlen: ein Text mit Zustand (state) oder festen Wörtern ist keine Zahl", () => {
  assert.equal(run('<span className="font-heading font-black uppercase tracking-wider text-warn">{preview.state === "app_only" ? "Nur in der App" : "Noch nicht öffentlich"}</span>').code,
    '<span className="font-black uppercase tracking-wider text-warn">{preview.state === "app_only" ? "Nur in der App" : "Noch nicht öffentlich"}</span>');
  assert.equal(run('<span className="font-display tracking-widest font-bold text-sm">LIVE JETZT</span>').code, '<span className="tls-type-label">LIVE JETZT</span>');
  assert.equal(run('<span className="font-display font-bold text-lg">{points} Pkt.</span>').code, '<span className="tls-type-card tls-type-num">{points} Pkt.</span>');
});

test("tabular-nums an kleinem Text: gleich breite Ziffern bleiben, die Schrift bleibt Outfit", () => {
  assert.equal(run('<div className="mt-1 text-xs text-white/55 tabular-nums">{counts}</div>').code, '<div className="mt-1 tls-type-small text-white/55 tabular-nums">{counts}</div>');
});

test("Fließtext: text-sm mit leading-relaxed ist Text; ein Vorspann (p) bis 23 px auch; text-xs nie", () => {
  assert.equal(run('<div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">{children}</div>').code, '<div className="mt-10 space-y-8 tls-type-body leading-relaxed text-white/75">{children}</div>');
  assert.equal(run('<p className="mt-4 text-lg xl:text-xl text-white/70">{post.excerpt}</p>').code, '<p className="mt-4 tls-type-body text-white/70">{post.excerpt}</p>');
  assert.equal(run('<p className="mt-2 text-xs text-white/60 line-clamp-3">{news.excerpt}</p>').code, '<p className="mt-2 tls-type-small text-white/60 line-clamp-3">{news.excerpt}</p>');
});

test("ein Titel im Etikett bleibt Etikett (Titel sind keine Namen)", () => {
  assert.equal(run('<div className="text-[11px] uppercase tracking-[0.3em] font-bold flex">{title}</div>').code, '<div className="tls-type-label flex">{title}</div>');
});

test("der Import von ShortCaps kommt direkt unter die anderen Importe", () => {
  const source = 'import { A } from "a";\nimport { B } from "b";\n\n// Kommentar\nexport const X = () => <h1 className="font-heading text-3xl uppercase">Turniere</h1>;\n';
  const { code } = run(source);
  assert.ok(code.startsWith('import { A } from "a";\nimport { B } from "b";\nimport { ShortCaps } from "@/components/tls/ShortCaps";\n\n// Kommentar\n'), code);
});

test("Seitentitel mit Symbol davor: ShortCaps nur um den Text", () => {
  assert.match(run('<h1 className="font-heading text-3xl uppercase flex gap-3"><Mail className="w-6 h-6" /> E-Mail-Vorlagen</h1>').code,
    /<h1 className="tls-type-title flex gap-3"><Mail className="w-6 h-6" \/> <ShortCaps>E-Mail-Vorlagen<\/ShortCaps><\/h1>/);
  assert.match(run('<h1 className="font-heading text-3xl uppercase"><Bell className="w-6 h-6" /> <span className="min-w-0">Benachrichti&shy;gungen</span></h1>').code,
    /<span className="min-w-0"><ShortCaps>Benachrichti&shy;gungen<\/ShortCaps><\/span><\/h1>/);
});

test("ein Name wird nie GROSS - auch ohne eigene Größe", () => {
  assert.equal(run('<div className="font-heading font-black uppercase truncate">{activeName}</div>').code, '<div className="font-black truncate">{activeName}</div>');
  assert.equal(run('<span className="uppercase tracking-wider font-bold">{player.display_name}</span>').code, '<span className="font-bold">{player.display_name}</span>');
  assert.equal(run('<span className="uppercase tracking-wider font-bold">{item.status_label}</span>').code, '<span className="uppercase tracking-wider font-bold">{item.status_label}</span>');
});

test("beliebige Eigenschaften wie [overflow-wrap:anywhere] stören nicht", () => {
  assert.match(run('<h1 className="font-heading text-3xl font-black uppercase [overflow-wrap:anywhere]">Turniere</h1>').code,
    /<h1 className="tls-type-title \[overflow-wrap:anywhere\]"><ShortCaps>Turniere<\/ShortCaps><\/h1>/);
});

test("CSS: unter 12 px wird Klein (14 px), GROSS oder gesperrt das Etikett (12 px); 12 px und mehr bleibt", () => {
  const css = [
    ".a { font-size: 11px; line-height: 1.3; color: red; }",
    ".b { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".c { font-size: 0.68rem; }",
    ".d { font-size: 13px; }",
    ".e { font-size: 12px; }",
    ".f { font-size: 0.9em; }",
    ".g { font-size: 16px; }",
  ].join("\n");
  assert.equal(transformCss(css).code, [
    ".a { font-size: var(--tls-type-small-size); line-height: 1.3; color: red; }",
    ".b { font-size: var(--tls-type-label-size); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".c { font-size: var(--tls-type-small-size); }",
    ".d { font-size: var(--tls-type-small-size); }",
    ".e { font-size: 12px; }",
    ".f { font-size: 0.9em; }",
    ".g { font-size: 16px; }",
  ].join("\n"));
});

test("CSS: Zahlen-Schrift - Etikett-Größe; kleine Punkte (bis 16 px breit) bleiben (Zähler an Symbolen)", () => {
  assert.equal(transformCss(".n { font-family: 'Rajdhani', sans-serif; font-size: 11px; }").code, ".n { font-family: 'Rajdhani', sans-serif; font-size: var(--tls-type-label-size); }");
  const dot = ".dot { width: 13px; height: 13px; font-size: 9px; }";
  assert.equal(transformCss(dot).code, dot);
});

test("CSS: SVG-Beschriftungen (fill) bleiben", () => {
  const svg = ".line__rank { font-size: 10px; font-weight: 800; fill: #fff; }";
  assert.equal(transformCss(svg).code, svg);
});

test("Unbounded nur im Seitentitel: eine große h2 oder ein großer Text ohne Zahl wird Abschnitt", () => {
  assert.equal(run('<h2 className="font-heading text-4xl md:text-5xl font-black uppercase">So sind wir gewachsen</h2>').code, '<h2 className="tls-type-section">So sind wir gewachsen</h2>');
  assert.equal(run('<div className="font-heading text-4xl font-black">{spotlight.display_name}</div>').code, '<div className="tls-type-section">{spotlight.display_name}</div>');
  assert.equal(run('const W = { lg: "text-2xl md:text-3xl xl:text-4xl" };').code, 'const W = { lg: "tls-type-section" };');
});

test("eine Kopfzeile mit kurzen Spalten bleibt Etikett - lang ist nur ein langer Block", () => {
  const head = '<thead className="text-[10px] uppercase tracking-widest text-white/45"><tr><th>#</th><th>Fahrer</th><th>Beste Zeit</th><th>Abstand</th><th>Versuche</th></tr></thead>';
  assert.equal(run(head).code, head.replace('text-[10px] uppercase tracking-widest', 'tls-type-label'));
});

test("Kleintext lesbar (#1232): Klein und Etikett in Weiß 25-42 % werden ruhiges Grau (text-quiet, 6 : 1)", () => {
  assert.equal(quietSmallText('<p className="mt-2 tls-type-small text-white/40">Stand</p>').code, '<p className="mt-2 tls-type-small text-quiet">Stand</p>');
  assert.equal(quietSmallText('const A = "tls-type-label text-white/35 hover:text-white/40";').code, 'const A = "tls-type-label text-quiet hover:text-white/40";');
  // Andere Stufen und hellere Töne bleiben.
  const keep = '<p className="tls-type-body text-white/40">x</p><p className="tls-type-small text-white/60">y</p>';
  assert.equal(quietSmallText(keep).code, keep);
});

test("der Titel eines Moments bleibt in der Vereinsschrift", () => {
  const moment = '<h2 key="title" className="tls-placement__title font-heading">{title}</h2>';
  assert.equal(run(moment).code, moment);
});

test("Größe nur in einem Zweig: die Stufe kommt nur in diesen Zweig, die anderen erben weiter", () => {
  assert.equal(run('<td className={`px-2 ${strong ? "font-display text-base font-bold text-white" : "text-white/70"}`}>{value}</td>').code,
    '<td className={`px-2 ${strong ? "tls-type-card tls-type-num text-white" : "text-white/70"}`}>{value}</td>');
});

test("Zahl am Handy klein gedacht (Kachel-Reihe): höchstens Abschnitt", () => {
  assert.equal(run('<div className="font-display text-lg sm:text-2xl md:text-3xl font-black tabular-nums truncate">{value}</div>').code,
    '<div className="tls-type-section tls-type-num truncate">{value}</div>');
});
