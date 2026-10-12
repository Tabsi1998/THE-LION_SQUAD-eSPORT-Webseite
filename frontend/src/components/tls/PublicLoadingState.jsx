import { SkeletonCards, SkeletonDetailPage, SkeletonLines } from "./Skeleton";

/**
 * Ladezustand einer Seite (#1231): statt Kreisel und „Lade …“ ein ruhiges Skelett in der Form der Seite. Die ganze
 * Seite hält dabei mindestens eine Bildschirmhöhe frei - die Fußzeile steht so nie im ersten Bildschirm und springt
 * nicht, wenn der Inhalt kommt. `cards` zeigt Karten (Listen), `inline` ein paar Zeilen mitten im Inhalt.
 */
export function PublicLoadingState({
  label = "Lade Inhalte",
  variant = "page",
  cards = 0,
  className = "",
}) {
  if (cards > 0) return <SkeletonCards count={cards} label={label} className={className} />;
  if (variant === "inline") return <SkeletonLines lines={2} label={label} className={`py-2 ${className}`} />;
  return (
    <div
      className={`mx-auto min-h-[100svh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8 ${className}`}
      role="status"
      aria-busy="true"
      data-testid="page-loading"
    >
      <span className="sr-only">{label}</span>
      <SkeletonDetailPage bare />
    </div>
  );
}
