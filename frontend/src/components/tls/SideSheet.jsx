import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Blatt für öffentliche Seiten (#1191, #1274): am PC rechts neben der Seite, am Handy von unten über die ganze Breite.
// Kopf mit Titel und Schließen, scrollender Inhalt, optional eine feste Leiste unten. Esc und ein Klick daneben
// schließen, der Hintergrund scrollt nicht mit. Knöpfe darin nur über die tls-btn-Arten.

export function SideSheet({ title, eyebrow, onClose, footer = null, testId = "side-sheet", children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/70 backdrop-blur-sm"
      data-testid={`${testId}-backdrop`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="flex max-h-[92vh] sm:max-h-none sm:h-full w-full sm:max-w-[30rem] flex-col bg-[#0F0F10] border-t sm:border-t-0 sm:border-l border-white/10 rounded-t-md sm:rounded-none shadow-2xl shadow-black/60 outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
          <div className="min-w-0">
            {eyebrow ? <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{eyebrow}</div> : null}
            <h2 className="font-heading text-xl md:text-2xl font-black break-words">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" data-testid={`${testId}-close`} className="shrink-0 p-2 text-white/50 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 md:px-6 md:py-5 space-y-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0A0A0A]/95 px-4 py-3 md:px-6">{footer}</div> : null}
      </div>
    </div>
  );
}

export default SideSheet;
