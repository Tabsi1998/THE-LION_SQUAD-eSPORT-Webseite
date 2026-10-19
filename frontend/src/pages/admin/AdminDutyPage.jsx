// „Mein Dienst“ (#1352): der Eingang für Helfer und Moderation - statt „Kein Zugriff“. Oben die Moderation (nur mit dem
// Bereich), darunter die eigenen Turniere und Fast Laps, heute zuerst, je mit der eigenen Rolle; für die Turnierleitung
// zusätzlich alles, was heute läuft. Die Daten kommen aus dem Server-Dienst „deine Aufgaben“ (`/users/me/duty`), den
// später auch die Startseite je Rolle (#1286) und „Dein Dienst“ auf Home (#1175) nutzen. Captains externer Serien
// (#1749) sehen darunter „Meine Serien“.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { DutyList, ModerationDuty } from "@/pages/admin/duty/DutyList";
import { SeriesDutyList } from "@/pages/admin/duty/SeriesDutyList";
import { useAuth } from "@/context/AuthContext";
import { mfaSetupPath, needsSecondFactor } from "@/lib/permissions";
import { Link } from "react-router-dom";

export default function AdminDutyPage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const { user } = useAuth();
  const load = useCallback(() => {
    api.get("/users/me/duty")
      .then(({ data: next }) => { setData(next); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 60000 });

  const assignments = data?.assignments || [];
  const leadToday = data?.lead_today || [];
  const series = data?.series || [];
  const nothing = data && !data.moderation && assignments.length === 0 && leadToday.length === 0 && series.length === 0;

  return (
    <AdminLayout>
      <div className="mb-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Deine Arbeit</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1" data-testid="duty-heading">Mein Dienst</h1>
      </div>

      {failed && !data && (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-white/70" data-testid="duty-error">
          Dein Dienst konnte nicht geladen werden. Versuch es gleich noch einmal.
        </p>
      )}
      {!data && !failed && <p className="text-sm text-white/45" data-testid="duty-loading">Lade deinen Dienst …</p>}

      {data?.moderation && (
        <section className="mb-8" aria-labelledby="duty-moderation-heading">
          <h2 id="duty-moderation-heading" className="sr-only">Moderation</h2>
          <ModerationDuty moderation={data.moderation} />
        </section>
      )}

      {data && (assignments.length > 0 || (!data.moderation && series.length === 0)) && (
        <section className="mb-8" aria-labelledby="duty-assignments-heading">
          <h2 id="duty-assignments-heading" className="font-heading font-bold uppercase text-lg mb-3">Deine Einsätze</h2>
          {assignments.length > 0 ? (
            <DutyList rows={assignments} testId="duty-assignments" />
          ) : (
            <p className="text-sm text-white/50" data-testid="duty-empty">
              {nothing ? "Gerade hast du keinen Einsatz. Sobald dich die Turnierleitung einträgt, steht er hier." : "Gerade hast du keinen eigenen Einsatz."}
            </p>
          )}
        </section>
      )}

      {series.length > 0 && (
        <section className="mb-8" aria-labelledby="duty-series-heading">
          <h2 id="duty-series-heading" className="font-heading font-bold uppercase text-lg mb-3">Meine Serien</h2>
          {needsSecondFactor(user) && (
            <p className="mb-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-white/70" data-testid="duty-series-mfa">
              Captains brauchen die Zwei-Faktor-Anmeldung. <Link to={mfaSetupPath("/admin/dienst")} className="underline hover:text-white">Jetzt einrichten</Link>
            </p>
          )}
          <SeriesDutyList rows={series} />
        </section>
      )}

      {leadToday.length > 0 && (
        <section aria-labelledby="duty-today-heading">
          <h2 id="duty-today-heading" className="font-heading font-bold uppercase text-lg mb-3">Heute in allen Turnieren</h2>
          <DutyList rows={leadToday} testId="duty-lead-today" />
        </section>
      )}
    </AdminLayout>
  );
}
