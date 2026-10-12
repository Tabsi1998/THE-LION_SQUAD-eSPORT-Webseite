import { StyleSheet } from "react-native";

// Prüf-Hilfe Barrierefreiheit (#1155): geht den gerenderten Baum eines Screens durch (Jest, RNTL) und meldet, was
// Menschen mit großer Schrift oder Vorleser stört:
// - name:      ein Knopf, Link oder Reiter ohne Namen (kein `accessibilityLabel`, keine lesbare Schrift darin - Symbole
//              aus der Symbol-Schrift zählen nicht)
// - target:    eine Tippfläche mit fester Größe unter 48 Punkten, auch mit `hitSlop`
// - tab-state: ein Reiter sagt nicht, ob er gewählt ist
// - scaling:   Schrift, die nicht mitwächst (`allowFontScaling={false}`) oder vor 1,5-fach stehen bleibt, ohne kleiner
//              zu werden (`maxFontSizeMultiplier` < 1,5 ohne `adjustsFontSizeToFit`)
// - clip:      Schrift auf eine Zeile gekürzt (`numberOfLines={1}` ohne `adjustsFontSizeToFit`) - bei großer Schrift
//              steht dort „…“; Namen sollen umbrechen
// Ergebnis ist eine Liste stabiler Zeilen („Regel: Name“); der Test vergleicht sie mit einer Grundlinie (Ratsche).

export type A11yRule = "name" | "target" | "tab-state" | "scaling" | "clip";
export type A11yFinding = { rule: A11yRule; label: string };

export type A11yNode = {
  type: unknown;
  props: Record<string, unknown>;
  children?: Array<A11yNode | string> | null;
};

const CONTROL_ROLES = new Set(["button", "link", "tab", "switch", "checkbox", "radio", "menuitem", "togglebutton", "imagebutton"]);
export const MIN_TARGET = 48;
export const MIN_SCALE = 1.5;
/** Buchstabe oder Ziffer - Zeichen der Symbol-Schrift (privater Bereich) zählen nicht als Name. */
const READABLE = /[0-9A-Za-zÀ-ɏ]/;

function isHost(node: A11yNode): boolean {
  return typeof node.type === "string";
}

function childrenOf(node: A11yNode): Array<A11yNode | string> {
  return Array.isArray(node.children) ? node.children : [];
}

/** Die lesbare Schrift unter einem Knoten (ohne Symbole). */
export function textOf(node: A11yNode): string {
  const parts: string[] = [];
  const walk = (current: A11yNode | string) => {
    if (typeof current === "string") {
      if (READABLE.test(current)) parts.push(current);
      return;
    }
    childrenOf(current).forEach(walk);
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Ein Knopf: mit Rolle (Knopf, Link, Reiter …) oder eine antippbare Fläche ohne Rolle (Pressable mit `onPress`). */
function isControl(node: A11yNode): boolean {
  const role = String(node.props.accessibilityRole || node.props.role || "");
  if (CONTROL_ROLES.has(role)) return true;
  if (node.type === "TextInput" || node.type === "Text" || node.type === "RCTText") return false;
  return node.props.accessible !== false && typeof node.props.onClick === "function";
}

/** Feste Größe einer Fläche - eine Mindesthöhe zählt, wenn keine feste Höhe gesetzt ist. */
function sizeOf(style: unknown): { width?: number; height?: number } {
  const flat = (StyleSheet.flatten(style as never) || {}) as { width?: unknown; height?: unknown; minHeight?: unknown; minWidth?: unknown };
  const number = (value: unknown) => (typeof value === "number" ? value : undefined);
  return {
    // `minWidth: 0` ist ein Flex-Kniff, keine Größe - nur echte Mindestmaße zählen.
    width: number(flat.width) ?? (number(flat.minWidth) || undefined),
    height: number(flat.height) ?? (number(flat.minHeight) || undefined),
  };
}

function slopOf(value: unknown): { x: number; y: number } {
  if (typeof value === "number") return { x: value * 2, y: value * 2 };
  if (value && typeof value === "object") {
    const slop = value as { top?: number; bottom?: number; left?: number; right?: number };
    return { x: (slop.left || 0) + (slop.right || 0), y: (slop.top || 0) + (slop.bottom || 0) };
  }
  return { x: 0, y: 0 };
}

function labelOf(node: A11yNode): string {
  const label = String(node.props.accessibilityLabel || node.props["aria-label"] || "").trim();
  const testID = String(node.props.testID || "").trim();
  return (label || textOf(node) || testID || String(node.type)).slice(0, 48);
}

/** Alle Funde in einem gerenderten Baum (Wurzel und alle Knoten darunter). */
export function auditTree(root: A11yNode): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const walk = (node: A11yNode | string) => {
    if (typeof node === "string") return;
    if (isHost(node)) {
      const props = node.props;
      if (isControl(node)) {
        const name = String(props.accessibilityLabel || props["aria-label"] || "").trim() || textOf(node);
        if (!name) findings.push({ rule: "name", label: String(props.testID || props.accessibilityRole || "Knopf") });
        const size = sizeOf(props.style);
        const slop = slopOf(props.hitSlop);
        const small = (size.width !== undefined && size.width + slop.x < MIN_TARGET) || (size.height !== undefined && size.height + slop.y < MIN_TARGET);
        if (small) findings.push({ rule: "target", label: labelOf(node) });
        const role = String(props.accessibilityRole || props.role || "");
        const state = props.accessibilityState as { selected?: unknown } | undefined;
        if (role === "tab" && typeof state?.selected !== "boolean") findings.push({ rule: "tab-state", label: labelOf(node) });
      }
      const isText = node.type === "Text" || node.type === "RCTText";
      if (isText && READABLE.test(textOf(node))) {
        const max = props.maxFontSizeMultiplier;
        if (props.allowFontScaling === false || (typeof max === "number" && max > 0 && max < MIN_SCALE && !props.adjustsFontSizeToFit)) {
          findings.push({ rule: "scaling", label: labelOf(node) });
        }
        if (props.numberOfLines === 1 && !props.adjustsFontSizeToFit) findings.push({ rule: "clip", label: labelOf(node) });
      }
    }
    childrenOf(node).forEach(walk);
  };
  walk(root);
  return findings;
}

/** Stabile Zeilen für die Grundlinie: „Regel: Name“, je Screen sortiert und ohne Doppelte. */
export function findingLines(findings: A11yFinding[]): string[] {
  return [...new Set(findings.map((finding) => `${finding.rule}: ${finding.label}`))].sort();
}
