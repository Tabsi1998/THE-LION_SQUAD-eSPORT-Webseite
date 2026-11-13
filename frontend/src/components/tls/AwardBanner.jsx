import { Link } from "react-router-dom";
import { Medal, Trophy, Users } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { asInstant, viennaDate } from "@/lib/vienna";
import { RewardArt } from "@/components/tls/rewards/RewardArt";

/** Nur der Tag im Vereins-Kalender – die Uhrzeit des Turnierstarts gehört nicht aufs Banner. */
export function awardDay(value) {
  if (!value) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaDate(date, { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Vienna" });
}

// Auszeichnungen (#230): das Banner entsteht aus den Daten – Platz, Bilanz, Turnier, Spiel, Saison.
// Für Platz 1–3 kann der Verein je Turnier ein gestaltetes Bild hochladen; dann liegt es hinter
// dem Text. Dieselbe Karte im Profilkopf (groß) und in der Liste (klein).

const TONES = {
  1: { border: "border-[#FFD700]/60", text: "text-[#FFD700]", glow: "from-[#FFD700]/25", label: "Gold" },
  2: { border: "border-[#C0C0C0]/60", text: "text-[#E6E6E6]", glow: "from-[#C0C0C0]/20", label: "Silber" },
  3: { border: "border-[#CD7F32]/60", text: "text-[#E0A06A]", glow: "from-[#CD7F32]/20", label: "Bronze" },
};
const DEFAULT_TONE = { border: "border-[#29B6E8]/35", text: "text-[#29B6E8]", glow: "from-[#29B6E8]/15", label: "" };

export function awardTone(award) {
  return TONES[Number(award?.rank)] || DEFAULT_TONE;
}

const METAL_TONES = { gold: TONES[1], silver: TONES[2], bronze: TONES[3] };

/** Was auf dem Banner steht – auch für Tests und die App gleich formuliert. Eine Liga-Belohnung (F.4) nennt Liga, Season und Liga N. */
export function awardLines(award) {
  if (award?.reward) {
    const art = award.reward.art || {};
    return [art.league, art.season, art.division, award.league?.staffel ? `Staffel ${award.league.staffel}` : ""].filter(Boolean);
  }
  const parts = [];
  if (award?.game?.name) parts.push(award.game.name);
  if (award?.date) parts.push(awardDay(award.date));
  if (award?.participants) parts.push(`${award.participants} Teilnehmer`);
  if (award?.season?.name) parts.push(award.season.name);
  return parts;
}

export function AwardBanner({ award, size = "md", action = null, linkTo = null }) {
  if (!award) return null;
  const reward = award.reward || null;
  // Belohnung (F.4, #2214): Farbe aus der Vorlage, die Grafik statt Pokal - das eigene Bild steckt dann in der Grafik.
  const tone = reward ? METAL_TONES[reward.art?.metal] || DEFAULT_TONE : awardTone(award);
  const isTrophy = award.kind === "trophy";
  const hero = size === "hero";
  const image = award.image_url && !reward ? resolveMediaUrl(award.image_url) : "";
  const body = (
    <div
      data-testid={`award-${award.id}`}
      className={`relative overflow-hidden rounded-sm border bg-[#121212] ${tone.border} ${hero ? "p-5 md:p-6" : "p-4"}`}
    >
      {image && <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" />}
      <div className={`absolute inset-0 bg-gradient-to-r ${tone.glow} via-transparent to-transparent pointer-events-none`} />
      <div className="relative flex items-center gap-4 min-w-0">
        {reward ? (
          <RewardArt reward={reward} size="sm" labelled={false} />
        ) : (
          <div className={`shrink-0 rounded-sm border ${tone.border} bg-black/40 flex items-center justify-center ${hero ? "w-16 h-16" : "w-12 h-12"}`}>
            {isTrophy ? <Trophy className={`${hero ? "w-8 h-8" : "w-6 h-6"} ${tone.text}`} /> : <Medal className={`${hero ? "w-8 h-8" : "w-6 h-6"} ${tone.text}`} />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-black uppercase tracking-widest ${tone.text}`} data-testid={`award-rank-${award.id}`}>{award.rank_label}</span>
            {reward ? <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 rounded-sm ${tone.border} ${tone.text}`}>{reward.kind_label}</span>
              : tone.label && <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 rounded-sm ${tone.border} ${tone.text}`}>{tone.label}</span>}
            {award.team?.name && <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 inline-flex items-center gap-1"><Users className="w-3 h-3" /> {award.team.name}</span>}
          </div>
          <div className={`font-heading font-black uppercase break-words ${hero ? "text-2xl md:text-3xl" : "text-base"}`}>{reward ? reward.name : award.tournament?.title || "Turnier"}</div>
          <div className="text-xs text-white/60 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {awardLines(award).map((line) => <span key={line}>{line}</span>)}
          </div>
          {award.record && <div className={`mt-1 font-display tabular-nums ${tone.text} ${hero ? "text-lg" : "text-sm"}`} data-testid={`award-record-${award.id}`}>{award.record}</div>}
        </div>
        {action && <div className="shrink-0 self-start">{action}</div>}
      </div>
    </div>
  );
  if (linkTo) return <Link to={linkTo} className="block">{body}</Link>;
  return body;
}
