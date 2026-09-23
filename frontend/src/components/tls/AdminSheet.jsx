import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Seitenblatt (#435): kleine Formulare (Sponsor, Partner, Vorstand, Referenz …) öffnen sich von
// rechts über der Liste statt als Fenster in der Bildschirmmitte. Am PC 36–56 rem breit, die Liste
// bleibt daneben sichtbar; am Handy Vollbild. Kopf mit Titel und Schließen, scrollender Inhalt,
// feste Leiste unten mit Abbrechen und Speichern. Esc und ein Klick daneben schließen, der
// Hintergrund scrollt nicht mit. Die Bausteine darin sind dieselben wie in der Editor-Seite
// (`FormSection`, `FormGrid`, Felder aus `FormFields.jsx`).

const WIDTHS = {
  md: "sm:max-w-[36rem]",
  lg: "sm:max-w-[44rem]",
  xl: "sm:max-w-[56rem]",
};

export function AdminSheet({ title, eyebrow, accent = "#29B6E8", size = "md", onClose, onSubmit, saving = false, submitLabel = "Speichern", savingLabel = "Speichere …", submitTestId, cancelLabel = "Abbrechen", footer, testId = "admin-sheet", children }) {
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

  const Panel = onSubmit ? "form" : "div";
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
      data-testid={`${testId}-backdrop`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <Panel
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={onSubmit}
        data-testid={testId}
        className={`flex h-full w-full ${WIDTHS[size] || WIDTHS.md} flex-col bg-[#0F0F10] border-l border-white/10 shadow-2xl shadow-black/60 outline-none`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
          <div className="min-w-0">
            {eyebrow && <div className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: accent }}>{eyebrow}</div>}
            <h2 className="font-heading text-xl md:text-2xl font-black uppercase break-words">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" data-testid={`${testId}-close`} className="shrink-0 p-2 text-white/50 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 md:px-6 md:py-5 space-y-5">{children}</div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0A0A0A]/95 px-4 py-3 md:px-6" data-testid={`${testId}-actions`}>
          <button type="button" onClick={onClose} data-testid={`${testId}-cancel`} className="inline-flex items-center px-4 py-2.5 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm transition">
            {cancelLabel}
          </button>
          {footer}
          {onSubmit && (
            <button type="submit" disabled={saving} data-testid={submitTestId} style={{ backgroundColor: accent }} className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:opacity-90 disabled:opacity-50 transition">
              {saving ? savingLabel : submitLabel}
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}
