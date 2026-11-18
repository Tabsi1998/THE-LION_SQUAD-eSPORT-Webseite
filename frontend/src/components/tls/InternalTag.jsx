import { Lock } from "lucide-react";

// „Vereinsintern“ (#2516): ein Eintrag, den Gäste nie sehen - ein Turnier, eine Fast-Lap-Zeit oder eine Trophäe, die nur die
// Person selbst und Vereinsmitglieder sehen. Der Server setzt dafür `internal: true`; dieselbe Kennzeichnung in Referenzen,
// Highlights, Trophäen-Bannern und der Vitrine an Profil und Team. Ruhig gehalten: ein Hinweis, kein Warnsignal.
export const INTERNAL_HINT = "Sehen nur Vereinsmitglieder – öffentlich nie.";

export function InternalTag({ testId, className = "" }) {
  return (
    <span
      title={INTERNAL_HINT}
      data-testid={testId}
      className={`inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-widest leading-none text-white/75 border border-white/20 bg-white/[0.04] px-1.5 py-1 rounded-sm ${className}`}
    >
      <Lock className="w-3 h-3" aria-hidden="true" />
      Vereinsintern
    </span>
  );
}
