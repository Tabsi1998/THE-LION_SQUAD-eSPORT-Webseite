import { useCallback, useEffect, useState } from "react";
import { Award } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { SwitchRow } from "@/pages/user/profile/SwitchRow";

// Ehrungen aus der Mitgliederakte (#848): alle eigenen Ehrungen mit dem Hinweis, welche der Verein veröffentlichen
// lässt; aufs öffentliche Profil kommen sie nur mit dem eigenen Schalter. Dieselbe Karte zeigt das öffentliche Profil.

export function honourDay(day) {
  return day ? day.split("-").reverse().join(".") : "";
}

export function HonourCard({ honour, showReach = false }) {
  return (
    <li className="relative overflow-hidden border border-[#FFD700]/35 rounded-sm bg-gradient-to-br from-[#FFD700]/10 via-[#121212] to-[#121212] p-4" data-testid="honour-card">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-10 h-10 rounded-full border border-[#FFD700]/60 bg-[#FFD700]/10 grid place-items-center text-[#FFD700]" aria-hidden="true">
          <Award className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FFD700]">{honour.kind_label || "Ehrung"}</div>
          <div className="font-heading text-lg font-black leading-tight text-white">{honour.title}</div>
          {honour.label ? <div className="text-sm text-white/65 mt-0.5">{honour.label}</div> : null}
          <div className="text-xs text-white/45 mt-1">
            {honour.given_on ? `Verliehen am ${honourDay(honour.given_on)}` : null}
            {honour.years ? ` · ${honour.years} Jahre im Verein` : null}
          </div>
          {showReach ? (
            <div className={`text-[11px] mt-2 ${honour.publishable ? "text-[#00FF88]" : "text-white/40"}`}>
              {honour.publishable ? "Darf aufs Profil – mit deinem Schalter oben" : "Nur für dich – der Verein gibt sie nicht frei"}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function HonoursPanel() {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/me/honours");
      setView(data);
    } catch (err) {
      setView({ available: false, text: formatApiError(err.response?.data?.detail) || "Ehrungen sind gerade nicht lesbar.", honours: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (on) => {
    setBusy(true);
    try {
      const { data } = await api.put("/me/honours/public", { on });
      setView(data);
      toast.success(on ? "Deine Ehrungen stehen jetzt auf deinem Profil." : "Deine Ehrungen sind nicht mehr öffentlich.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Nicht gespeichert.");
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <div className="text-sm text-white/45" data-testid="honours-loading">Lade Ehrungen …</div>;
  const honours = view.honours || [];
  return (
    <section className="space-y-4" data-testid="honours-panel">
      <div>
        <h2 className="font-heading text-xl font-black uppercase">Meine Ehrungen</h2>
        <p className="text-sm text-white/55 mt-1">Ehrenmitgliedschaft, Verdienstnadel, Jubiläum – was der Vorstand in deiner Mitgliederakte als Ehrung einträgt.</p>
      </div>
      {!view.available ? (
        <p className="text-sm text-white/60 border border-white/10 rounded-sm p-4" data-testid="honours-reason">{view.text}</p>
      ) : (
        <>
          <SwitchRow
            label="Ehrungen auf meinem öffentlichen Profil zeigen"
            description="Nur Ehrungen, die der Verein veröffentlichen lässt. Aus heißt: Sie stehen nur hier."
            hint={view.public ? `Gerade öffentlich: ${view.shown || 0}` : ""}
            checked={!!view.public}
            onCheckedChange={toggle}
            disabled={busy}
            testId="honours-public"
          />
          {honours.length ? (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="honours-list">
              {honours.map((honour) => <HonourCard key={`${honour.kind}-${honour.given_on}-${honour.title}`} honour={honour} showReach />)}
            </ul>
          ) : (
            <p className="text-sm text-white/45" data-testid="honours-empty">In deiner Mitgliederakte steht noch keine Ehrung.</p>
          )}
        </>
      )}
    </section>
  );
}
