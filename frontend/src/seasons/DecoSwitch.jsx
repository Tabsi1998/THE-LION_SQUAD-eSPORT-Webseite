import { useAuth } from "@/context/AuthContext";
import { useSeason } from "./SeasonContext";

// Der Schalter im Footer (#634): jede Person stellt die saisonale Deko für sich auf an, dezent oder aus.
// Angemeldet landet die Wahl im Konto (gilt auch in der App), sonst im Browser.

export const DECO_OPTIONS = [
  ["on", "an"],
  ["subtle", "dezent"],
  ["off", "aus"],
];

export function DecoSwitch() {
  const { preference, setPreference, ready, seasons } = useSeason();
  if (!ready || seasons.length === 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5" data-testid="season-deco-switch" role="group" aria-label="Saisonale Deko">
      <span>Deko:</span>
      {DECO_OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setPreference(value)}
          aria-pressed={preference === value}
          data-testid={`season-deco-${value}`}
          className={`px-1.5 py-0.5 rounded-sm transition ${preference === value ? "bg-white/10 text-white" : "hover:text-[#29B6E8]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Der Schalter im Footer nur für Gäste (#1146): Angemeldete stellen die Deko unter Einstellungen → Darstellung ein - die
 * Wahl gilt fürs Konto, auch in der App. So steht die Einstellung für sie an genau einem Ort.
 */
export function GuestDecoSwitch() {
  const { user } = useAuth();
  return user ? null : <DecoSwitch />;
}
