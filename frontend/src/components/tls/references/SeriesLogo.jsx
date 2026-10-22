import { SmartLogo } from "@/components/tls/SmartLogo";
import { resolveMediaUrl } from "@/lib/api";

// Logo einer Spur bzw. Saison (#2014) in einem festen Kasten: so hoch wie die Größe sagt, so breit wie das Logo es
// braucht (bis zur Grenze). Wie hochgeladen, nie eingefärbt (Entscheidung zu #1321). Ohne Logo kommt nichts - die
// Stelle zeigt dann ihren bisherigen Rückfall.

const SIZES = {
  xs: "h-4 max-w-[56px]",
  sm: "h-7 max-w-[96px]",
  lg: "h-12 md:h-16 max-w-[180px] md:max-w-[240px]",
};

export function SeriesLogo({ src, size = "sm", alt = "", className = "", testId = "series-logo" }) {
  if (!src) return null;
  return (
    <span className={`${SIZES[size] || SIZES.sm} shrink-0 inline-flex items-center ${className}`} data-testid={testId}>
      <SmartLogo src={resolveMediaUrl(src)} alt={alt} className="max-h-full max-w-full w-auto h-auto" />
    </span>
  );
}
