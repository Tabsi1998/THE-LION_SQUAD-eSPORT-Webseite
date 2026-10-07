import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Gift, Receipt, ShieldAlert, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { missingLabels } from "@/lib/profileCompleteness";
import { countOpenPrizes, countPenalties } from "@/hooks/useAccountBadges";
import { enqueueCeremony } from "@/components/achievements/ceremony/queue";
import { describePackage } from "@/components/achievements/ceremony/select";
import { AchievementsTab } from "@/pages/user/profile/AchievementsTab";
import { achievementInsights } from "@/pages/user/profile/form";

// Was nur das eigene Profil zeigt (#1149): der Kasten „Nur für dich“ (Rechnungen, Gewinne, Strafen, was im Profil noch
// fehlt) und die eigenen Erfolge mit Fortschritt. Mit „So sehen dich andere“ ist beides weg.

function money(amount, currency = "EUR") {
  if (amount === null || amount === undefined) return "";
  try {
    return new Intl.NumberFormat("de-AT", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function Row({ to, icon: Icon, title, detail, tone = "gold", testId }) {
  return (
    <Link to={to} data-testid={testId} className="flex items-center gap-3 min-h-14 border-t border-[#FFD700]/15 py-2 first:border-t-0 hover:bg-white/[0.02]">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${tone === "danger" ? "bg-[#FF3B30]/12 text-[#FF6B6B]" : "bg-[#FFD700]/12 text-[#FFD700]"}`}><Icon className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-sm">{title}</span>
        <span className="block text-xs text-white/55 truncate">{detail}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-white/35 shrink-0" />
    </Link>
  );
}

export function PrivateBox() {
  const [state, setState] = useState({ invoices: null, prizes: 0, penalties: 0, completeness: null });
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.get("/account/invoices"),
      api.get("/prizes/me"),
      api.get("/moderation/me/standing"),
      api.get("/users/me/profile-completeness"),
    ]).then(([invoices, prizes, standing, completeness]) => {
      if (cancelled) return;
      setState({
        invoices: invoices.status === "fulfilled" ? invoices.value.data || null : null,
        prizes: prizes.status === "fulfilled" ? countOpenPrizes(prizes.value.data) : 0,
        penalties: standing.status === "fulfilled" ? countPenalties(standing.value.data) : 0,
        completeness: completeness.status === "fulfilled" ? completeness.value.data || null : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const summary = state.invoices?.summary || {};
  const score = Number(state.completeness?.score || 0);
  const missing = missingLabels(state.completeness?.missing);
  return (
    <section className="border border-[#FFD700]/40 bg-[#FFD700]/[0.05] rounded-sm px-4 py-3" data-testid="profile-private-box">
      <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700] pb-1">Nur für dich</div>
      <Row
        to="/account/invoices"
        icon={Receipt}
        title="Rechnungen"
        detail={summary.open_count ? `${summary.open_count} offen · ${money(summary.open_total, state.invoices?.currency)}${summary.overdue_count ? ` · ${summary.overdue_count} überfällig` : ""}` : "Keine offenen Rechnungen"}
        testId="profile-private-invoices"
      />
      <Row to="/my/prizes" icon={Gift} title="Gewinne" detail={state.prizes ? `${state.prizes} offen oder bereit zum Abholen` : "Keine offenen Gewinne"} testId="profile-private-prizes" />
      {state.penalties ? <Row to="/my/penalties" icon={ShieldAlert} title="Moderation" detail={`${state.penalties} Treffer – Details und Einspruch`} tone="danger" testId="profile-private-penalties" /> : null}
      <Row
        to="/profile?tab=basic"
        icon={UserCircle}
        title={score >= 100 ? "Profil vollständig" : `Profil zu ${score} % fertig`}
        detail={missing.length ? `Es fehlt: ${missing.slice(0, 3).join(", ")}` : "Alle wichtigen Felder sind gepflegt."}
        testId="profile-private-completeness"
      />
    </section>
  );
}

/** Die eigenen Erfolge mit Fortschritt, Anheften und „Erfolge prüfen“ - früher ein Reiter unter /profile. */
export function OwnAchievements() {
  const [achData, setAchData] = useState(null);
  const [completeness, setCompleteness] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const load = useCallback(async () => {
    const [achievements, profileCompleteness] = await Promise.allSettled([api.get("/achievements/me"), api.get("/users/me/profile-completeness")]);
    setAchData(achievements.status === "fulfilled" ? achievements.value.data : { groups: [], awards: [] });
    if (profileCompleteness.status === "fulfilled") setCompleteness(profileCompleteness.value.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const evaluate = async () => {
    if (evaluating) return;
    setEvaluating(true);
    try {
      const { data } = await api.post("/achievements/evaluate");
      const fresh = await api.get("/achievements/me").catch(() => null);
      if (fresh) setAchData(fresh.data);
      if (data?.newly_awarded > 0 && fresh?.data?.groups) {
        const earned = [];
        for (const group of fresh.data.groups) {
          if (group.is_negative) continue;
          for (const tier of group.tiers || []) {
            if (tier.earned && tier.earned_at) earned.push({ ...tier, category: group.category, group_name: group.name, group_code: group.code, hidden: group.hidden });
          }
        }
        earned.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));
        const freshTiers = earned.slice(0, data.newly_awarded);
        // Zeremonie (E8): Paket mit Kontext - erster Erfolg, Gruppe oder Kategorie vollständig.
        enqueueCeremony(freshTiers, describePackage(fresh.data.groups, freshTiers));
      } else {
        toast.success("Erfolge aktualisiert.");
      }
    } catch (err) {
      toast.error(formatRequestError(err, "Erfolge konnten nicht aktualisiert werden."));
    } finally {
      setEvaluating(false);
    }
  };
  return (
    <div data-testid="profile-own-achievements">
      <AchievementsTab
        achData={achData}
        achInsights={achData ? achievementInsights(achData) : null}
        completeness={completeness}
        evaluateAchievements={evaluate}
        evaluatingAchievements={evaluating}
        onAchDataChange={setAchData}
      />
    </div>
  );
}
