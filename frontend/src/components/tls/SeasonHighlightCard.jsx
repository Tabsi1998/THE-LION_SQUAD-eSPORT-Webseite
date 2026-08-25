import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Download, Share2, X, Trophy, Medal, Zap, Flag } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { LevelAvatarFrame, CROWN_LABELS } from "@/components/tls/LevelAvatarFrame";
import { accountLevelTier } from "@/components/tls/AccountLevel";

function topAwards(awards, limit = 3) {
  return [...(awards || [])]
    .filter((a) => !a.is_negative)
    .sort((a, b) => (b.level || 0) - (a.level || 0) || (b.points || 0) - (a.points || 0))
    .slice(0, limit);
}

export function SeasonHighlightCard({ profile, level, stats, awards, crown, seasonLabel, onClose }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const tier = accountLevelTier(level?.level);
  const best = topAwards(awards);
  const season = seasonLabel || `Season ${new Date().getFullYear()}`;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderPng = useCallback(async () => {
    return toPng(cardRef.current, { pixelRatio: 2.4, backgroundColor: "#050505", cacheBust: true });
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const dataUrl = await renderPng();
      const link = document.createElement("a");
      link.download = `tls-highlight-${profile.username || "spieler"}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Highlight-Karte gespeichert.");
    } catch {
      toast.error("Karte konnte nicht erzeugt werden.");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const dataUrl = await renderPng();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `tls-highlight-${profile.username || "spieler"}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${profile.display_name || profile.username} · THE LION SQUAD` });
      } else if (navigator.share) {
        await navigator.share({ title: `${profile.display_name || profile.username} · THE LION SQUAD`, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Profil-Link kopiert — Karte wurde zusätzlich heruntergeladen.");
        const link = document.createElement("a");
        link.download = file.name;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast.error("Teilen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" role="dialog" aria-modal="true" aria-label="Season-Highlight-Karte" data-testid="highlight-card-modal" onClick={onClose}>
      <div className="my-auto" onClick={(e) => e.stopPropagation()}>
        <div
          ref={cardRef}
          className="w-[min(380px,calc(100vw-2rem))] rounded-md border border-white/12 bg-gradient-to-b from-[#0D141A] via-[#0A0A0A] to-[#050505] p-6 relative overflow-hidden"
          data-testid="highlight-card"
        >
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-[70px] opacity-25" style={{ backgroundColor: tier.color }} />
          <div className="absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-[#29B6E8] blur-[80px] opacity-15" />

          <div className="relative flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">The Lion Squad</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{season}</span>
          </div>

          <div className="relative mt-8 flex flex-col items-center">
            <LevelAvatarFrame level={level?.level} crown={crown} className="w-32 h-32" showBadge>
              {profile.avatar_url ? (
                <img src={resolveMediaUrl(profile.avatar_url)} alt="" crossOrigin="anonymous" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center font-display font-black text-4xl text-[#29B6E8]">
                  {(profile.display_name || profile.username || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
            </LevelAvatarFrame>
            <h2 className="mt-7 font-heading text-2xl font-black uppercase text-center leading-tight">{profile.display_name || profile.username}</h2>
            <div className="text-xs text-white/45">@{profile.username}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-sm text-[10px] font-bold uppercase tracking-widest" style={{ color: tier.color, borderColor: `${tier.color}66`, backgroundColor: `${tier.color}12` }}>
              <Zap className="w-3 h-3" /> Level {level?.level || 1} · {tier.title}
            </div>
            {crown && <div className="mt-1.5 text-[10px] uppercase tracking-widest font-bold text-white/50">{CROWN_LABELS[crown]}</div>}
          </div>

          <div className="relative mt-6 grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Punkte", value: level?.points ?? 0, icon: Zap, color: "#29B6E8" },
              { label: "Siege", value: stats?.wins ?? 0, icon: Trophy, color: "#FFD700" },
              { label: "Podium", value: stats?.top3 ?? 0, icon: Medal, color: "#C0C0C0" },
              { label: "Fast Laps", value: stats?.fastlaps ?? stats?.fast_laps ?? 0, icon: Flag, color: "#00FF88" },
            ].map((s) => (
              <div key={s.label} className="border border-white/10 rounded-sm bg-white/[0.03] px-1 py-2.5">
                <s.icon className="w-3.5 h-3.5 mx-auto" style={{ color: s.color }} />
                <div className="mt-1 font-display font-bold text-lg tabular-nums" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[8px] uppercase tracking-widest text-white/40 font-bold">{s.label}</div>
              </div>
            ))}
          </div>

          {best.length > 0 && (
            <div className="relative mt-5">
              <div className="text-[9px] uppercase tracking-[0.25em] text-white/40 font-bold mb-2">Top-Erfolge</div>
              <div className="space-y-1.5">
                {best.map((a) => (
                  <div key={a.id || a.code} className="flex items-center gap-2.5 border border-white/8 rounded-sm bg-white/[0.03] px-2.5 py-1.5" style={{ boxShadow: `inset 2px 0 0 ${a.level_color || "#29B6E8"}` }}>
                    <Medal className="w-3.5 h-3.5 shrink-0" style={{ color: a.level_color || "#29B6E8" }} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-white truncate">{a.name}</div>
                      <div className="text-[8px] uppercase tracking-widest font-bold" style={{ color: a.level_color || "#29B6E8" }}>{a.level_name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="relative mt-5 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.25em] text-white/35 font-bold">lionsquad · esports</span>
            <span className="text-[9px] text-white/30">{new Date().toLocaleDateString("de-DE")}</span>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={download} disabled={busy} data-testid="highlight-card-download" className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#1E95C2] disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> PNG speichern
          </button>
          <button type="button" onClick={share} disabled={busy} data-testid="highlight-card-share" className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-white/20 text-white rounded-sm text-xs uppercase tracking-wider font-bold hover:border-[#29B6E8]/60 disabled:opacity-50">
            <Share2 className="w-3.5 h-3.5" /> Teilen
          </button>
          <button type="button" onClick={onClose} data-testid="highlight-card-close" className="inline-flex items-center justify-center px-3 py-2.5 border border-white/15 text-white/60 rounded-sm hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
