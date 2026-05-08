import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { BracketTree } from "@/components/tls/BracketTree";
import { MascotBadge } from "@/components/tls/Logo";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { QRCodeSVG } from "qrcode.react";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";

export default function BracketTVPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [viewIndex, setViewIndex] = useState(0);

  const load = useCallback(async () => {
    const { data: br } = await api.get(`/tournaments/${id}/bracket`);
    setData(br);
  }, [id]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  const views = useMemo(() => buildTvViews(data), [data]);
  useEffect(() => {
    setViewIndex(0);
  }, [data?.tournament?.id, views.length]);
  useEffect(() => {
    if (views.length <= 1) return undefined;
    const iv = setInterval(() => setViewIndex((current) => (current + 1) % views.length), 9000);
    return () => clearInterval(iv);
  }, [views.length]);

  if (!data) return <div className="h-screen bg-black flex items-center justify-center font-display tracking-widest text-white/40">LADE TURNIERBAUM …</div>;
  const t = data.tournament;
  const publicUrl = `${window.location.origin}/tournaments/${t.slug || t.id}/bracket`;
  const activeView = views[viewIndex % Math.max(views.length, 1)] || { title: "Turnierbaum", data };
  const hasMatches = (data.matches?.length || 0) + (data.matches_v2?.length || 0) > 0;

  return (
    <div className="h-screen tv-bg text-white flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-6 px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <MascotBadge className="w-12 h-12" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">THE LION SQUAD · LIVE</div>
            <h1 className="font-heading text-2xl md:text-4xl font-black uppercase truncate">{t.title}</h1>
            {hasMatches && <div className="mt-1 text-xs uppercase tracking-[0.25em] text-white/50 truncate">{activeView.title}</div>}
          </div>
        </div>
        <StatusBadge status={t.status} size="lg" />
      </header>
      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {!hasMatches ? (
          <div className="h-full border border-white/10 bg-[#0A0A0A]/75 rounded-sm flex items-center justify-center text-white/45 font-display uppercase tracking-[0.25em]">
            Turnierbaum wurde noch nicht generiert
          </div>
        ) : (
          <BracketTree data={activeView.data} compact viewMode="tv" />
        )}
      </div>
      <footer className="shrink-0 px-8 py-3 border-t border-white/10 flex items-center justify-between gap-4 bg-[#0A0A0A]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={50} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Jetzt mitfiebern</div>
            <div className="text-sm text-white/80 truncate font-mono">{publicUrl.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        {views.length > 1 && (
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            {views.map((view, index) => (
              <button
                key={view.key}
                type="button"
                aria-label={`Ansicht ${index + 1}`}
                onClick={() => setViewIndex(index)}
                className={`h-1.5 rounded-full transition-all ${index === viewIndex ? "w-8 bg-[#29B6E8]" : "w-3 bg-white/20"}`}
              />
            ))}
          </div>
        )}
        <SponsorGrid max={4} />
      </footer>
    </div>
  );
}

function buildTvViews(data) {
  if (!data) return [];
  const base = {
    tournament: data.tournament,
    registrations: data.registrations || [],
  };
  const views = [];

  if ((data.matches_v2 || []).length > 0) {
    const stages = data.stages || [];
    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const groups = new Map();
    for (const match of data.matches_v2 || []) {
      const key = `${match.stage_id || "__default"}::${match.section || "MAIN"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    }
    for (const [key, matches] of groups) {
      const [stageId, section] = key.split("::");
      const stage = stageById.get(stageId);
      const viewStage = stage || { id: stageId, name: "Phase", number: 1 };
      for (const roundView of splitRoundViews(matches)) {
        views.push({
          key: `${key}-${roundView.key}`,
          title: [viewStage.name || "Phase", formatBracketSection(section), roundView.title].filter(Boolean).join(" · "),
          data: { ...base, stages: [viewStage], matches: [], matches_v2: roundView.matches },
        });
      }
    }
    return views;
  }

  const legacyGroups = new Map();
  for (const match of data.matches || []) {
    const bracket = match.bracket || "winner";
    if (!legacyGroups.has(bracket)) legacyGroups.set(bracket, []);
    legacyGroups.get(bracket).push(match);
  }
  for (const [bracket, matches] of legacyGroups) {
    for (const roundView of splitRoundViews(matches)) {
      views.push({
        key: `${bracket}-${roundView.key}`,
        title: [formatBracketSection(bracket), roundView.title].filter(Boolean).join(" · "),
        data: { ...base, stages: [], matches: roundView.matches, matches_v2: [] },
      });
    }
  }
  return views;
}

function splitRoundViews(matches) {
  const byRound = new Map();
  for (const match of matches || []) {
    const round = Number(match.round || 1);
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(match);
  }
  const views = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const list = byRound.get(round).sort((a, b) => (a.order ?? a.match_index ?? 0) - (b.order ?? b.match_index ?? 0));
    const hasMultiplayer = list.some((match) => match.match_type === "ffa" || (match.slots || []).length > 2);
    const size = hasMultiplayer ? 4 : 6;
    const pageCount = Math.max(1, Math.ceil(list.length / size));
    for (let index = 0; index < pageCount; index += 1) {
      const chunk = list.slice(index * size, (index + 1) * size);
      const suffix = pageCount > 1 ? ` · Teil ${index + 1}/${pageCount}` : "";
      views.push({
        key: `r${round}-${index}`,
        title: `${formatRoundName(chunk[0]?.round_name, round)}${suffix}`,
        matches: chunk,
      });
    }
  }
  return views;
}
