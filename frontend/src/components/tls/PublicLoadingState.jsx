import { LoaderCircle } from "lucide-react";

export function PublicLoadingState({
  label = "Lade Inhalte",
  variant = "page",
  cards = 0,
  className = "",
}) {
  if (cards > 0) {
    return (
      <div className={`grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 ${className}`} aria-busy="true">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-sm border border-white/10 bg-[#121212]">
            <div className="aspect-video animate-pulse bg-white/5" />
            <div className="space-y-3 p-5">
              <div className="h-3 w-1/3 animate-pulse rounded-sm bg-white/10" />
              <div className="h-5 w-3/4 animate-pulse rounded-sm bg-white/10" />
              <div className="h-3 w-1/2 animate-pulse rounded-sm bg-white/5" />
              <div className="h-3 w-2/3 animate-pulse rounded-sm bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const compact = variant === "inline";
  return (
    <div
      className={`${compact ? "py-4 text-sm" : "min-h-[42vh] px-6 py-20"} flex flex-col items-center justify-center text-center text-white/45 ${className}`}
      aria-busy="true"
      role="status"
    >
      <LoaderCircle className={`${compact ? "h-4 w-4" : "h-8 w-8"} animate-spin text-[#29B6E8]`} />
      <div className={`${compact ? "mt-2" : "mt-4"} font-display text-xs uppercase tracking-[0.28em]`}>
        {label}
      </div>
    </div>
  );
}
