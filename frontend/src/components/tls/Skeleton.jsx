// Skelett-Ladezustände (#226): Platzhalter in der Form des späteren Inhalts statt „Lade …“.
// Alle atmen leicht (animate-pulse); mit „Bewegung reduzieren“ stehen sie still (index.css).

const bone = "tls-skeleton rounded-sm bg-white/[0.07]";

function Bone({ className = "" }) {
  return <div className={`${bone} ${className}`} aria-hidden="true" />;
}

function Busy({ label, className = "", children, testId = "skeleton" }) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label} data-testid={testId}>
      {children}
    </div>
  );
}

/** Ein paar Textzeilen - für Absätze, Hinweise, kurze Listen. */
export function SkeletonLines({ lines = 3, className = "", label = "Lade Inhalte" }) {
  const widths = ["w-3/4", "w-full", "w-5/6", "w-2/3", "w-1/2"];
  return (
    <Busy label={label} className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }).map((_, index) => <Bone key={index} className={`h-3.5 ${widths[index % widths.length]}`} />)}
    </Busy>
  );
}

/** Karten mit Bild oben und Text darunter - News, Events, Turniere. */
export function SkeletonCards({ count = 3, columns = 3, image = true, className = "", label = "Lade Einträge" }) {
  const grid = columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 md:grid-cols-2" : columns === 4 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  return (
    <Busy label={label} className={`grid gap-5 ${grid} ${className}`}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-sm border border-white/10 bg-[#121212]">
          {image && <Bone className="aspect-video rounded-none" />}
          <div className="space-y-3 p-5">
            <Bone className="h-3 w-1/3" />
            <Bone className="h-5 w-3/4" />
            <Bone className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Zeilen mit Symbol links und zwei Textzeilen - Mitglieder, Dokumente, Spieler. */
export function SkeletonList({ rows = 5, className = "", label = "Lade Liste" }) {
  return (
    <Busy label={label} className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#121212] p-3">
          <Bone className="h-10 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-3.5 w-1/2" />
            <Bone className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Tabelle mit Kopfzeile und Zeilen - Ranglisten, Rechnungen, Strafen. */
export function SkeletonTable({ rows = 6, columns = 4, className = "", label = "Lade Tabelle" }) {
  return (
    <Busy label={label} className={`overflow-hidden rounded-sm border border-white/10 bg-[#121212] ${className}`}>
      <div className="flex gap-4 bg-[#0A0A0A] px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => <Bone key={index} className={`h-3 ${index === 1 ? "flex-[2]" : "flex-1"}`} />)}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 border-t border-white/5 px-4 py-3">
          {Array.from({ length: columns }).map((_, index) => <Bone key={index} className={`h-4 ${index === 1 ? "flex-[2]" : "flex-1"}`} />)}
        </div>
      ))}
    </Busy>
  );
}

/** Kopf einer Detailseite: Kennzeile, großer Titel, zwei Zeilen darunter. */
export function SkeletonDetailHeader({ className = "", label = "Lade Seite" }) {
  return (
    <Busy label={label} className={`space-y-4 ${className}`}>
      <Bone className="h-3 w-32" />
      <Bone className="h-10 w-2/3 max-w-xl" />
      <Bone className="h-4 w-1/2 max-w-md" />
      <Bone className="h-4 w-1/3 max-w-sm" />
    </Busy>
  );
}

/** Ganze Seite: Kopf plus Karten - für Seiten, die sonst nur „Lade …“ zeigten. */
export function SkeletonPage({ cards = 3, className = "", label = "Lade Seite" }) {
  return (
    <div className={`space-y-8 ${className}`}>
      <SkeletonDetailHeader label={label} />
      <SkeletonCards count={cards} label={label} />
    </div>
  );
}
