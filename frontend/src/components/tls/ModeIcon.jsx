// Symbol eines Spielmodus (#2266, docs/LIGA.md C.1): ein quadratisches Bild aus dem eigenen Upload - ohne Bild ein neutrales Platzhalter-
// Symbol. Überall gleich: Modus-Chips auf Match- und Ligaseite, „Modus je Map“, Map-Pool (Editor und öffentlich), Reiter Modi.
// Schmuck neben dem Namen: Der Name steht immer daneben, darum ohne Alternativtext. `label` nur als Tooltip.
import { Shapes } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";

const SIZES = { xs: 16, sm: 20, md: 28, lg: 40 };

export function ModeIcon({ src, label = "", size = "sm", className = "", testId }) {
  const px = SIZES[size] || SIZES.sm;
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm ${className}`;
  const style = { width: px, height: px };
  if (src) {
    return (
      <span className={`${box} bg-white/[0.04]`} style={style} title={label || undefined} aria-hidden="true" data-testid={testId} data-icon="image">
        <LazyImg src={src} alt="" sizes={`${px}px`} widths={[160]} width={px} height={px} className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span className={`${box} border border-white/10 bg-white/[0.03] text-white/35`} style={style} title={label || undefined} aria-hidden="true"
      data-testid={testId} data-icon="placeholder">
      <Shapes style={{ width: Math.round(px * 0.6), height: Math.round(px * 0.6) }} />
    </span>
  );
}
