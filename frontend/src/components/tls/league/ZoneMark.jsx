import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Swords } from "lucide-react";

// Zone für Auf- und Abstieg nie nur über die Farbe (#1648): hinauf ↑, hinunter ↓, die Relegation schräg. Das Symbol ist
// Zierde (aria-hidden) - das Wort steht für Screenreader daneben (sr-only) bzw. in der Legende. Web-Tabelle, Legende und
// TV nehmen dasselbe Symbol; die Farbe kommt aus --tls-zone-color (index.css).
const ZONE_ICONS = { promotion: ArrowUp, playoff_promotion: ArrowUpRight, playoff_relegation: ArrowDownRight, relegation: ArrowDown };

// Playoff-Platz (#2404, F.6): ein eigenes Kennzeichen neben der Zone - ein Team kann zugleich Aufsteiger und Playoff-Teilnehmer sein.
// Wie bei den Zonen nie nur Farbe: das Symbol, daneben das Wort für Screenreader bzw. in der Legende.
export function PlayoffMark({ className = "h-3 w-3", testId }) {
  return <Swords className={`tls-playoff-mark ${className}`} strokeWidth={2.5} aria-hidden="true" data-testid={testId} />;
}

export function ZoneMark({ zone, className = "h-3 w-3", testId }) {
  const Icon = ZONE_ICONS[zone];
  if (!Icon) return null;
  return <Icon className={`tls-zone-mark ${className}`} data-zone={zone} strokeWidth={3} aria-hidden="true" data-testid={testId} />;
}
