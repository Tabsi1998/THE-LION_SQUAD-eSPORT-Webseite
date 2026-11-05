import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

// Einklappbare Bereiche in der Verwaltung (#2306) - Sperrliste der Season und Ausrüstungs-Bibliothek. Die Kopfzeile ist ein Knopf mit
// `aria-expanded`; der Pfeil dreht sich, der Inhalt steigt beim Aufklappen leise ein (`tls-reveal`: Deckkraft und 4 px, 150 ms).
// Mit „Bewegung reduzieren“ stehen beide sofort (index.css). Zustand: hooks/useFold.

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const ALL_BUTTON = `tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider ${FOCUS}`;

export function FoldButton({ open, onToggle, controls, testId, className = "", children }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} data-testid={testId}
      className={`group flex min-w-0 items-center gap-2 rounded-sm text-left ${FOCUS} ${className}`}>
      <ChevronDown className={`h-4 w-4 shrink-0 text-white/50 transition-[transform,color] duration-fast group-hover:text-white ${open ? "" : "-rotate-90"}`}
        aria-hidden="true" />
      {children}
    </button>
  );
}

export function FoldBody({ id, className = "", children }) {
  return <div id={id} className={`tls-reveal ${className}`.trim()}>{children}</div>;
}

/** „Alle aufklappen“ und „Alle zuklappen“ oben neben der Suche. */
export function FoldAll({ onAll, testId }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="Bereiche auf- und zuklappen">
      <button type="button" onClick={() => onAll(true)} className={ALL_BUTTON} data-testid={`${testId}-open-all`}>
        <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" /> Alle aufklappen
      </button>
      <button type="button" onClick={() => onAll(false)} className={ALL_BUTTON} data-testid={`${testId}-close-all`}>
        <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" /> Alle zuklappen
      </button>
    </div>
  );
}
