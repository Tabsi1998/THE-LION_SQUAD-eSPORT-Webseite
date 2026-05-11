import { useCallback, useEffect, useState } from "react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Award, ExternalLink, Medal, Trophy } from "lucide-react";

const medalClasses = {
  gold: "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700]",
  silver: "border-white/30 bg-white/10 text-white",
  bronze: "border-[#CD7F32]/40 bg-[#CD7F32]/10 text-[#CD7F32]",
};
const medalLabels = { gold: "Gold", silver: "Silber", bronze: "Bronze" };
const modeLabels = { online: "Online", offline: "Vor Ort", hybrid: "Hybrid" };

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function placementText(item) {
  if (item.placement_label) return item.placement_label;
  if (!item.placement) return "Teilnahme";
  return `Platz ${item.placement}${item.participant_count ? ` von ${item.participant_count}` : ""}`;
}

export default function ReferencesPage() {
  useDocumentTitle("Referenzen", "Externe Turniere, Ligen und Ergebnisse von THE LION SQUAD eSports.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});

  const load = useCallback(() => {
    api.get("/references").then(({ data }) => {
      setItems(data.items || []);
      setSummary(data.summary || {});
    }).catch(() => {
      setItems([]);
      setSummary({});
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references"]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">eSports</span>
        <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Referenzen</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Externe Turniere, Ligen und Events, bei denen THE LION SQUAD vertreten war. Ergebnisse, Brackets und Matchseiten sauber gesammelt.
        </p>

        <div className="mt-10 grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat label="Teilnahmen" value={summary.total || 0} icon={Trophy} />
          <Stat label="Podest" value={summary.podiums || 0} icon={Medal} />
          <Stat label="Gold" value={summary.gold || 0} tone="gold" />
          <Stat label="Silber" value={summary.silver || 0} />
          <Stat label="Bronze" value={summary.bronze || 0} tone="bronze" />
          <Stat label="Spiele" value={summary.games || 0} icon={Award} />
        </div>

        {items.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Medal className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Referenzen werden bald ergänzt.</div>
            <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
          </div>
        ) : (
          <div className="mt-12 space-y-4">
            {items.map((item) => <ReferenceCard key={item.id} item={item} />)}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const color = tone === "gold" ? "text-[#FFD700]" : tone === "bronze" ? "text-[#CD7F32]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
        {Icon && <Icon className={`w-4 h-4 ${color}`} />}
      </div>
      <div className={`mt-2 font-display text-3xl md:text-4xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function ReferenceCard({ item }) {
  return (
    <article className="grid lg:grid-cols-[12rem_minmax(0,1fr)_14rem] gap-4 border border-white/10 rounded-sm bg-[#111] p-4 md:p-5">
      <div className="flex lg:flex-col items-center lg:items-start gap-3">
        <div className="w-16 h-16 rounded-sm bg-[#070707] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
          {item.game?.logo_url ? (
            <img src={resolveMediaUrl(item.game.logo_url)} alt="" className="w-full h-full object-contain p-2" />
          ) : (
            <Trophy className="w-7 h-7 text-[#29B6E8]" />
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{item.game_name || item.game?.name || "Extern"}</div>
          <div className="mt-1 text-xs text-white/45">{formatDate(item.start_date)}</div>
          {item.mode && <div className="mt-1 text-xs text-white/35 uppercase">{modeLabels[item.mode] || item.mode}</div>}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {item.medal && <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-widest font-bold ${medalClasses[item.medal] || medalClasses.gold}`}><Medal className="w-3 h-3" /> {medalLabels[item.medal] || item.medal}</span>}
          {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{item.organizer}</span>}
        </div>
        <h2 className="mt-2 font-heading text-2xl md:text-3xl font-black uppercase leading-tight break-words">{item.title}</h2>
        <p className="mt-2 text-white/65">
          {item.team_name || "THE LION SQUAD"} · {placementText(item)}
          {item.location ? ` · ${item.location}` : ""}
        </p>
        {item.lineup?.length > 0 && <div className="mt-3 text-sm text-white/50">Lineup: {item.lineup.join(", ")}</div>}
        {item.description && <p className="mt-3 text-sm text-white/60 leading-relaxed">{item.description}</p>}
        {item.highlights && <p className="mt-2 text-sm text-[#FFD700]/75 leading-relaxed">{item.highlights}</p>}
      </div>
      <div className="flex lg:flex-col gap-2 flex-wrap lg:items-stretch">
        <RefButton href={item.external_url} label="Turnier" />
        <RefButton href={item.bracket_url} label="Bracket" />
        <RefButton href={item.match_url} label="Matchseite" />
        <RefButton href={item.result_url} label="Ergebnis" />
      </div>
    </article>
  );
}

function RefButton({ href, label }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm text-xs uppercase tracking-wider font-bold text-white/70 hover:text-[#29B6E8]">
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
