import { Link } from "react-router-dom";
import { motionAllowed } from "@/lib/motion";
import { groupBySeason } from "@/lib/leagueRewards";
import { RewardArt } from "./RewardArt";
import "./rewards.css";

// Sammlung der Belohnungen (F.4, #2214) an Profil und Team: je Season eine Gruppe, die neueste oben, darin Platz 1 zuerst. Wer die
// Sammlung besitzt (eigenes Profil, Teamleitung), wählt, was gezeigt wird: das Banner oben und einen Titel neben dem Namen.

const META = (award) => [award.reward?.art?.place || award.rank_label, award.league?.division_label, award.league?.staffel ? `Staffel ${award.league.staffel}` : ""]
  .filter(Boolean).join(" · ");

export function RewardChip({ award, testId = "featured-title" }) {
  if (!award?.reward) return null;
  return (
    <span className="tls-reward-chip" data-testid={testId} data-metal={award.reward.art?.metal || "lion"} title={award.reward.name}>
      <RewardArt reward={award.reward} size="sm" labelled={false} />
      <span>{award.reward.name}</span>
    </span>
  );
}

export function RewardCollection({ awards, featuredId = null, titleId = null, onFeature = null, onTitle = null, testId = "reward-collection",
  linkFor = null, animate = true }) {
  const groups = groupBySeason(awards);
  if (!groups.length) return null;
  const play = animate && motionAllowed() ? "run" : undefined;
  return (
    <div className="tls-reward-collection" data-testid={testId}>
      {groups.map((group) => (
        <section key={group.key} aria-label={`Belohnungen ${group.season}`} data-testid={`${testId}-season`}>
          <div className="tls-reward-collection__head">
            <h3 className="font-heading text-lg font-black uppercase">{group.season}</h3>
            {group.league ? <span className="text-xs font-bold uppercase tracking-widest text-white/50">{group.league}</span> : null}
          </div>
          <ul className="tls-reward-collection__grid">
            {group.items.map((award, index) => {
              const art = award.reward.art || {};
              const featured = featuredId === award.id;
              const titled = titleId === award.id;
              const href = linkFor ? linkFor(award) : null;
              const body = (
                <>
                  <RewardArt reward={award.reward} size="md" play={play} index={index} testId={`reward-art-${award.id}`} />
                  <span className="tls-reward-card__kind">{award.reward.kind_label}</span>
                  <span className="tls-reward-card__name">{award.reward.name}</span>
                  <span className="tls-reward-card__meta">{META(award)}</span>
                  {award.team?.name ? <span className="tls-reward-card__meta">{award.team.name}</span> : null}
                </>
              );
              return (
                <li key={award.id} className="tls-reward-card" data-metal={art.metal || "lion"} data-featured={featured || titled ? "true" : undefined}
                  data-testid={`reward-card-${award.id}`}>
                  {href ? <Link to={href} className="contents">{body}</Link> : body}
                  {onFeature || onTitle ? (
                    <div className="tls-reward-card__actions">
                      {onFeature ? (
                        <button type="button" onClick={() => onFeature(featured ? null : award.id)} data-testid={`reward-feature-${award.id}`} aria-pressed={featured}
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 border rounded-sm ${featured ? "border-honor/60 text-honor" : "border-white/20 text-white/60 hover:text-white"}`}>
                          {featured ? "Banner ✓" : "Als Banner"}
                        </button>
                      ) : null}
                      {onTitle && award.reward.kind === "title" ? (
                        <button type="button" onClick={() => onTitle(titled ? null : award.id)} data-testid={`reward-title-${award.id}`} aria-pressed={titled}
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 border rounded-sm ${titled ? "border-[#29B6E8]/70 text-[#29B6E8]" : "border-white/20 text-white/60 hover:text-white"}`}>
                          {titled ? "Titel ✓" : "Als Titel"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
