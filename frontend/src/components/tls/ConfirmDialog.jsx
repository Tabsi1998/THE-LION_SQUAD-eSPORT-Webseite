import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const ConfirmContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setDialog({
      title: options?.title || "Aktion bestätigen",
      description: options?.description || "Diese Aktion kann nicht automatisch rückgängig gemacht werden.",
      confirmLabel: options?.confirmLabel || "Bestätigen",
      cancelLabel: options?.cancelLabel || "Abbrechen",
      tone: options?.tone || "danger",
    });
  }), []);

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm p-4 flex items-center justify-center" role="presentation" onClick={() => close(false)}>
          <div className="w-full max-w-md bg-[#121212] border border-white/10 rounded-sm shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-5 border-b border-white/10">
              <div className={`w-10 h-10 rounded-sm border flex items-center justify-center shrink-0 ${dialog.tone === "danger" ? "border-[#FF3B30]/45 text-[#FF3B30] bg-[#FF3B30]/10" : "border-[#29B6E8]/45 text-[#29B6E8] bg-[#29B6E8]/10"}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-title" className="font-heading font-black uppercase text-lg">{dialog.title}</h2>
                <p className="mt-1 text-sm text-white/60 leading-relaxed">{dialog.description}</p>
              </div>
              <button type="button" onClick={() => close(false)} className="p-1 text-white/45 hover:text-white" aria-label="Schließen">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => close(false)} className="px-4 py-2 border border-white/10 text-white/65 hover:text-white hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider">
                {dialog.cancelLabel}
              </button>
              <button type="button" onClick={() => close(true)} className={`px-4 py-2 rounded-sm text-xs font-black uppercase tracking-wider ${dialog.tone === "danger" ? "bg-[#FF3B30] text-white hover:bg-[#ff5b52]" : "bg-[#29B6E8] text-black hover:bg-[#6FD6FF]"}`}>
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used within ConfirmDialogProvider");
  return context.confirm;
}
