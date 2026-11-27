import { StatusChip } from "@/components/tls/StatusChip";
import { statusWord } from "@/lib/statusKinds";

// Dünne Hülle (#1306): Zustände zeigt StatusChip - Art und Wort aus lib/statusKinds.js, eine Farbe je Bedeutung. Der alte
// Name bleibt für die Stellen, die einen Rohstatus haben (Teilnehmerlisten, Spiele, Stationen, Verwaltung).

/** Das Wort eines Zustands - auch für Schilder, die anders aussehen (TV-Seiten). Nie der Rohwert. */
export function statusBadgeLabel(status, options) {
  return statusWord(status, options);
}

export function StatusBadge({ status, className = "", size = "sm", testId, own = false, onMedia = false }) {
  return (
    <StatusChip
      status={status}
      own={own}
      size={size === "lg" ? "lg" : "sm"}
      onMedia={onMedia}
      className={className}
      testId={testId || `status-${status}`}
    />
  );
}
