import { Ban, Check, CircleCheck, Clock, Flag, Hourglass, Plug, TriangleAlert, UserPlus } from "lucide-react";
import { STATUS_KINDS, statusKind } from "@/lib/statusKinds";

// Ein Schild für jeden Zustand (#1306): Art und Wort aus lib/statusKinds.js, Aussehen aus styles/system.css
// (.tls-status-chip). Ersetzt StatusBadge und PhaseBadge - die beiden bleiben als dünne Hüllen. Symbol und Wort tragen den
// Zustand, die Farbe ist nie die einzige Information; das Symbol ist für Vorleseprogramme stumm. Ein Countdown oder eine
// Zeitangabe kommt als `meta` daneben, nie ins Schild.

const ICONS = {
  clock: Clock,
  "user-plus": UserPlus,
  "circle-check": CircleCheck,
  plug: Plug,
  check: Check,
  hourglass: Hourglass,
  "triangle-alert": TriangleAlert,
  flag: Flag,
  ban: Ban,
};

/** Das Symbol einer Art - auch für die TV-Pille (TvPill), die es in Beamer-Größe zeigt. `still`: der Punkt bei „Läuft“
 *  pulsiert nicht (laufende Saison). */
export function StatusKindIcon({ kind, testId, className = "tls-status-chip__icon", dotClassName = "tls-live-dot", still = false }) {
  const icon = STATUS_KINDS[kind]?.icon;
  if (icon === "live-dot") return <span className={`${dotClassName}${still ? " tls-live-dot--still" : ""}`} aria-hidden="true" data-testid={testId} data-still={still ? "1" : undefined} />;
  const Icon = ICONS[icon];
  return Icon ? <Icon className={className} aria-hidden="true" focusable="false" /> : null;
}

/**
 * @param {string} status   Zustand (Phase, Status, Anmeldung, Spiel, Station)
 * @param {string} [kind]   Art direkt (TV-Modi, die kein gemeinsamer Zustand sind) - geht vor `status`
 * @param {string} [label]  eigenes Wort der Stelle (z. B. vom Server) - sonst das Wort aus der Tabelle
 * @param {boolean} [own]   die eigene Anmeldung: „Du bist dabei“ in Cyan statt „Bestätigt“ in ruhigem Grau
 * @param {"quiet"} [variant] ruhige Spielart von Hand (sonst aus der Tabelle)
 * @param {boolean} [pulse] pulsiert der Punkt bei „Läuft“? Ohne Angabe sagt es die Tabelle (Saison: still)
 * @param {"sm"|"lg"} [size]
 * @param {boolean} [onMedia] auf einem Bild: mit dunkler Unterlage
 * @param {import("react").ReactNode} [meta] kleiner Text daneben (Countdown, Tag) - am Handy darunter
 */
export function StatusChip({ status, kind: kindProp, variant: variantProp, label, own = false, pulse, size = "sm", onMedia = false, meta = null, className = "", testId, dotTestId, metaTestId, dataTone }) {
  const resolved = statusKind(status, { own });
  const kind = kindProp && STATUS_KINDS[kindProp] ? kindProp : resolved.kind;
  // Ruhige Spielart (Fabian Nr. 303): aus der Tabelle, solange die Stelle keine andere Art setzt - oder von Hand.
  const variant = variantProp ?? (kind === resolved.kind ? resolved.variant : null);
  const word = label || (kindProp && !status ? STATUS_KINDS[kind].label : resolved.word);
  const pulsing = pulse ?? (status && resolved.known ? resolved.pulse : true);
  const chip = (
    <span
      className={`tls-status-chip${size === "lg" ? " tls-status-chip--lg" : ""}${onMedia ? " tls-status-chip--media" : ""}${meta ? "" : className ? ` ${className}` : ""}`}
      data-kind={kind}
      data-variant={variant || undefined}
      data-status={status || undefined}
      data-tone={dataTone}
      data-testid={testId}
    >
      <StatusKindIcon kind={kind} testId={dotTestId} still={!pulsing} />
      <span className="tls-status-chip__word">{word}</span>
    </span>
  );
  if (!meta) return chip;
  return (
    <span className={`tls-status${onMedia ? " tls-status--media" : ""}${className ? ` ${className}` : ""}`}>
      {chip}
      <span className="tls-status__meta tls-type-small" data-testid={metaTestId}>
        <span className="sr-only">, </span>
        {meta}
      </span>
    </span>
  );
}

export default StatusChip;
