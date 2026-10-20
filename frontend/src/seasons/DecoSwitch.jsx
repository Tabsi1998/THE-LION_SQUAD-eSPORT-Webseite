import { Sun } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSeason } from "./SeasonContext";

// Der Schalter im Footer (#634): jede Person stellt die saisonale Deko für sich auf an, dezent oder aus.
// Angemeldet landet die Wahl im Konto (gilt auch in der App), sonst im Browser.

export const DECO_OPTIONS = [
  ["on", "an"],
  ["subtle", "dezent"],
  ["off", "aus"],
];

export function DecoSwitch({ className = "inline-flex" }) {
  const { preference, setPreference, ready, seasons } = useSeason();
  if (!ready || seasons.length === 0) return null;
  return (
    <div className={`${className} items-center gap-1.5`} data-testid="season-deco-switch" role="group" aria-label="Saisonale Deko">
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
 * Der Schalter im Handy-Menü (#1239): eine Zeile ganz unten im Menü - Sonne, „Saison-Deko“ und die drei Stufen als
 * Umschalter. Nur solange eine Saison läuft.
 */
export function MenuDecoSwitch() {
  const { preference, setPreference, ready, seasons } = useSeason();
  if (!ready || seasons.length === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2" data-testid="menu-deco-switch" role="group" aria-label="Saisonale Deko">
      <Sun aria-hidden="true" className="w-4 h-4 shrink-0 text-honor" />
      <span className="text-sm font-semibold uppercase tracking-wider text-white/80" aria-hidden="true">Saison-Deko</span>
      <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded-sm border border-white/15">
        {DECO_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            aria-pressed={preference === value}
            data-testid={`menu-deco-${value}`}
            className={`min-h-10 px-3 text-[11px] font-bold uppercase tracking-wider transition ${preference === value ? "bg-[#29B6E8] text-[#04141B]" : "text-white/60 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Der Schalter nur für Gäste (#1146): Angemeldete stellen die Deko unter Einstellungen → Darstellung ein - die Wahl gilt
 * fürs Konto, auch in der App. So steht die Einstellung für sie an genau einem Ort. Für Gäste je Gerät ein Platz (#1239):
 * am Handy unten im Menü (`variant="menu"`), am PC in der Fußzeile.
 */
export function GuestDecoSwitch({ variant = "footer", className }) {
  const { user } = useAuth();
  if (user) return null;
  return variant === "menu" ? <MenuDecoSwitch /> : <DecoSwitch className={className} />;
}
