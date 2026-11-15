import { RewardArt } from "./RewardArt";
import "./rewards.css";

// Titel neben dem Namen (F.4, #2214) an Profil und Team: eine gewählte Belohnung der Art „Titel“ als Pille mit kleiner Grafik. Die
// Sammlung je Season, die hier früher stand, ist seit #2425 die Vitrine im Reiter „Trophäen“ (TrophyCabinet).

export function RewardChip({ award, testId = "featured-title" }) {
  if (!award?.reward) return null;
  return (
    <span className="tls-reward-chip" data-testid={testId} data-metal={award.reward.art?.metal || "lion"} title={award.reward.name}>
      <RewardArt reward={award.reward} size="xs" labelled={false} />
      <span>{award.reward.name}</span>
    </span>
  );
}
