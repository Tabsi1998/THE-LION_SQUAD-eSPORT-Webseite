// Stand einer Staffel als Abzeichen (#2262): der Liga-Stand der Season (`StaffelStandBadge`), ohne Season-Angaben die Liga-Wörter
// („Vor dem Start“, „Spielbetrieb“ …) - nie der Turnier-Status „Entwurf“.
import { staffelStand } from "@/lib/seasonTabs";
import { StaffelStandBadge } from "@/pages/admin/tournament/StaffelParts";
import { staffelStandText } from "./staffelPage";

const TONE = {
  live: "bg-live/20 text-live border-live/50",
  cancelled: "bg-white/5 text-white/70 border-white/15",
};

export function StaffelStand({ tournament }) {
  if (staffelStand(tournament)) return <StaffelStandBadge tournament={tournament} />;
  const tone = TONE[tournament?.status] || "bg-white/10 text-white/80 border-white/20";
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-[3px] tls-type-small font-bold ${tone}`}>
      {/* Im Spielbetrieb derselbe Punkt wie das Abzeichen der Season - bei reduzierter Bewegung steht er still. */}
      {tournament?.status === "live" ? <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" data-testid="staffel-stand-dot" /> : null}
      {staffelStandText(tournament)}
    </span>
  );
}
