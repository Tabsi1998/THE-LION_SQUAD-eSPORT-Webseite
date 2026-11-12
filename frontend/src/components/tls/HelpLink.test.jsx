import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpLink, helpTarget } from "./HelpLink";

// „?“-Links (#2295): Jedes Ziel im Code muss ein echter Schritt der Hilfe sein - benennt jemand einen Schritt um,
// wird dieser Test rot statt dass der Link still verschwindet.

const SRC = resolve(__dirname, "../..");

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.jsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

test("alle festen Ziele im Code gibt es in der Hilfe", () => {
  const targets = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/<HelpLink thema="([^"]+)" schritt="([^"]+)"/g)) targets.push([match[1], match[2], file]);
    // Ziele, die je nach Lage wechseln: thema="…" schritt={a ? "x" : "y"} bzw. thema={a ? "x" : "y"} schritt="z".
    for (const match of text.matchAll(/<HelpLink thema="([^"]+)" schritt=\{[^}]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\}/g)) {
      targets.push([match[1], match[2], file], [match[1], match[3], file]);
    }
    for (const match of text.matchAll(/<HelpLink thema=\{[^}]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\} schritt="([^"]+)"/g)) {
      targets.push([match[1], match[3], file], [match[2], match[3], file]);
    }
  }
  expect(targets.length).toBeGreaterThanOrEqual(10);
  for (const [thema, schritt, file] of targets) expect(helpTarget(thema, schritt), `${thema}#${schritt} in ${file}`).not.toBeNull();
});

test("das „?“ steht neben einer Überschrift, nie darin - sonst gehört „Hilfe: …“ zum Namen der Überschrift", () => {
  const inside = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("<HelpLink")) continue;
    for (const match of text.matchAll(/<h([1-6])\b[\s\S]*?<\/h\1>/g)) {
      if (match[0].includes("<HelpLink")) inside.push(`${file}: ${match[0].slice(0, 80)}`);
    }
  }
  expect(inside).toEqual([]);
});

test("die Schritte der Liga-Anmeldung zeigen auf die Hilfe", () => {
  const text = readFileSync(resolve(SRC, "pages/public/LeagueApplyPage.jsx"), "utf8");
  const steps = JSON.parse(text.match(/const HELP_STEPS = (\[[^\]]+\]);/)[1]);
  expect(steps).toHaveLength(4);
  for (const schritt of steps) expect(helpTarget("liga-captains", schritt), schritt).not.toBeNull();
});

test("Link mit Anker, neuer Tab, sprechender Name; unbekannter Schritt zeigt nichts", () => {
  const { container } = render(
    <MemoryRouter>
      <HelpLink thema="liga-captains" schritt="check-in" />
      <HelpLink thema="liga-captains" schritt="gibt-es-nicht" />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Hilfe: Einchecken (neuer Tab)" });
  expect(link).toHaveAttribute("href", "/hilfe/liga-captains#check-in");
  expect(link).toHaveAttribute("target", "_blank");
  expect(container.querySelectorAll("a")).toHaveLength(1);
});
