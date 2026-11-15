// Podest am TV (#2410, Folge von F.4 #2214): Beim Saisonabschluss einer Liga-Staffel zeigt der Sieger-Moment Platz 1 bis 3 mit den
// Belohnungen. Der Server liefert sie in `league_podium` (GET /bracket/display) - nur öffentliche, nicht ruhende, die Hauptbelohnung je
// Platz zuerst. Hier wird nur zugeordnet: welches Team auf welchem Platz steht, kommt aus dem Sieger (Tabelle bzw. Baum), die
// Belohnungen aus dem Podest des Servers. Ohne eine einzige Belohnung auf dem Podest bleibt der Moment, wie er war.

export const PODIUM_RANKS = [1, 2, 3];
// Reihenfolge auf der Bühne: der Meister in der Mitte, Platz 2 links, Platz 3 rechts.
export const PODIUM_STAGE = [2, 1, 3];
// Weitere Belohnungen je Platz klein neben der Hauptbelohnung - mehr würde aus der Distanz nicht mehr lesbar.
export const PODIUM_EXTRAS = 2;

/** Doppelt hält besser: Ruhendes oder nicht Öffentliches kommt nie aufs Podest, auch wenn es einmal mitkäme. */
function shown(reward) {
  return Boolean(reward?.id) && reward.suspended !== true && reward.public !== false && reward.visible !== false;
}

/**
 * Die Plätze des Podests - `null`, wenn keine Belohnung darauf steht. Je Platz `{rank, registrationId, main, extras, more}`:
 * `main` die Hauptbelohnung, `extras` bis zu zwei weitere, `more` wie viele darüber hinaus.
 */
export function podiumPlaces(champion, podium) {
  if (!champion || !Array.isArray(podium?.places)) return null;
  const holders = new Map((champion.podium || []).map((entry) => [entry.rank, entry.registrationId]));
  if (!holders.has(1)) holders.set(1, champion.winnerId);
  const places = PODIUM_RANKS.map((rank) => {
    const rows = podium.places.filter((row) => row?.rank === rank);
    const own = holders.get(rank) || null;
    // Steht der Platz fest, zählen nur seine Belohnungen; sonst (geteilter Platz) nur, wenn genau ein Team ihn hält.
    const row = own ? rows.find((entry) => entry.registration_id === own) : rows.length === 1 ? rows[0] : null;
    const registrationId = own || row?.registration_id || null;
    if (!registrationId) return null;
    const rewards = (row?.rewards || []).filter(shown);
    return { rank, registrationId, main: rewards[0] || null, extras: rewards.slice(1, 1 + PODIUM_EXTRAS), more: Math.max(0, rewards.length - 1 - PODIUM_EXTRAS) };
  }).filter(Boolean);
  return places.some((place) => place.main) ? places : null;
}

/** Die Zeile über dem Podest: Liga, Liga N und Season - was davon bekannt ist. */
export function podiumLine(podium) {
  return [podium?.league, podium?.division, podium?.season].filter(Boolean).join(" · ");
}

/** Eine Belohnung als Grafik (RewardArt) - beschriftet mit Season und Liga N wie auf der Ligaseite. */
export function podiumArt(reward, podium) {
  return { kind: reward.kind, name: reward.name, image_url: reward.image_url || null,
    art: { ...(reward.art || {}), season: podium?.season || undefined, division: podium?.division || undefined } };
}
