import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

function formatDateTime(value) {
  if (!value) return "Termin offen";
  return new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function participantLabel(slot, registrations) {
  const reg = registrations[slot.registration_id] || {};
  return reg.display_name || reg.ingame_name || reg.user?.display_name || slot.source?.raw || "Offen";
}

function legacyLabels(match, registrations) {
  const a = registrations[match.participant_a_id] || {};
  const b = registrations[match.participant_b_id] || {};
  return [
    a.display_name || a.ingame_name || "Offen",
    b.display_name || b.ingame_name || "Offen",
  ];
}

export default function TournamentSchedulePage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const { data: tournament } = await api.get(`/tournaments/${slug}`);
    const { data: bracket } = await api.get(`/tournaments/${tournament.id}/bracket`);
    setData(bracket);
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "matches_v2"]);

  const groups = useMemo(() => {
    const registrations = Object.fromEntries((data?.registrations || []).map((r) => [r.id, r]));
    const v2Rows = (data?.matches_v2 || []).map((match) => ({
      ...match,
      engine: "v2",
      matchday: match.matchday_number || match.round || 0,
      matchdayLabel: match.matchday_label || (match.round ? `Spieltag ${match.round}` : "Ohne Spieltag"),
      labels: (match.slots || []).map((slot) => participantLabel(slot, registrations)),
    }));
    const legacyRows = (data?.matches || []).map((match) => ({
      ...match,
      engine: "legacy",
      matchday: match.round || 0,
      matchdayLabel: match.round_name || (match.round ? `Runde ${match.round}` : "Ohne Runde"),
      labels: legacyLabels(match, registrations),
    }));
    const rows = [...v2Rows, ...legacyRows];
    const byDay = new Map();
    rows.forEach((match) => {
      const key = `${match.matchday}:${match.matchdayLabel}`;
      if (!byDay.has(key)) byDay.set(key, { key, label: match.matchdayLabel, matches: [] });
      byDay.get(key).matches.push(match);
    });
    return [...byDay.values()].sort((a, b) => Number(a.key.split(":")[0]) - Number(b.key.split(":")[0]));
  }, [data]);

  const tournament = data?.tournament || {};
  useDocumentTitle(`${tournament.title || "Turnier"} Spielplan`, "Spielplan und Matchtage.");

  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE SPIELPLAN …</div></PublicLayout>;

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to={`/tournaments/${tournament.slug || tournament.id}`} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zurück zum Turnier</Link>
        <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Spielplan</h1>
        <p className="mt-3 text-white/60 max-w-2xl">Alle Matchtage, Termine und öffentlichen Matchseiten für Terminabstimmung, Chat und Ergebnisstatus.</p>

        <div className="mt-10 space-y-8">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="font-heading text-2xl font-black uppercase flex items-center gap-2"><CalendarClock className="w-5 h-5 text-[#29B6E8]" /> {group.label}</h2>
              <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.matches.map((match) => (
                  <Link key={match.id} to={`/matches/${match.id}`} className="border border-white/10 hover:border-[#29B6E8]/50 bg-[#121212] rounded-sm p-4 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/40">{match.match_key}</div>
                        <div className="mt-1 font-heading font-bold uppercase line-clamp-2">{match.labels.join(" vs. ")}</div>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-[#FFD700] font-bold">{match.schedule_status || match.status}</span>
                    </div>
                    <div className="mt-3 text-sm text-white/55">{formatDateTime(match.scheduled_at)}</div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">Noch kein Spielplan generiert.</div>}
        </div>
      </section>
    </PublicLayout>
  );
}
