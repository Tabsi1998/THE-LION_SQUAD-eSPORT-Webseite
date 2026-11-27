// Umbau auf die Schrift-Treppe (#1302, #1303, #1304): ersetzt freie Schriftgrößen, Unbounded (font-heading) außerhalb von
// Bühne und Seitentitel und GROSS-Schreibung an Titeln durch die acht Stufen aus styles/system.css (tls-type-*).
//
//   node scripts/type-codemod.mjs src            nur berichten, was sich ändern würde
//   node scripts/type-codemod.mjs --write src    umschreiben
//
// Gelesen wird mit @babel/parser; geändert wird nur der Text der Klassen (und bei Seitentiteln ein <ShortCaps> um den
// Text), alles andere bleibt Zeichen für Zeichen stehen. Was nicht eindeutig ist (Zweige mit verschiedenen Stufen,
// relative Größen), bleibt unverändert und steht im Bericht unter „von Hand“. Namen von Personen, Teams und Spielen
// werden nie GROSS gesetzt: Ein kurzes Etikett, das einen Namen zeigt, wird „Klein“ statt „Etikett“.
// Selbsttest: node --test scripts/type-codemod.test.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

// TV-Seiten behalten ihre Beamer-Größen (lib/tvType.js), Druckbögen ihre pt-Größen (styles/printView.css).
export const SKIP_DIRS = ["pages/display", "components/tv", "pages/print", "components/tls/print"];
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

const NAMED = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
const BREAKPOINTS = ["", "sm", "md", "lg", "xl", "2xl"];
const SIZE = /^((?:(?:sm|md|lg|xl|2xl):)?)text-(xs|sm|base|lg|[2-9]xl|xl|\[(?:[\d.]+(?:px|rem)|clamp\([^\]]+\))\])$/;
const WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const TRACKING = /^tracking-(tighter|tight|normal|wide|wider|widest|\[[^\]]+\])$/;
const WIDE = /^tracking-(wide|wider|widest|\[(?:0?\.\d+|\d+(?:\.\d+)?)em\])$/;
const CLASS_TOKEN = /^[!-]?[[a-z0-9@][\w:./%#[\]()=,&>*+~'"-]*$/i;
const TYPE_TOKEN = /^(?:(?:sm|md|lg|xl|2xl):)?text-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem)\]|\[clamp)|^font-(?:heading|display)$|^uppercase$|^tabular-nums$|^tls-card__title$/;
const STEP_CLASS = /^tls-type-/;
// Schalter für Vergleichsläufe: blockText = ein langer Text zählt je Block, nicht über alle Spalten zusammen.
export const OPTIONS = { blockText: true, branchOnly: true, numCap: true, cssNoShrink: true };

// Was ein Name ist (Personen, Teams, Spiele, Titel): nie GROSS. Was ein Etikett ist (Zustand, Art, Rolle): darf GROSS.
// Titel sind keine Namen: ein Titel im Etikett darf GROSS bleiben (kurz, 1-3 Wörter).
const NAME_LIKE = /name|nick|player|spieler|team|captain|author|winner|loser|opponent|gegner|member|mitglied|game|user|person|owner|driver|fahrer|club|verein|partner|sponsor|album|track/i;
const LABEL_LIKE = /label|status|state|kind|type|phase|role|badge|tag|short|abbr|code|unit|caption|kicker|eyebrow/i;
// Zahlen erkennt man an einem Teil des Namens (participant_count, bestTime, rank) - nicht an Buchstabenfolgen darin
// („state“ ist keine „stat“).
const NUMBER_WORDS = new Set(["count", "total", "points", "pts", "punkte", "score", "scores", "rank", "place", "platz", "wins", "losses", "draws",
  "kills", "deaths", "value", "sum", "amount", "number", "num", "nr", "level", "xp", "delta", "diff", "percent", "rate", "rating", "elo", "length",
  "n", "i", "idx", "index", "position", "pos", "seconds", "minutes", "hours", "days", "countdown", "remaining", "elapsed", "time", "lap", "gap",
  "best", "age", "year", "size", "capacity", "registered", "attempts", "goals", "round", "matchday", "spieltag"]);
const BODY_LIKE = /excerpt|description|summary|teaser|intro|bio|about|body|content|text|message|note|hint|info|lead/i;
// Einheiten neben einer Zahl machen sie nicht zum Text („412 Pkt.“, „3 von 8“).
const UNITS = /(?:^|\s)(?:Pkt|Punkte?|Tage?|Std|Min|Sek|ms|km\/h|Siege?|Runden?|Versuche?|von|vs|Platz|Pl)\.?(?=\s|$)/gi;

function numberLike(leaf) {
  const parts = String(leaf).replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return parts.some((part) => NUMBER_WORDS.has(part));
}

function wordy(text) {
  return /\p{L}{3,}/u.test(String(text || "").replace(UNITS, " "));
}
const INPUT_TAGS = new Set(["input", "textarea", "select", "option", "Input", "Textarea", "SelectTrigger", "SelectValue", "text", "tspan", "svg"]);
const NUMBER_TAGS = new Set(["CountUp", "LapTime"]);

function pxOf(value) {
  if (NAMED[value] !== undefined) return { px: NAMED[value], mobile: NAMED[value] };
  const raw = value.slice(1, -1);
  if (raw.startsWith("clamp(")) {
    const parts = raw.slice(6, -1).split(",").map((part) => part.trim());
    const first = pxOf(`[${parts[0]}]`);
    const last = pxOf(`[${parts[parts.length - 1]}]`);
    return first && last ? { px: last.px, mobile: first.px } : null;
  }
  const match = /^([\d.]+)(px|rem)$/.exec(raw);
  if (!match) return null;
  const px = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
  return { px, mobile: px };
}

/** Die Klassen eines Texts nach Aufgabe sortiert. */
export function analyze(tokens) {
  const sizes = [];
  for (const token of tokens) {
    const match = SIZE.exec(token);
    if (!match) continue;
    const size = pxOf(match[2]);
    if (!size) continue;
    sizes.push({ token, bp: BREAKPOINTS.indexOf(match[1].replace(":", "")), ...size });
  }
  sizes.sort((a, b) => a.bp - b.bp);
  const has = (name) => tokens.includes(name);
  return {
    sizes,
    desktop: sizes.length ? sizes[sizes.length - 1].px : null,
    mobile: sizes.length ? sizes[0].mobile : null,
    heading: has("font-heading"),
    display: has("font-display"),
    tabular: has("tabular-nums"),
    upper: has("uppercase"),
    normalCase: has("normal-case"),
    wide: tokens.some((token) => WIDE.test(token)),
    cardTitle: has("tls-card__title"),
    button: has("tls-btn"),
    stepped: tokens.some((token) => STEP_CLASS.test(token)),
  };
}

function words(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/**
 * Welche Stufe ein Klassen-Text bekommt. `ctx`: tag (Element), level (1-6 für Überschriften, 3 für *Title-Bausteine),
 * button, children ({ text, dynamic, leafs, tags, elements }). Ergebnis: null (nichts tun) oder
 * { step, num, keepCaps, headingOnly, shortCaps, manual }.
 */
export function classify(tokens, ctx = {}) {
  const t = analyze(tokens);
  if (t.stepped) return null;
  // TV-Bausteine (tv-…) haben eigene Beamer-Größen und Schriften (lib/tvType.js) - auch in geteilten Bausteinen.
  if (tokens.some((token) => /^tv-/.test(token))) return null;
  // Der Titel eines Moments (Platz, Belohnung, Saisonende) ist die Bühne des Augenblicks - bleibt in der Vereinsschrift.
  if (tokens.includes("tls-placement__title")) return null;
  const level = ctx.level || ((t.cardTitle) ? 3 : 0);
  const children = ctx.children || { text: "", exprText: "", dynamic: false, leafs: [], tags: [], elements: false };
  const namedCaps = (t.upper || t.wide) && (children.leafs || []).some((leaf) => NAME_LIKE.test(leaf) && !LABEL_LIKE.test(leaf));
  const typeWork = t.sizes.length || t.heading || t.display || (t.tabular && (t.sizes.length || t.heading)) || (t.upper && level >= 1 && level <= 3) || namedCaps;
  if (!typeWork) return null;
  if (ctx.tag && INPUT_TAGS.has(ctx.tag)) return null;
  // Sehr große Einzelwerte (Fehlerseite) sind begründete Ausnahmen - bleiben stehen.
  if (t.desktop !== null && t.desktop > 96) return null;
  // Zähler an Symbolen (Plakette mit Zahl): begründete Ausnahme unter 12 px.
  if (tokens.includes("absolute") && tokens.includes("rounded-full") && t.desktop !== null && t.desktop < 12) return null;

  const px = t.desktop;
  // Lang ist ein Text, wenn ein Block für sich lang ist - eine Kopfzeile mit fünf kurzen Spalten („# Fahrer Zeit …“) nicht.
  const blockText = OPTIONS.blockText && children.longestText !== undefined ? children.longestText : (children.text || "");
  const longStatic = words(blockText).length > 4 || blockText.length > 32;
  const leafs = children.leafs || [];
  const nameLike = leafs.some((leaf) => NAME_LIKE.test(leaf) && !LABEL_LIKE.test(leaf));
  const words_ = wordy(children.text) || wordy(children.exprText);
  const numberChildren = (children.tags || []).some((tag) => NUMBER_TAGS.has(tag))
    || (children.dynamic && leafs.length > 0 && leafs.every(numberLike) && !words_);
  // Rajdhani nur für Zahlen: font-display ohne Wörter, tabular-nums ab Listengröße oder mit Zahl, Unbounded mit Zahl.
  const num = (t.display && !words_)
    || (t.tabular && !t.display && !words_ && ((px !== null && px >= 16) || numberChildren))
    || (t.heading && numberChildren) || (px !== null && px >= 24 && numberChildren);

  if (num) {
    if (px === null) return { step: null, num: true };
    if (px <= 12 && (t.upper || t.wide)) return { step: "label", num: false, keepTabular: t.tabular || t.display };
    let step = px <= 15 ? "small" : px <= 20 ? "card" : px <= 27 ? "section" : px <= 47 ? "title" : "hero";
    // Am Handy viel kleiner gedacht (`text-lg sm:text-2xl md:text-3xl` in einer Kachel-Reihe): nicht größer als der
    // Abschnitt, sonst wird die Zahl in schmalen Spalten abgeschnitten.
    if (OPTIONS.numCap && t.mobile !== null && t.mobile <= 20 && (step === "title" || step === "hero")) step = "section";
    return { step, num: true };
  }

  if (level === 1) {
    if (px === null && t.heading) return { step: "title", shortCaps: true };
    // Jede h1 ist ein Seitentitel, auch eine sehr große. Die Bühne (tls-type-hero) setzt man von Hand: die Startseite und
    // die wenigen Schlagzeilen-Seiten („Werde Teil des Rudels“).
    if (px !== null && (px >= 20 || t.heading)) return { step: "title", shortCaps: true };
  } else if (level === 2) {
    // Unbounded nur für Bühne und Seitentitel (h1): auch eine große h2 ist ein Abschnitt.
    if ((px !== null && px >= 16) || (px === null && t.heading)) return { step: "section" };
  } else if (level >= 3) {
    if (px === null && t.heading) return { step: "card" };
    if (px !== null && px >= 24 && (t.heading || t.cardTitle)) return { step: "section" };
    if (px !== null && px >= 16) return { step: "card" };
  } else if (t.heading) {
    if (px === null) return { step: null, headingOnly: true, dropCaps: nameLike || longStatic };
    if (px >= 24) return { step: "section" };
    if (px >= 16) return { step: "card" };
  }
  if (px === null) {
    // Überschrift oder Name ohne eigene Größe: nur die GROSS-Schreibung fällt weg (#1303).
    return (level >= 1 && level <= 3 && (t.upper || t.wide)) || namedCaps ? { step: null, dropCaps: true } : null;
  }

  const caps = (t.upper || t.wide) && !t.normalCase;
  if (caps && px <= 14) {
    if (ctx.button) return px <= 12 ? { step: "label" } : { step: "small", keepCaps: true };
    if (nameLike || longStatic) return { step: "small" };
    return { step: "label" };
  }
  if (px <= 15) {
    // Fließtext ab 14 px: ein Absatz mit langem Text oder Beschreibung, oder Text mit weitem Zeilenabstand.
    const relaxed = tokens.some((token) => /^leading-(relaxed|loose|7|8)$/.test(token));
    const paragraph = ctx.tag === "p" && ((children.text || "").length >= 80 || leafs.some((leaf) => BODY_LIKE.test(leaf)));
    return { step: px >= 14 && (relaxed || paragraph) ? "body" : "small", keepCaps: ctx.button && caps };
  }
  if (px <= 16) return { step: "body", keepCaps: ctx.button && caps };
  if (px <= 23 && ctx.tag === "p") return { step: "body" };
  if (px <= 19) return { step: "card", keepCaps: ctx.button && caps };
  if (px <= 23) return { step: "card", keepCaps: ctx.button && caps };
  return { step: "section" };
}

const FIXED_WEIGHT = new Set(["hero", "title", "section", "card", "label"]);

/** Die neuen Klassen eines Textstücks: entfernt, was die Stufe festlegt, und setzt die Stufe an die erste Stelle. */
export function rewriteTokens(tokens, decision, { insert = true } = {}) {
  if (!decision) return tokens;
  const { step, num, keepCaps, headingOnly, dropCaps, keepTabular } = decision;
  const stepClasses = [step ? `tls-type-${step}` : "", num ? "tls-type-num" : ""].filter(Boolean);
  const out = [];
  let placed = !insert || stepClasses.length === 0;
  const place = () => {
    if (!placed) {
      out.push(...stepClasses);
      placed = true;
    }
  };
  for (const token of tokens) {
    let drop = false;
    if (headingOnly || (dropCaps && !step)) drop = (headingOnly && token === "font-heading") || (dropCaps && (token === "uppercase" || TRACKING.test(token)));
    else {
      if (SIZE.test(token) && pxOf(SIZE.exec(token)[2])) drop = true;
      else if (token === "font-heading" || token === "font-body" || (token === "font-display" && (num || step))) drop = true;
      else if (token === "tabular-nums" && num) drop = true;
      else if (token === "tabular-nums" && keepTabular) drop = false;
      else if (WEIGHT.test(token)) {
        const weight = WEIGHT.exec(token)[1];
        drop = (step && FIXED_WEIGHT.has(step)) || (num && !step) || (num && step) || (step === "small" && weight === "medium") || (step === "body" && weight === "normal");
      } else if (TRACKING.test(token)) drop = !keepCaps;
      else if (token === "uppercase" || token === "normal-case") drop = !keepCaps;
    }
    if (drop) {
      place();
      continue;
    }
    out.push(token);
  }
  if (!placed) out.unshift(...stepClasses);
  return out;
}

function isClassList(value) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (!tokens.every((token) => CLASS_TOKEN.test(token))) return false;
  return tokens.some((token) => TYPE_TOKEN.test(token));
}

// ---------------------------------------------------------------- Lesen der Quelle

function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== "string") return;
  if (visit(node, parents) === false) return;
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, next));
    else if (value && typeof value.type === "string") walk(value, visit, next);
  }
}

function tagName(nameNode) {
  if (!nameNode) return "";
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") return `${tagName(nameNode.object)}.${nameNode.property.name}`;
  return "";
}

function headingLevel(tag) {
  const match = /^h([1-6])$/.exec(tag);
  if (match) return Number(match[1]);
  if (/^(Heading|[A-Z]\w*Title)$/.test(tag.split(".").pop() || "")) return 3;
  return 0;
}

function decodeEntities(text) {
  return text.replace(/&shy;/g, "­").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Was in einem Element steht: fester Text, ob etwas Berechnetes dabei ist, welche Namen darin vorkommen. */
function childrenInfo(element) {
  const info = { text: "", exprText: "", dynamic: false, leafs: [], tags: [], elements: false };
  const collectLeafs = (expression) => {
    walk(expression, (node, parents) => {
      const parent = parents[parents.length - 1];
      if (node.type === "Identifier") {
        const isCallee = parent && parent.type === "CallExpression" && parent.callee === node;
        const isObject = parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.object === node;
        const isProperty = parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === node;
        if (isProperty && !parent.computed) {
          const grand = parents[parents.length - 2];
          const calleeOfCall = grand && (grand.type === "CallExpression" || grand.type === "OptionalCallExpression") && grand.callee === parent;
          if (!calleeOfCall) info.leafs.push(node.name);
        } else if (!isCallee && !isObject && !isProperty) info.leafs.push(node.name);
      }
      if (node.type === "JSXElement") info.tags.push(tagName(node.openingElement.name));
      if (node.type === "StringLiteral") info.exprText += ` ${node.value}`;
      if (node.type === "TemplateElement") info.exprText += ` ${node.value.cooked || ""}`;
      return true;
    });
  };
  const blocks = [];
  const visitChildren = (children, block) => {
    const add = (text) => {
      info.text += ` ${text}`;
      block.text += ` ${text}`;
    };
    for (const child of children) {
      if (child.type === "JSXText") add(decodeEntities(child.value));
      else if (child.type === "JSXExpressionContainer") {
        if (child.expression.type === "StringLiteral") add(child.expression.value);
        else if (child.expression.type === "TemplateLiteral" && !child.expression.expressions.length) add(child.expression.quasis[0].value.cooked);
        else if (child.expression.type !== "JSXEmptyExpression") {
          info.dynamic = true;
          collectLeafs(child.expression);
        }
      } else if (child.type === "JSXElement") {
        info.elements = true;
        info.tags.push(tagName(child.openingElement.name));
        const inner = { text: "" };
        blocks.push(inner);
        visitChildren(child.children, inner);
      } else if (child.type === "JSXFragment") visitChildren(child.children, block);
    }
  };
  const top = { text: "" };
  blocks.push(top);
  visitChildren(element.children || [], top);
  info.text = info.text.replace(/\s+/g, " ").trim();
  info.longestText = blocks.map((block) => block.text.replace(/\s+/g, " ").trim()).sort((a, b) => b.length - a.length)[0] || "";
  return info;
}

/** Alle Textstücke eines Klassen-Werts: fest (gilt immer) oder in einem Zweig (?:, &&, ||). */
function pieces(expression, conditional = false, out = []) {
  if (!expression) return out;
  switch (expression.type) {
    case "StringLiteral":
      out.push({ node: expression, kind: "string", conditional });
      break;
    case "TemplateLiteral":
      expression.quasis.forEach((quasi) => out.push({ node: quasi, kind: "quasi", conditional }));
      expression.expressions.forEach((inner) => pieces(inner, conditional, out));
      break;
    case "ConditionalExpression":
      pieces(expression.consequent, true, out);
      pieces(expression.alternate, true, out);
      break;
    case "LogicalExpression":
      pieces(expression.left, conditional || expression.operator !== "&&", out);
      pieces(expression.right, true, out);
      break;
    case "BinaryExpression":
      if (expression.operator === "+") {
        pieces(expression.left, conditional, out);
        pieces(expression.right, conditional, out);
      }
      break;
    case "CallExpression":
      if (expression.callee.type === "Identifier" && /^(cn|clsx|cx|classNames|twMerge)$/.test(expression.callee.name)) {
        expression.arguments.forEach((argument) => pieces(argument, conditional, out));
      }
      break;
    case "ArrayExpression":
      expression.elements.forEach((element) => pieces(element, conditional, out));
      break;
    default:
      break;
  }
  return out;
}

function pieceText(code, piece) {
  if (piece.kind === "string") return code.slice(piece.node.start + 1, piece.node.end - 1);
  return code.slice(piece.node.start, piece.node.end);
}

function rebuild(original, tokens) {
  const lead = /^\s*/.exec(original)[0];
  const trail = /\s*$/.exec(original)[0];
  return original.trim() ? `${lead}${tokens.join(" ")}${tokens.length ? trail : ""}` : original;
}

function sameDecision(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

/** Baut eine Datei um. Ergebnis: { code, changed, manual: [Zeilen], wrapped }. */
export function transformSource(code, { file = "datei.jsx" } = {}) {
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx"], errorRecovery: false });
  } catch (error) {
    return { code, changed: 0, manual: [`${file}: nicht lesbar (${error.message})`], wrapped: 0 };
  }
  const edits = [];
  const manual = [];
  const handled = new Set();
  let wrapped = 0;

  const editPiece = (piece, decision, insert = true) => {
    const original = pieceText(code, piece);
    const tokens = original.trim().split(/\s+/).filter(Boolean);
    const next = rewriteTokens(tokens, decision, { insert });
    if (next.join(" ") === tokens.join(" ")) return;
    const text = rebuild(original, next);
    if (piece.kind === "string") edits.push({ start: piece.node.start + 1, end: piece.node.end - 1, text });
    else edits.push({ start: piece.node.start, end: piece.node.end, text });
  };

  walk(ast.program, (node, parents) => {
    if (node.type !== "JSXAttribute" || !node.value) return true;
    const attr = node.name.type === "JSXIdentifier" ? node.name.name : "";
    if (!/^(className|class|\w+ClassName)$/.test(attr)) return true;
    const opening = parents[parents.length - 1];
    const element = parents[parents.length - 2];
    const tag = tagName(opening.name);
    const value = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
    const all = pieces(value);
    all.forEach((piece) => handled.add(piece.node));
    const sized = all.filter((piece) => isClassList(pieceText(code, piece)) || pieceText(code, piece).trim() === "");
    if (!sized.some((piece) => pieceText(code, piece).trim())) return true;
    const isElementClass = attr === "className" || attr === "class";
    const ctx = {
      tag: isElementClass ? tag : "",
      level: isElementClass ? headingLevel(tag) : 0,
      button: isElementClass && (tag === "button" || tag === "Button"),
      children: isElementClass && element && element.type === "JSXElement" ? childrenInfo(element) : undefined,
    };
    const tokensOf = (list) => list.flatMap((piece) => pieceText(code, piece).trim().split(/\s+/).filter(Boolean));
    const fixed = all.filter((piece) => !piece.conditional);
    const branches = all.filter((piece) => piece.conditional);
    const fixedTokens = tokensOf(fixed);
    if (tokensOf(all).includes("tls-btn")) ctx.button = true;
    const sizedBranches = branches.filter((piece) => analyze(tokensOf([piece])).sizes.length);
    const decisionFixed = classify(fixedTokens, ctx);
    let decision = decisionFixed;
    if (sizedBranches.length) {
      const options = sizedBranches.map((piece) => classify([...fixedTokens, ...tokensOf([piece])], ctx));
      const unsized = analyze(fixedTokens).sizes.length === 0;
      const agree = options.every((option) => sameDecision(option, options[0]));
      if (!agree || (unsized && branches.some((piece) => !analyze(tokensOf([piece])).sizes.length && !sameDecision(decisionFixed, options[0]) && decisionFixed))) {
        manual.push(`${file}:${node.loc.start.line} <${tag}> Zweige mit verschiedenen Stufen (${options.map((o) => o?.step || "-").join(" / ")})`);
        return true;
      }
      decision = options[0];
      // Größe nur in einem Zweig (`${strong ? "text-base font-display" : "text-white/70"}`): Die Stufe gehört nur in diesen
      // Zweig - die anderen Zweige erben weiter die Größe der Umgebung.
      const unsizedBranch = branches.some((piece) => !analyze(tokensOf([piece])).sizes.length);
      if (OPTIONS.branchOnly && unsized && unsizedBranch) {
        if (fixedTokens.some((token) => /^(font-heading|font-display|uppercase|tracking-.+)$/.test(token))) {
          manual.push(`${file}:${node.loc.start.line} <${tag}> Schrift fest, Größe nur in einem Zweig`);
          return true;
        }
        sizedBranches.forEach((piece) => editPiece(piece, decision, true));
        return true;
      }
    } else if (!decision) {
      // Eine Rolle nur in einem Zweig (z. B. `${big ? "font-heading" : ""}`): von Hand.
      const branchDecisions = branches.map((piece) => classify([...fixedTokens, ...tokensOf([piece])], ctx)).filter(Boolean);
      if (branchDecisions.length) manual.push(`${file}:${node.loc.start.line} <${tag}> Stufe nur in einem Zweig`);
      return true;
    }
    if (!decision) return true;
    // Rajdhani mit Wörtern daneben („{points} Punkte gesamt“): Die Stelle wird Outfit - die Zahl selbst braucht von Hand
    // ein eigenes <span className="tls-type-num"> (#1304). Steht im Bericht, damit keine Zahl ihre Schrift verliert.
    if (tokensOf(all).includes("font-display") && !decision.num) {
      manual.push(`${file}:${node.loc.start.line} <${tag}> Zahl in Rajdhani von Hand (font-display mit Wörtern)`);
    }
    // Die Stufe kommt ins erste feste Stück; gibt es keins, in jeden Zweig mit Größe.
    const fixedTarget = fixed.find((piece) => pieceText(code, piece).trim() || piece.kind === "string");
    let placed = false;
    for (const piece of all) {
      if (!isClassList(pieceText(code, piece)) && !(piece === fixedTarget)) {
        continue;
      }
      const insert = !placed && (piece === fixedTarget || (!fixedTarget && piece.conditional));
      editPiece(piece, decision, insert || (!fixedTarget && piece.conditional));
      if (piece === fixedTarget && insert) placed = true;
    }
    if (fixedTarget && !placed) editPiece(fixedTarget, decision, true);
    if (decision.shortCaps && element && element.type === "JSXElement" && element.closingElement) {
      const meaningful = (list) => list.filter((child) => !(child.type === "JSXText" && !child.value.trim()));
      const isIcon = (child) => child.type === "JSXElement" && child.openingElement.selfClosing;
      const textOnly = (list) => list.length > 0 && list.every((child) => child.type === "JSXText");
      let kids = meaningful(element.children);
      // Symbol vorne, Text dahinter („<Bell /> Benachrichtigungen“ oder „<Bell /> <span>…</span>“): nur der Text.
      const lead = kids.findIndex((child) => !isIcon(child));
      if (lead > 0) {
        const rest = kids.slice(lead);
        if (textOnly(rest)) kids = rest;
        else if (rest.length === 1 && rest[0].type === "JSXElement" && rest[0].closingElement && textOnly(meaningful(rest[0].children))) kids = meaningful(rest[0].children);
      }
      const onlyText = textOnly(kids);
      // Nur fester Text bekommt <ShortCaps>: ein berechneter Titel kann ein Name oder ein Titel aus Daten sein (#1303).
      if (onlyText) {
        if (!wrapped) {
          const eol = code.includes("\r\n") ? "\r\n" : "\n";
          const imports = ast.program.body.filter((item) => item.type === "ImportDeclaration");
          const already = imports.some((item) => item.source.value === "@/components/tls/ShortCaps");
          if (!already) {
            const line = 'import { ShortCaps } from "@/components/tls/ShortCaps";';
            if (imports.length) edits.push({ start: imports[imports.length - 1].end, end: imports[imports.length - 1].end, text: `${eol}${line}` });
            else edits.push({ start: 0, end: 0, text: `${line}${eol}` });
          }
        }
        const first = kids[0];
        const last = kids[kids.length - 1];
        const start = first.start + (first.value.length - first.value.trimStart().length);
        const end = last.end - (last.value.length - last.value.trimEnd().length);
        edits.push({ start, end: start, text: "<ShortCaps>" });
        edits.push({ start: end, end, text: "</ShortCaps>" });
        wrapped += 1;
      }
    }
    return true;
  });

  // Variablen, die in einem className neben GROSS-Klassen stehen (`${sz}` in „… uppercase …“).
  const capsVars = new Set();
  for (const match of code.matchAll(/className=\{`([^`]*)`\}/g)) {
    if (!/(?<![\w-])(uppercase|tracking-(?:wider|widest))(?![\w-])/.test(match[1])) continue;
    for (const use of match[1].matchAll(/\$\{(\w+)\}/g)) capsVars.add(use[1]);
  }
  // Klassen-Texte außerhalb von className (Vorlagen in Objekten, Konstanten): ohne Element, nur nach Größe.
  walk(ast.program, (node, parents) => {
    if (node.type !== "StringLiteral" && node.type !== "TemplateElement") return true;
    if (handled.has(node)) return true;
    const parent = parents[parents.length - 1];
    if (parent && parent.type === "ObjectProperty" && parent.key === node) return true;
    if (parent && (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration" || parent.type === "ExportAllDeclaration")) return true;
    if (parent && parent.type === "ObjectProperty") {
      const key = parent.key.type === "Identifier" ? parent.key.name : parent.key.value;
      if (/^(textTransform|fontSize|fontFamily|letterSpacing|fontWeight)$/.test(String(key))) return true;
    }
    const piece = { node, kind: node.type === "StringLiteral" ? "string" : "quasi", conditional: false };
    const original = pieceText(code, piece);
    if (!isClassList(original)) return true;
    const tokens = original.trim().split(/\s+/);
    if (tokens.length < 2 && !analyze(tokens).sizes.length) return true;
    // Eine Größe in einer Variablen, die ein GROSSES Schild benutzt (`const sz = … "text-[10px] px-2"` und
    // className={`font-bold uppercase ${sz}`}): wie ein Knopf - bis 12 px das Etikett, darüber Klein mit GROSS.
    const owner = [...parents].reverse().find((item) => item.type === "VariableDeclarator");
    const capsVar = owner && owner.id.type === "Identifier" && capsVars.has(owner.id.name);
    const decision = capsVar ? classify([...tokens, "uppercase"], { button: true }) : classify(tokens, {});
    if (!decision) return true;
    editPiece(piece, decision, true);
    return true;
  });

  if (!edits.length) return { code, changed: 0, manual, wrapped };
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = code;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  // Zweige, die nur noch leer sind (`${big ? "" : ""}`), fallen weg.
  out = out.replace(/\s*\$\{[^{}`]*\?\s*""\s*:\s*""\s*\}/g, "");
  // Eine Vorlage ohne Ausdruck ist wieder ein einfacher Text.
  out = out.replace(/className=\{`([^`$\\"]*)`\}/g, (match, inner) => `className="${inner.trim().replace(/\s+/g, " ")}"`);
  return { code: out, changed: edits.length, manual, wrapped };
}

// ---------------------------------------------------------------- Kleintext lesbar (#1232)

// Klein und Etikett sind Kleintext: Weiß mit 25 bis 42 % Deckkraft liegt auf unserem Grund unter 4,5 : 1 (white/40 hat
// 3,8 : 1). Es wird das ruhige Grau der Farb-Rollen (text-quiet, 6 : 1, #1305) - nur in Klassen-Texten mit einer der
// beiden Stufen, Hover und andere Zustände bleiben.
const FAINT = /(?<![\w:/-])text-white\/(?:25|30|35|40|42)(?![\w/-])/g;

export function quietSmallText(code) {
  let changed = 0;
  const out = code.replace(/(["'`])((?:(?!\1)[^\n])*?)\1/g, (match, quote, inner) => {
    if (!/(?<![\w-])tls-type-(?:small|label)(?![\w-])/.test(inner) || !FAINT.test(inner)) return match;
    FAINT.lastIndex = 0;
    const next = inner.replace(FAINT, () => {
      changed += 1;
      return "text-quiet";
    });
    return `${quote}${next}${quote}`;
  });
  return { code: out, changed };
}

// ---------------------------------------------------------------- CSS der Bausteine

// Kleine Größen in eigenen Bausteinen (index.css und die CSS-Dateien der Bereiche): unter 12 px und bis 13,5 px wird
// „Klein“ (14 px), GROSS, gesperrt oder in der Zahlen-Schrift das Etikett (12 px). Kleine Punkte und Plaketten mit fester
// Breite bis 16 px bleiben (Zähler an Symbolen, #1232). Relative Größen (em) und alles ab 14 px bleiben, wie sie sind.
export const CSS_SKIP = ["components/tv/", "styles/printView.css", "fonts.css"];
const FONT_SIZE = /font-size:\s*([\d.]+)(px|rem)\s*(?=;|\})/g;
// Werte unter 12 px, die das Skript nicht selbst umschreibt: kleinster Wert von clamp() und das Kürzel font: -
// die Stelle steht im Bericht und wird von Hand gelöst (größerer kleinster Wert, eine Zeile mehr oder kürzerer Text).
const TINY_VALUE = String.raw`(?:(?:[0-9]|1[01])(?:\.\d+)?px|0?\.(?:[0-6]\d*|7(?:[0-4]\d*)?)rem)`;
const CLAMP_TINY = new RegExp(String.raw`font-size:\s*clamp\(\s*${TINY_VALUE}\s*,`);
const FONT_TINY = new RegExp(String.raw`(?<![\w-])font:[^;{}]*?(?<![\w./-])${TINY_VALUE}(?![\w.])`);

export function transformCss(css) {
  let changed = 0;
  const manual = [];
  const code = css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selector, body) => {
    const name = selector.trim().split("\n").pop().trim();
    if (CLAMP_TINY.test(body)) manual.push(`${name}: clamp() unter 12 px von Hand`);
    if (FONT_TINY.test(body)) manual.push(`${name}: font: unter 12 px von Hand`);
    // SVG-Beschriftungen (fill) rechnen in der Größe ihrer Grafik - sie bleiben.
    if (!/font-size/.test(body) || /(?:^|[;\s])fill:/.test(body)) return rule;
    const upper = /text-transform:\s*uppercase/.test(body);
    const spaced = /letter-spacing:\s*0?\.(0[4-9]|[1-9])\d*em/.test(body);
    // Zahlen-Schrift, Plaketten und Kürzel („Du“, Abzeichen, Rang) dürfen 12 px haben.
    const digits = /Rajdhani|font-variant-numeric|tls-font-num/.test(body)
      || /(?:tag|badge|pill|chip|count|flag|code|kbd|num|digit|score|rank)(?:__|-|\b)/i.test(selector);
    const boxes = [...body.matchAll(/(?:^|[;\s])(?:width|height|min-width):\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    const dot = boxes.length > 0 && Math.max(...boxes) <= 16;
    const next = body.replace(FONT_SIZE, (decl, value, unit) => {
      const px = Number(value) * (unit === "rem" ? 16 : 1);
      if (px >= 14 || px === 12 || dot) return decl;
      changed += 1;
      // Zahlen und Kürzel unter 12 px kommen auf die Etikett-Größe; ab 12,5 px wird ohne GROSS nicht verkleinert.
      const label = upper || spaced || (digits && (px < 12 || !OPTIONS.cssNoShrink));
      return `font-size: var(${label ? "--tls-type-label-size" : "--tls-type-small-size"})`;
    });
    return `${selector}{${next}}`;
  });
  return { code, changed, manual };
}

// ---------------------------------------------------------------- Aufruf von der Kommandozeile

function sourceFiles(dir, root) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (SKIP_DIRS.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full, root);
    if (name.endsWith(".css")) return CSS_SKIP.some((skip) => rel === skip || rel.startsWith(skip)) ? [] : [full];
    return /\.(jsx|js)$/.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

function main(argv) {
  const write = argv.includes("--write");
  const targets = argv.filter((arg) => !arg.startsWith("--"));
  const srcRoot = path.resolve("src");
  const files = (targets.length ? targets : ["src"]).flatMap((target) => {
    const full = path.resolve(target);
    return statSync(full).isDirectory() ? sourceFiles(full, srcRoot) : [full];
  });
  let changed = 0;
  let touched = 0;
  const manual = [];
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    let result;
    if (file.endsWith(".css")) {
      const css = transformCss(code);
      result = { ...css, manual: css.manual.map((line) => `${rel}: ${line}`) };
    }
    else {
      const stepped = transformSource(code, { file: rel });
      const quiet = quietSmallText(stepped.code);
      result = { ...stepped, code: quiet.code, changed: stepped.changed + quiet.changed };
    }
    manual.push(...result.manual);
    if (!result.changed) continue;
    changed += result.changed;
    touched += 1;
    if (write) writeFileSync(file, result.code);
  }
  console.log(`${write ? "Umgebaut" : "Würde umbauen"}: ${changed} Stellen in ${touched} Dateien.`);
  if (manual.length) console.log(`Von Hand (${manual.length}):\n${manual.map((line) => `  ${line}`).join("\n")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
