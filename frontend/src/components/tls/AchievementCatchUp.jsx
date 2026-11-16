import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { enqueueCeremony } from "@/components/achievements/ceremony/queue";
import { describePackage } from "@/components/achievements/ceremony/select";
import { achSeenKey as seenKey, ceremonyState, markSeen, recountSeenKey, serverCheck } from "@/components/achievements/ceremony/seen";

export { recountSeenKey };
/** Der Server hat gerade Stufen vergeben (z. B. nach einem Saison-Signal, #678) - `detail.count` sagt, wie viele. */
export const AWARDED_EVENT = "tls:achievements-awarded";
export const MAX_TIERS = 8;

function collect(groups, wanted) {
  const earned = [];
  for (const group of groups) {
    if (group.is_negative) continue;
    for (const tier of group.tiers || []) {
      if (tier.earned && tier.earned_at && !tier.silent && wanted(tier)) earned.push({ ...tier, category: group.category, group_name: group.name, group_code: group.code, hidden: group.hidden });
    }
  }
  return earned.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));
}

/** Alle erreichten, nicht stillen Stufen aus /achievements/me - die neueste zuerst. Nachgerechnete (#2340) feiert die
 * Sammel-Zeremonie, nicht der einzelne Ablauf. */
export function earnedTiers(groups = []) {
  return collect(groups, (tier) => !tier.recount);
}

/** Die nachgerechneten Stufen (#2340) - für die eine Sammel-Zeremonie nach dem Abschluss der Neuberechnung. */
export function recountTiers(groups = []) {
  return collect(groups, (tier) => Boolean(tier.recount));
}

function remember(key) {
  try {
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    /* egal */
  }
}

function lastSeen(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const CATCH_UP = { catchUp: true, heading: "Während du weg warst!", sub: "Nachgeholte Erfolge" };

/**
 * Erfolge als Zeremonie (E8: über die Warteschlange, nie doppelt): beim Laden die seit dem letzten Besuch
 * nachgeholten, und - sobald der Server meldet, dass gerade Stufen vergeben wurden - genau diese, sofort.
 *
 * Einmal je Konto (#2450): Was schon gesehen ist, weiß der Server - nachgeholt wird, was dort noch offen ist, und jede
 * Art des Schließens meldet „gesehen“ zurück. Vor dem Anzeigen prüft die Bühne noch einmal (CeremonyHost). Ohne Stand
 * vom Server (ältere Fassung) gilt wie bisher der Merker im Browser.
 */
export function AchievementCatchUp() {
  const { user } = useAuth();
  const ranForRef = useRef(null);
  const shownRef = useRef(new Set());
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    let gone = false;
    const key = seenKey(userId);

    const check = serverCheck(userId);

    // Der Stand vom Server: offen ist, was dort noch nicht gesehen ist - der Merker im Browser zählt nicht mehr.
    const catchUpFromServer = (data, state) => {
      const groups = data?.groups || [];
      const marker = data?.recount?.finished ? data.recount.marker : null;
      if (marker && !state.recountSeen.includes(marker)) {
        const late = recountTiers(groups);
        const done = () => {
          remember(recountSeenKey(userId, marker));
          markSeen(userId, { recountMarker: marker });
        };
        if (late.length) enqueueCeremony(late, { recount: true, recountMarker: marker }, { onDone: done, check });
        else done();
      }
      const unseen = new Set(state.unseen);
      const open = earnedTiers(groups).filter((t) => unseen.has(t.code) && !shownRef.current.has(t.code));
      if (!open.length) {
        remember(key);
        return;
      }
      open.forEach((tier) => shownRef.current.add(tier.code));
      // Gezeigt werden die neuesten; gesehen ist danach alles, was offen war - wie bisher mit dem Merker.
      const fresh = open.slice(0, MAX_TIERS);
      const codes = open.map((tier) => tier.code);
      enqueueCeremony(fresh, { ...describePackage(groups, fresh), ...CATCH_UP }, {
        onDone: () => {
          remember(key);
          markSeen(userId, { codes });
        },
        check,
      });
    };

    // Läuft je Person einmal und immer zu Ende - auch wenn React den Effekt (StrictMode) zweimal aufruft.
    const catchUp = async () => {
      try {
        const { data } = await api.get("/achievements/me");
        const state = await ceremonyState(userId);
        if (state) {
          catchUpFromServer(data, state);
          return;
        }
        // Neuberechnung (#2340): erst nach dem Abschluss, einmal - alle nachgerechneten Stufen in einer Zeremonie.
        const marker = data?.recount?.finished ? data.recount.marker : null;
        if (marker && !lastSeen(recountSeenKey(userId, marker))) {
          const late = recountTiers(data?.groups || []);
          // Auch im Rückfall (Server zu langsam) „gesehen“ melden - sonst käme sie auf einem anderen Gerät noch einmal.
          if (late.length) enqueueCeremony(late, { recount: true }, { onDone: () => { remember(recountSeenKey(userId, marker)); markSeen(userId, { recountMarker: marker }); } });
          else remember(recountSeenKey(userId, marker));
        }
        const last = lastSeen(key);
        if (!last) {
          remember(key);
          return;
        }
        const fresh = earnedTiers(data?.groups || []).filter((t) => +new Date(t.earned_at) > +new Date(last) && !shownRef.current.has(t.code)).slice(0, MAX_TIERS);
        if (!fresh.length) {
          remember(key);
          return;
        }
        fresh.forEach((tier) => shownRef.current.add(tier.code));
        // Der Marker rückt erst vor, wenn die Zeremonie wirklich gezeigt wurde.
        enqueueCeremony(fresh, { ...describePackage(data?.groups || [], fresh), ...CATCH_UP }, {
          onDone: () => {
            remember(key);
            // Rückfall ohne Server-Stand (langsam, älterer Server): trotzdem melden; ein älterer Server ignoriert es.
            markSeen(userId, { codes: fresh.map((tier) => tier.code) });
          },
        });
      } catch {
        /* rein kosmetisch */
      }
    };

    // Gerade vergeben: die neuesten `count` Stufen - nach der Zahl des Servers, nicht nach der Uhr des Geräts.
    const justAwarded = async (event) => {
      const count = Math.min(MAX_TIERS, Math.floor(Number(event?.detail?.count)) || 0);
      if (count <= 0) return;
      try {
        const { data } = await api.get("/achievements/me");
        if (gone) return;
        const fresh = earnedTiers(data?.groups || []).slice(0, count).filter((t) => !shownRef.current.has(t.code));
        if (!fresh.length) return;
        fresh.forEach((tier) => shownRef.current.add(tier.code));
        const codes = fresh.map((tier) => tier.code);
        enqueueCeremony(fresh, describePackage(data?.groups || [], fresh), {
          onDone: () => {
            remember(key);
            markSeen(userId, { codes });
          },
          check,
        });
      } catch {
        /* rein kosmetisch - der nächste Besuch holt es nach */
      }
    };

    if (ranForRef.current !== userId) {
      ranForRef.current = userId;
      shownRef.current = new Set();
      catchUp();
    }
    window.addEventListener(AWARDED_EVENT, justAwarded);
    return () => {
      gone = true;
      window.removeEventListener(AWARDED_EVENT, justAwarded);
    };
  }, [userId]);

  return null;
}
