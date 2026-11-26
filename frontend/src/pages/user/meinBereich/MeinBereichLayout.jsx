import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Crown } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { LazyImg } from "@/components/tls/LazyImg";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { isAnyAdmin } from "@/lib/permissions";
import { BEREICH, gruppeZuPfad, gruppenFuer } from "@/lib/meinBereich";
import { zuTun } from "@/lib/meinBereichZuTun";
import { BereichSeitenleiste } from "./BereichNav";
import { requestHeadingFocus } from "./BereichSeite";
import "./meinBereich.css";

// „Mein Bereich“ (#2059): ein Rahmen für alle acht Gruppen. Am PC links die Seitenleiste (steht still, nur der Inhalt
// wechselt), am Handy ist /mein-bereich die Liste und jede Gruppe eine eigene kurze Seite mit „Zurück“. „Zu tun“ lädt
// einmal hier - die Übersicht zeigt die Knöpfe, die Seitenleiste die Zahl an der Gruppe.

/** Wie ProtectedRoute requireMember: Mitglieder und die Verwaltung sehen „Verein“. */
export function siehtVerein(user) {
  return Boolean(user?.is_club_member) || isAnyAdmin(user);
}

function useZuTunDaten(user, mitglied, secondFactor) {
  const [state, setState] = useState({ items: [], loaded: false });
  const userId = user?.id || "";
  const load = useCallback(() => {
    if (!userId) return;
    const member = (path) => (mitglied ? api.get(path) : Promise.resolve({ data: null }));
    Promise.allSettled([
      api.get("/account/invoices"),
      api.get("/prizes/me/open-count"),
      member("/membership/me"),
      member("/membership/me/consents"),
      member("/membership/me/jersey-number"),
      member("/membership/area-summary"),
    ]).then(([invoices, prizes, membership, consents, jersey, area]) => {
      const value = (result) => (result.status === "fulfilled" && result.value?.data && typeof result.value.data === "object" ? result.value.data : null);
      setState({
        loaded: true,
        items: zuTun({
          invoices: value(invoices),
          prizes: value(prizes)?.count || 0,
          membership: value(membership),
          consents: value(consents),
          jersey: value(jersey),
          area: value(area),
          secondFactor,
        }),
      });
    });
  }, [userId, mitglied, secondFactor]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["account/invoices", "membership", "prizes", "documents"]);
  return state;
}

function Identitaet({ user }) {
  const [failed, setFailed] = useState(false);
  const name = user?.display_name || user?.username || "";
  const url = user?.avatar_url && !failed ? resolveMediaUrl(user.avatar_url) : "";
  return (
    <div className="flex items-center gap-3 min-w-0" data-testid="mein-bereich-identity">
      <span className="w-11 h-11 shrink-0 rounded-sm border border-white/15 bg-[#121212] overflow-hidden inline-flex items-center justify-center font-heading font-black text-sm text-[#29B6E8]">
        {url ? <LazyImg src={url} widths={[160]} sizes="44px" alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} /> : (name || "TL").slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="tls-wrap block font-bold text-white" data-testid="mein-bereich-name">{name}</span>
        <span className="tls-wrap block text-xs text-white/50">
          @{user?.username}
          {user?.is_club_member ? <span className="ml-2 inline-flex items-center gap-1 text-[#FFD700]"><Crown className="w-3 h-3" aria-hidden="true" /> Mitglied</span> : null}
        </span>
      </span>
    </div>
  );
}

export default function MeinBereichLayout() {
  const { user, adminNeedsSecondFactor } = useAuth();
  const { pathname } = useLocation();
  const mitglied = siehtVerein(user);
  const gruppen = useMemo(() => gruppenFuer({ mitglied }), [mitglied]);
  const aktiv = gruppeZuPfad(pathname);
  const todo = useZuTunDaten(user, mitglied, Boolean(adminNeedsSecondFactor));
  // Die Zahl an der Gruppe zählt wie die Seite selbst (Sprungleiste „Versammlung · 3 offen“), nicht die Knöpfe.
  const offen = useMemo(() => todo.items.reduce((acc, item) => ({ ...acc, [item.gruppe]: (acc[item.gruppe] || 0) + (item.anzahl || 1) }), {}), [todo.items]);

  // Nach einem Wechsel innerhalb von „Mein Bereich“ holt die neue Gruppe den Fokus auf ihre Überschrift.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    requestHeadingFocus();
  }, [pathname]);

  const context = useMemo(() => ({ todo, offen, gruppen, mitglied, user }), [todo, offen, gruppen, mitglied, user]);
  if (!user) return null;
  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:items-start" data-testid="mein-bereich" data-gruppe={aktiv || ""}>
        <aside className="hidden lg:block lg:sticky lg:top-24 space-y-5" data-testid="mein-bereich-aside">
          <Link to={BEREICH} data-route-plain="" className="block rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#29B6E8]">
            <span className="sr-only">Mein Bereich: </span>
            <Identitaet user={user} />
          </Link>
          <BereichSeitenleiste gruppen={gruppen} aktiv={aktiv} offen={offen} />
        </aside>
        <div className="min-w-0" data-testid="mein-bereich-inhalt">
          <Suspense fallback={<div className="py-4"><SkeletonDetailHeader label="Lade Mein Bereich" /></div>}>
            <div key={pathname} className="tls-mb-panel">
              <Outlet context={context} />
            </div>
          </Suspense>
        </div>
      </div>
    </PublicLayout>
  );
}

export { Identitaet };
