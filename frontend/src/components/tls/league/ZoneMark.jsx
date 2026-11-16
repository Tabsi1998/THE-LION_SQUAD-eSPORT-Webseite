import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight } from "lucide-react";

// Zone für Auf- und Abstieg nie nur über die Farbe (#1648): hinauf ↑, hinunter ↓, die Relegation schräg. Das Symbol ist
// Zierde (aria-hidden) - das Wort steht für Screenreader daneben (sr-only) bzw. in der Legende. Web-Tabelle, Legende und
// TV nehmen dasselbe Symbol; die Farbe kommt aus --tls-zone-color (index.css).
const ZONE_ICONS = { promotion: ArrowUp, playoff_promotion: ArrowUpRight, playoff_relegation: ArrowDownRight, relegation: ArrowDown };

export function ZoneMark({ zone, className = "h-3 w-3", testId }) {
  const Icon = ZONE_ICONS[zone];
  if (!Icon) return null;
  return <Icon className={`tls-zone-mark ${className}`} data-zone={zone} strokeWidth={3} aria-hidden="true" data-testid={testId} />;
}
