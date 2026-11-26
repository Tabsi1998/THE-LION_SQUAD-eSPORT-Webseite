// Selbsttest des Umbaus auf die Schrift-Treppe (#1302): node --test scripts/type-codemod.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, rewriteTokens, transformSource } from "./type-codemod.mjs";

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

test("Bühne: sehr groß, wenige feste Wörter - tls-type-hero", () => {
  const { code } = run('<h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.95] text-white">Wir sind das Rudel</h1>');
  assert.equal(code, '<h1 className="tls-type-hero leading-[0.95] text-white">Wir sind das Rudel</h1>');
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
  assert.equal(same.code, '<span className={`tls-card__title tls-type-card leading-tight`}>{names.primary}</span>');
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
