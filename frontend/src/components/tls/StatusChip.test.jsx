import { render, screen } from "@testing-library/react";
import { STATUS_KIND_ORDER, STATUS_KINDS } from "@/lib/statusKinds";
import { StatusChip } from "./StatusChip";

// Zustands-Schild (#1306): je Art ein Symbol, eine Farbe (data-kind → styles/system.css) und ein Wort. Das Symbol ist
// stumm, das Wort trägt den Zustand - auch für Vorleseprogramme.

// Lucide-Namen der Symbole (Klasse lucide-<name>).
const LUCIDE = {
  clock: "lucide-clock",
  "user-plus": "lucide-user-plus",
  "circle-check": "lucide-circle-check",
  plug: "lucide-plug",
  check: "lucide-check",
  hourglass: "lucide-hourglass",
  "triangle-alert": "lucide-triangle-alert",
  flag: "lucide-flag",
  ban: "lucide-ban",
};

test.each(STATUS_KIND_ORDER)("Art %s: Symbol, Farbe und Wort", (kind) => {
  render(<StatusChip kind={kind} testId="chip" dotTestId="dot" />);
  const chip = screen.getByTestId("chip");
  const info = STATUS_KINDS[kind];
  expect(chip).toHaveClass("tls-status-chip");
  expect(chip).toHaveAttribute("data-kind", kind);
  expect(chip).toHaveTextContent(new RegExp(`^${info.label}$`));
  if (info.icon === "live-dot") {
    expect(screen.getByTestId("dot")).toHaveClass("tls-live-dot");
    expect(screen.getByTestId("dot")).toHaveAttribute("aria-hidden", "true");
    expect(chip.querySelector("svg")).toBeNull();
  } else {
    const icon = chip.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass(LUCIDE[info.icon]);
    expect(icon).toHaveClass("tls-status-chip__icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId("dot")).toBeNull();
  }
  // Der Name für Vorleseprogramme ist das Wort - das Symbol spricht nicht mit.
  expect(chip.textContent).toBe(info.label);
});

test("fremde bestätigte Anmeldung ruhig grau mit Haken, die eigene in Cyan (Fabian Nr. 303)", () => {
  const { rerender } = render(<StatusChip status="approved" testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveAttribute("data-kind", "joined");
  expect(screen.getByTestId("chip")).toHaveAttribute("data-variant", "quiet");
  expect(screen.getByTestId("chip")).toHaveTextContent(/^Bestätigt$/);
  expect(screen.getByTestId("chip").querySelector("svg.lucide-check")).not.toBeNull();
  rerender(<StatusChip status="approved" own testId="chip" />);
  expect(screen.getByTestId("chip")).not.toHaveAttribute("data-variant");
  expect(screen.getByTestId("chip")).toHaveTextContent(/^Du bist dabei$/);
  rerender(<StatusChip kind="joined" label="Du bist dabei" testId="chip" />);
  expect(screen.getByTestId("chip")).not.toHaveAttribute("data-variant");
});

test("laufende Saison: rotes „Läuft“, der Punkt steht still; pulse={false} geht auch von Hand", () => {
  const { rerender } = render(<StatusChip status="active" testId="chip" dotTestId="dot" />);
  expect(screen.getByTestId("chip")).toHaveAttribute("data-kind", "live");
  expect(screen.getByTestId("chip")).toHaveTextContent(/^Läuft$/);
  expect(screen.getByTestId("dot")).toHaveClass("tls-live-dot", "tls-live-dot--still");
  rerender(<StatusChip status="live" testId="chip" dotTestId="dot" />);
  expect(screen.getByTestId("dot")).not.toHaveClass("tls-live-dot--still");
  rerender(<StatusChip status="live" pulse={false} testId="chip" dotTestId="dot" />);
  expect(screen.getByTestId("dot")).toHaveClass("tls-live-dot--still");
});

test("ein Zustand wählt Art und Wort aus der Tabelle; ein eigenes Wort geht vor", () => {
  const { rerender } = render(<StatusChip status="in_progress" testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveAttribute("data-kind", "live");
  expect(screen.getByTestId("chip")).toHaveTextContent(/^Läuft$/);
  rerender(<StatusChip status="busy" label="Belegt · Platz 3" testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveTextContent("Belegt · Platz 3");
  rerender(<StatusChip status="mystery" testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveTextContent(/^Unbekannt$/);
});

test("der Countdown steht neben dem Schild, nie darin", () => {
  render(<StatusChip status="registration_open" meta="endet in 1 Tag 23 Std." testId="chip" metaTestId="meta" />);
  const chip = screen.getByTestId("chip");
  const meta = screen.getByTestId("meta");
  expect(chip).toHaveTextContent(/^Anmeldung offen$/);
  expect(chip).not.toContainElement(meta);
  expect(meta).toHaveClass("tls-status__meta", "tls-type-small");
  expect(chip.parentElement).toHaveClass("tls-status");
  expect(chip.parentElement).toContainElement(meta);
});

test("groß und auf Bildern: eigene Klassen, die Klasse der Stelle sitzt außen", () => {
  const { rerender } = render(<StatusChip status="live" size="lg" onMedia className="self-start" testId="chip" />);
  expect(screen.getByTestId("chip")).toHaveClass("tls-status-chip--lg", "tls-status-chip--media", "self-start");
  rerender(<StatusChip status="live" meta="Tag 2/3" className="self-start" testId="chip" />);
  expect(screen.getByTestId("chip")).not.toHaveClass("self-start");
  expect(screen.getByTestId("chip").parentElement).toHaveClass("tls-status", "self-start");
});
