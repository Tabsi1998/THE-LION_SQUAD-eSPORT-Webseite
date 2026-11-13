import { useMemo } from "react";
import { Gift } from "lucide-react";
import { Podium } from "@/components/tls/podium/Podium";
import { motionAllowed } from "@/lib/motion";
import { everyoneLine, metalOf, rewardsByPlace } from "@/lib/leagueRewards";
import { RewardArt } from "./RewardArt";
import "./rewards.css";

// Belohnungen einer Staffel auf der Ligaseite (F.4, #2214). Vor dem Abschluss: „Darum wird gespielt“ - je Belohnung Grafik, Name und
// für wen. Nach dem Abschluss (Nr. 165): das Podest aus dem Endstand, darunter je Platz 1 bis 3 die Belohnungen, dazu Bereiche und
// „alle Teilnehmer“ mit ihren Inhabern. Gibt es keine Belohnungen, zeigt der Baustein nichts.

function artFor(item, rank) {
  const metal = item.places?.mode === "range" && [1, 2, 3].includes(rank) ? { 1: "gold", 2: "silver", 3: "bronze" }[rank] : metalOf(item.places);
  return { ...item, art: { place: item.place_label, metal } };
}

export function StaffelRewards({ data, staffel }) {
  const rewards = data?.staffel?.rewards || null;
  const rows = useMemo(() => (Array.isArray(data?.standings) ? data.standings.filter((row) => !row.exit) : []), [data]);
  const registrations = useMemo(() => (data?.teams || []).map((team) => ({ id: team.id, team: { logo_url: team.logo_url } })), [data]);
  if (!rewards?.items?.length) return null;
  const play = motionAllowed() ? "run" : undefined;
  const testId = `league-rewards-${staffel.staffel}`;
  if (!rewards.granted) {
    return (
      <section className="tls-staffel-rewards" aria-labelledby={`${testId}-head`} data-testid={testId} data-granted="false">
        <h3 id={`${testId}-head`} className="tls-league-subhead"><Gift className="h-4 w-4" aria-hidden="true" /> Darum wird gespielt</h3>
        <ul className="tls-staffel-rewards__list">
          {rewards.items.map((item, index) => (
            <li key={item.id} className="tls-staffel-rewards__row" data-testid={`${testId}-planned-${item.id}`}>
              <RewardArt reward={artFor(item)} size="sm" index={index} labelled={false} />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-white [overflow-wrap:anywhere]">{item.name}</span>
                <span className="block text-xs text-white/60">{item.place_label} · {item.kind_label} · {item.recipients_label}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const { places, others } = rewardsByPlace(rewards.items);
  const everyone = everyoneLine(rewards.items);
  return (
    <section className="tls-staffel-rewards" aria-labelledby={`${testId}-head`} data-testid={testId} data-granted="true">
      <h3 id={`${testId}-head`} className="tls-league-subhead"><Gift className="h-4 w-4" aria-hidden="true" /> Podest und Belohnungen</h3>
      <Podium rows={rows} registrations={registrations} />
      <div className="tls-staffel-rewards__places" aria-label="Belohnungen je Platz">
        {[1, 2, 3].map((rank) => (
          <div key={rank} className="tls-staffel-rewards__place" data-place={rank} data-testid={`${testId}-place-${rank}`}>
            <div className="tls-staffel-rewards__arts">
              {places[rank].map((item, index) => (
                <RewardArt key={item.id} reward={artFor(item, rank)} size="sm" play={play} index={index + (3 - rank)} testId={`${testId}-art-${item.id}`} />
              ))}
            </div>
            {places[rank].map((item) => <span key={item.id} className="tls-staffel-rewards__name">{item.name}</span>)}
          </div>
        ))}
      </div>
      {others.length ? (
        <ul className="tls-staffel-rewards__list">
          {others.map((item, index) => (
            <li key={item.id} className="tls-staffel-rewards__row" data-testid={`${testId}-other-${item.id}`}>
              <RewardArt reward={artFor(item)} size="sm" play={play} index={index + 3} labelled={false} />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-white [overflow-wrap:anywhere]">{item.name} <span className="font-normal text-white/55">· {item.place_label}</span></span>
                <span className="block text-xs text-white/60 [overflow-wrap:anywhere]">{(item.holders || []).map((row) => row.display_name).join(", ") || "Niemand"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {everyone ? <p className="text-xs text-white/60" data-testid={`${testId}-everyone`}>{everyone}</p> : null}
    </section>
  );
}
