import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Lock, Share2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Badge } from "@/components/achievements/Badge";
import { formatPercent } from "@/components/tls/AchievementGroups";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { shareAchievement } from "@/lib/shareAchievement";

// Die Teilen-Seite eines Erfolgs (#619): /achievements/a/<award_id>. Zeigt die serverseitig gezeichnete
// Karte (dieselbe, die Discord als Vorschau bekommt), die Person und die Seltenheit - mit Teilen,
// Bild speichern und dem Weg zum Profil. Nur öffentliche Vergaben; sonst „nicht öffentlich“.
export default function AchievementSharePage() {
  const { awardId } = useParams();
  const [card, setCard] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    api.get(`/achievements/award/${encodeURIComponent(awardId)}`)
      .then(({ data }) => { if (alive) { setCard(data); setState("ready"); } })
      .catch((err) => { if (alive) setState(err?.response?.status === 404 ? "private" : "error"); });
    return () => { alive = false; };
  }, [awardId]);

  const imageUrl = card ? resolveMediaUrl(card.image_path) : "";
  const person = card?.user?.display_name || "Spieler";
  useDocumentTitle(
    card ? `${card.name} · ${card.material_name} · ${person}` : "Achievement",
    card ? `${person} hat ${card.name} (${card.material_name}) freigeschaltet.` : "Ein geteilter Erfolg bei THE LION SQUAD eSports.",
    card ? { image: imageUrl, type: "article", robots: "noindex, follow", canonical: `${window.location.origin}${card.path}` } : { robots: "noindex, follow" },
  );

  const share = async () => {
    const result = await shareAchievement({ awardId, name: card.name, materialName: card.material_name, personName: person, clubName: card.club_name });
    if (result.status === "copied") toast.success("Link kopiert.");
    else if (result.status === "failed") toast.error("Teilen geht in diesem Browser nicht – kopiere die Adresse aus der Leiste.");
  };

  const color = card?.material_color || "#FFD700";
  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-10 md:py-14">
        <Link to="/achievements" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white" data-testid="share-back">
          <ArrowLeft className="w-3 h-3" /> Alle Achievements
        </Link>

        {state === "loading" && <div className="py-20 text-center font-display tracking-widest text-white/40" data-testid="share-loading">LADE ACHIEVEMENT …</div>}

        {(state === "private" || state === "error") && (
          <div className="mt-6 border border-dashed border-white/15 rounded-sm px-6 py-16 text-center" data-testid="share-private">
            <Lock className="w-8 h-8 mx-auto mb-3 text-white/25" />
            <h1 className="font-heading text-2xl font-bold uppercase text-white/80">{state === "private" ? "Dieser Erfolg ist nicht öffentlich" : "Achievement gerade nicht erreichbar"}</h1>
            <p className="mt-2 text-sm text-white/45 max-w-md mx-auto">
              {state === "private"
                ? "Entweder gibt es ihn nicht, oder die Person zeigt ihre Erfolge nicht öffentlich."
                : "Bitte versuch es gleich noch einmal."}
            </p>
            <Link to="/achievements" className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-[#29B6E8]/10">
              <Trophy className="w-3.5 h-3.5" /> Zum Schaukasten
            </Link>
          </div>
        )}

        {state === "ready" && card && (
          <motion.article
            className="mt-6 border rounded-sm bg-[#0A0A0A] overflow-hidden"
            style={{ borderColor: `${color}55`, boxShadow: `0 0 0 1px ${color}14, 0 0 48px ${color}12` }}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            data-testid="share-card"
          >
            <img src={imageUrl} alt={`${card.name} – ${card.material_name} – ${person}`} width={1200} height={630} className="w-full h-auto block bg-[#0A0A0A]" data-testid="share-image" />
            <div className="p-5 md:p-6 grid md:grid-cols-[minmax(0,1fr)_auto] gap-5 items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color }}>
                  <Badge material={card.material} rank={card.rank} art={card.art} icon={card.icon} size="sm" title={card.name} /> {card.group_name}
                </div>
                <h1 className="mt-1 font-heading text-2xl md:text-4xl font-black uppercase leading-none" data-testid="share-name">{card.name}</h1>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-white/60">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border" style={{ color, borderColor: `${color}66`, backgroundColor: `${color}12` }}>{card.material_name}</span>
                  <span className="tabular-nums">+{card.points} Punkte</span>
                  {Number(card.holders || 0) > 0 && <span className="tabular-nums" data-testid="share-rarity">{formatPercent(card.percent)} haben das</span>}
                </div>
                {card.description && <p className="mt-3 text-sm text-white/65">{card.description}</p>}
                <Link to={card.user?.username ? `/u/${card.user.username}` : "/players"} className="mt-4 inline-flex items-center gap-2 text-sm hover:text-[#29B6E8]" data-testid="share-person">
                  {card.user?.avatar_url ? (
                    <img src={resolveMediaUrl(card.user.avatar_url)} alt="" className="w-7 h-7 rounded-sm object-cover border border-white/15" />
                  ) : (
                    <span className="w-7 h-7 rounded-sm border border-white/15 bg-white/5 flex items-center justify-center font-bold text-white/60 text-xs">{person.trim().charAt(0).toUpperCase()}</span>
                  )}
                  <span className="font-semibold">{person}</span>
                  {card.earned_at && <span className="text-white/35 text-xs">{new Date(card.earned_at).toLocaleDateString("de-DE")}</span>}
                </Link>
              </div>
              <div className="flex md:flex-col gap-2 shrink-0">
                <button type="button" onClick={share} className="inline-flex items-center justify-center gap-2 px-4 py-2 border text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-white/5" style={{ borderColor: `${color}80`, color }} data-testid="share-button">
                  <Share2 className="w-3.5 h-3.5" /> Teilen
                </button>
                <a href={imageUrl} download={`achievement-${awardId}.png`} className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-white/15 text-white/70 text-xs font-bold uppercase tracking-widest rounded-sm hover:border-white/40 hover:text-white" data-testid="share-download">
                  <Download className="w-3.5 h-3.5" /> Bild speichern
                </a>
              </div>
            </div>
          </motion.article>
        )}
      </div>
    </PublicLayout>
  );
}
