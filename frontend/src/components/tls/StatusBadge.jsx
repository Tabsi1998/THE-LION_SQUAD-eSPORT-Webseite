const STATUS_MAP = {
  live: { label: "LIVE", cls: "bg-[#FF3B30]/20 text-[#FF3B30] border-[#FF3B30]/50 animate-live" },
  registration_open: { label: "ANMELDUNG OFFEN", cls: "bg-[#00FF88]/15 text-[#00FF88] border-[#00FF88]/50" },
  check_in: { label: "CHECK-IN OFFEN", cls: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/50" },
  checkin_open: { label: "CHECK-IN OFFEN", cls: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/50" },
  paused: { label: "PAUSIERT", cls: "bg-white/10 text-white/80 border-white/20" },
  draft: { label: "ENTWURF", cls: "bg-white/5 text-white/60 border-white/10" },
  completed: { label: "BEENDET", cls: "bg-white/10 text-white/70 border-white/20" },
  archived: { label: "ARCHIVIERT", cls: "bg-white/5 text-white/40 border-white/10" },
  upcoming: { label: "BEVORSTEHEND", cls: "bg-[#29B6E8]/15 text-[#29B6E8] border-[#29B6E8]/50" },
  pending: { label: "AUSSTEHEND", cls: "bg-white/10 text-white/70 border-white/20" },
  approved: { label: "ANGENOMMEN", cls: "bg-[#00FF88]/15 text-[#00FF88] border-[#00FF88]/40" },
  rejected: { label: "ABGELEHNT", cls: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40" },
  waitlist: { label: "WARTELISTE", cls: "bg-[#FFD700]/10 text-[#FFD700] border-[#FFD700]/40" },
  checked_in: { label: "CHECKED IN", cls: "bg-[#29B6E8]/15 text-[#29B6E8] border-[#29B6E8]/40" },
  no_show: { label: "NO-SHOW", cls: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40" },
  disputed: { label: "DISPUTE", cls: "bg-[#FF3B30]/20 text-[#FF3B30] border-[#FF3B30]/50" },
  ready: { label: "BEREIT", cls: "bg-[#29B6E8]/15 text-[#29B6E8] border-[#29B6E8]/40" },
  scheduled: { label: "ANGEKÜNDIGT", cls: "bg-[#29B6E8]/10 text-[#29B6E8] border-[#29B6E8]/40" },
  registration_closed: { label: "ANMELDUNG GESCHLOSSEN", cls: "bg-white/10 text-white/70 border-white/20" },
  results_published: { label: "ERGEBNISSE", cls: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40" },
  cancelled: { label: "ABGESAGT", cls: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40" },
  in_progress: { label: "LÄUFT", cls: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40 animate-live" },
  waiting_result: { label: "WARTET AUF ERGEBNIS", cls: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40" },
  forfeit: { label: "FORFEIT", cls: "bg-white/10 text-white/70 border-white/20" },
  free: { label: "FREI", cls: "bg-[#00FF88]/15 text-[#00FF88] border-[#00FF88]/40" },
  busy: { label: "BELEGT", cls: "bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/40" },
  broken: { label: "DEFEKT", cls: "bg-white/10 text-white/50 border-white/20" },
  reserved: { label: "RESERVIERT", cls: "bg-[#FFD700]/15 text-[#FFD700] border-[#FFD700]/40" },
};

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
