const PALETTE = {
  page: "#0A0A0A",
  surface: "#121212",
  panel: "#18181B",
  black: "#000000",
  white: "#FFFFFF",
  cyan: "#29B6E8",
  cyanHighContrast: "#6EDCFF",
  gold: "#FFD700",
  goldHighContrast: "#FFE66B",
  success: "#00FF88",
  danger: "#FF3B30",
  bronze: "#CD7F32",
};

const checks = [
  ...textOnDark("TLS Cyan text", PALETTE.cyan, 4.5),
  ...textOnDark("TLS Gold text", PALETTE.gold, 4.5),
  ...textOnDark("Success text", PALETTE.success, 4.5),
  ...textOnDark("Danger text", PALETTE.danger, 4.5),
  ...textOnDark("Bronze rank text", PALETTE.bronze, 4.5),
  ...textOnDark("High-contrast cyan text", PALETTE.cyanHighContrast, 7),
  ...textOnDark("High-contrast gold text", PALETTE.goldHighContrast, 7),
  {
    label: "Primary cyan button text on cyan fill",
    foreground: PALETTE.black,
    background: PALETTE.cyan,
    min: 4.5,
  },
  {
    label: "Primary gold button text on gold fill",
    foreground: PALETTE.black,
    background: PALETTE.gold,
    min: 4.5,
  },
  ...opacityText("Body-muted white/60", PALETTE.white, 0.6, 4.5),
  ...opacityText("Metadata white/45", PALETTE.white, 0.45, 3),
  ...opacityText("Decorative white/30", PALETTE.white, 0.3, 2),
  // Etikett „Du“ (#1316): Cyan auf seiner Fläche (12 %) über der Fläche von „du“ (8 %) - auf jedem Grund AA.
  ...youTag(),
  // Zustands-Schilder (#1306): jede Schrift auf ihrem Schild, das Schild über Grund und den Flächen 1 bis 3.
  ...statusChips(),
];

const results = checks.map((check) => {
  const foreground = parseColor(check.foreground);
  const background = parseColor(check.background);
  const contrast = contrastRatio(foreground, background);
  return { ...check, contrast };
});

const failed = results.filter((result) => result.contrast + 1e-8 < result.min);

process.stdout.write("TLS contrast audit\n");
process.stdout.write("------------------\n");
for (const result of results) {
  const status = result.contrast + 1e-8 >= result.min ? "PASS" : "FAIL";
  process.stdout.write(
    `${status} ${result.label}: ${result.contrast.toFixed(2)}:1 (min ${result.min}:1)\n`
  );
}

// Prüftor (#1660): `--report out.json` schreibt das Ergebnis für den Kommentar im PR.
const reportIndex = process.argv.indexOf("--report");
if (reportIndex > 0 && process.argv[reportIndex + 1]) {
  require("node:fs").writeFileSync(process.argv[reportIndex + 1], `${JSON.stringify({
    ok: failed.length === 0,
    total: results.length,
    failed: failed.map((result) => `${result.label}: ${result.contrast.toFixed(2)}:1 (min ${result.min}:1)`),
  }, null, 2)}\n`);
}

if (failed.length > 0) {
  process.stderr.write(`\nContrast audit failed: ${failed.length} combination(s) below target.\n`);
  process.exit(1);
}

process.stdout.write("\nContrast audit passed.\n");

function textOnDark(label, foreground, min) {
  return [
    { label: `${label} on page`, foreground, background: PALETTE.page, min },
    { label: `${label} on surface`, foreground, background: PALETTE.surface, min },
    { label: `${label} on panel`, foreground, background: PALETTE.panel, min },
  ];
}

function youTag() {
  const cyan = parseColor(PALETTE.cyan);
  return [PALETTE.page, PALETTE.surface, PALETTE.panel].map((background) => ({
    label: `Du-Etikett (Cyan auf Cyan 12 % über Cyan 8 %) on ${background}`,
    foreground: PALETTE.cyan,
    background: blend(cyan, 0.12, blend(cyan, 0.08, parseColor(background))),
    min: 4.5,
  }));
}

// Die Werte stehen in docs/status-kinds.json (Farb-Rollen aus docs/category-colors.json): „ok“, „brand/0.55“, „white/0.88“.
function statusChips() {
  const fs = require("node:fs");
  const path = require("node:path");
  const docs = path.join(__dirname, "..", "..", "docs");
  const kinds = JSON.parse(fs.readFileSync(path.join(docs, "status-kinds.json"), "utf8"));
  const roles = JSON.parse(fs.readFileSync(path.join(docs, "category-colors.json"), "utf8"));
  const named = { ...roles.roles, ...kinds.colors };
  const grounds = [roles.surfaces.base, roles.surfaces["1"], roles.surfaces["2"], roles.surfaces["3"]];
  const layer = (spec, below) => {
    if (!spec) return below;
    const [name, alpha] = spec.split("/");
    return blend(parseColor(named[name]), alpha ? Number(alpha) : 1, below);
  };
  // Alle Arten und Spielarten (ruhiges „Bestätigt“, Fabian Nr. 303).
  const looks = [
    ...Object.entries(kinds.kinds).map(([kind, spec]) => [`${spec.label} (${kind})`, spec]),
    ...Object.entries(kinds.variants || {}).flatMap(([variant, specs]) => Object.entries(specs)
      .filter(([kind]) => !kind.startsWith("_")).map(([kind, spec]) => [`${kind}.${variant}`, spec])),
  ];
  const onGround = looks.flatMap(([name, spec]) => grounds.map((ground) => {
    const background = layer(spec.fill, parseColor(ground));
    return { label: `Zustands-Schild ${name} on ${ground}`, foreground: layer(spec.text, background), background, min: 4.5 };
  }));
  // Auf Bildern (onMedia): die Unterlage über dem schlimmsten Bild - einem weißen. Auch der Countdown daneben (Weiß 88 %).
  const white = parseColor("#FFFFFF");
  const underlay = layer(kinds.media.underlay, white);
  const onMedia = looks.map(([name, spec]) => {
    const background = layer(spec.fill, underlay);
    return { label: `Zustands-Schild ${name} auf weißem Bild (Unterlage ${kinds.media.underlay})`, foreground: layer(spec.text, background), background, min: 4.5 };
  });
  onMedia.push({ label: "Countdown neben dem Schild auf weißem Bild", foreground: layer("white/0.88", underlay), background: underlay, min: 4.5 });
  return [...onGround, ...onMedia];
}

function opacityText(label, foreground, alpha, min) {
  return [PALETTE.page, PALETTE.surface, PALETTE.panel].map((background) => ({
    label: `${label} on ${background}`,
    foreground: blend(parseColor(foreground), alpha, parseColor(background)),
    background,
    min,
  }));
}

function parseColor(value) {
  if (Array.isArray(value)) return value;
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  return match.slice(1).map((part) => parseInt(part, 16));
}

function blend(foreground, alpha, background) {
  return foreground.map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha)));
}

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
