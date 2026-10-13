// Zustände nach Farb-Rolle (#1305, styles/system.css): Rot nur „läuft gerade“ (und eine belegte Station - dort läuft
// etwas), Grün offen und frei, Orange Achtung, Cyan Marke und „du“, Grau wartet oder ist vorbei. Gold ist Ehre und
// kommt bei Zuständen nicht mehr vor.
const LIVE = "bg-live/20 text-live border-live/50";
const OK = "bg-ok/15 text-ok border-ok/50";
const WARN = "bg-warn/15 text-warn border-warn/50";
const BRAND = "bg-brand/15 text-brand border-brand/50";
// Wartet (Warteliste, Ergebnis, reserviert): ruhiger Nebentext. Vorbei (abgesagt, abgelehnt, nicht erschienen): leiser.
const WAITING = "bg-white/5 text-muted-text border-white/20";
const OVER = "bg-white/5 text-quiet border-white/10";

const STATUS_MAP = {
  live: { label: "LIVE", cls: `${LIVE} animate-live` },
  // Eine laufende Saison (#1222): „Läuft“ statt „ACTIVE“.
  active: { label: "LÄUFT", cls: BRAND },
  registration_open: { label: "ANMELDUNG OFFEN", cls: OK },
  check_in: { label: "CHECK-IN OFFEN", cls: OK },
  checkin_open: { label: "CHECK-IN OFFEN", cls: OK },
  paused: { label: "PAUSIERT", cls: "bg-white/10 text-white/80 border-white/20" },
  draft: { label: "ENTWURF", cls: "bg-white/5 text-white/60 border-white/10" },
  completed: { label: "BEENDET", cls: "bg-white/10 text-white/70 border-white/20" },
  archived: { label: "ARCHIVIERT", cls: "bg-white/5 text-white/40 border-white/10" },
  upcoming: { label: "BEVORSTEHEND", cls: BRAND },
  pending: { label: "AUSSTEHEND", cls: "bg-white/10 text-white/70 border-white/20" },
  approved: { label: "ANGENOMMEN", cls: OK },
  rejected: { label: "ABGELEHNT", cls: OVER },
  waitlist: { label: "WARTELISTE", cls: WAITING },
  checked_in: { label: "EINGECHECKT", cls: BRAND },
  no_show: { label: "NICHT ERSCHIENEN", cls: OVER },
  disputed: { label: "KLÄRUNG", cls: WARN },
  ready: { label: "BEREIT", cls: BRAND },
  scheduled: { label: "ANGEKÜNDIGT", cls: "bg-brand/10 text-brand border-brand/40" },
  registration_closed: { label: "ANMELDUNG GESCHLOSSEN", cls: "bg-white/10 text-white/70 border-white/20" },
  results_published: { label: "ERGEBNISSE", cls: WAITING },
  cancelled: { label: "ABGESAGT", cls: OVER },
  in_progress: { label: "LÄUFT", cls: `${LIVE} animate-live` },
  waiting_result: { label: "WARTET AUF ERGEBNIS", cls: WAITING },
  forfeit: { label: "WERTUNG", cls: "bg-white/10 text-white/70 border-white/20" },
  free: { label: "FREI", cls: OK },
  busy: { label: "BELEGT", cls: LIVE },
  broken: { label: "DEFEKT", cls: WARN },
  reserved: { label: "RESERVIERT", cls: WAITING },
};

/** Die Beschriftung eines Zustands - auch für Schilder, die anders aussehen (TV-Seiten). */
export function statusBadgeLabel(status) {
  return STATUS_MAP[status]?.label || status?.toUpperCase() || "—";
}

export function StatusBadge({ status, className = "", size = "sm", testId }) {
  const info = STATUS_MAP[status] || { label: status?.toUpperCase() || "—", cls: "bg-white/10 text-white border-white/20" };
  const sz = size === "lg" ? "text-sm px-3 py-1" : "text-[10px] px-2 py-[3px]";
  return (
    <span
      data-testid={testId || `status-${status}`}
      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider border rounded-sm ${sz} ${info.cls} ${className}`}
    >
      {status === "live" || status === "in_progress" ? <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> : null}
      {info.label}
    </span>
  );
}
