// Team-Seite (docs/LIGA.md, B.4, #2205): der Stand der Liga-Anmeldung je Co-Team, mit Link zur Ligaseite. Dort stehen Knopf, Zurückziehen und alles Weitere.
// Aus der Vorgänger-Season übernommen (F.2, #1627): Herkunft, Frist und „Abmelden“ stehen hier - die neue Season ist oft noch nicht veröffentlicht.
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { teamStateLabel } from "@/lib/leagueApplications";
import { carryLine } from "@/lib/leagueSuccessor";
import { ApplicationStateBadge } from "./LeagueApplicationPanel";

export function SquadApplicationStatus({ items = [], onChanged }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  if (!items.length) return null;
  const withdraw = async (row) => {
    const sure = await confirm({
      title: "Von der Season abmelden?",
      description: `Ihr spielt dann nicht in ${row.title}. Der Platz geht an die Warteliste oder neue Anmeldungen. Zurück geht es nur über eine neue Anmeldung.`,
      confirmLabel: "Abmelden", tone: "danger",
    });
    if (!sure) return;
    setBusy(row.id);
    try {
      await api.post(`/me/league-applications/${row.id}/withdraw`, {});
      toast.success("Abgemeldet. Der Platz ist frei.");
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy("");
  };
  return (
    <ul className="mt-3 space-y-2 border-t border-white/10 pt-3" aria-label="Liga-Anmeldungen">
      {items.map((row) => (
        <li key={row.id} data-testid={`squad-application-${row.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            {row.url ? <Link to={row.url} className="min-w-0 text-sm font-semibold text-[#29B6E8] hover:underline [overflow-wrap:anywhere]">{row.title}</Link>
              : <span className="min-w-0 text-sm font-semibold text-white [overflow-wrap:anywhere]">{row.title}</span>}
            <ApplicationStateBadge state={row.status} label={teamStateLabel(row.status, row)} />
          </div>
          {row.carry_over ? <p className="mt-0.5 text-xs text-white/75 [overflow-wrap:anywhere]" data-testid={`squad-application-carry-${row.id}`}>{carryLine(row.carry_over)}</p> : null}
          {row.staffel ? <p className="mt-0.5 text-xs text-white/65">{row.staffel_left ? `Nicht mehr in ${row.staffel}.` : `Spielt in ${row.staffel}.`}</p> : null}
          {row.decision_reason ? <p className="mt-0.5 text-xs text-white/65 [overflow-wrap:anywhere]">Grund: {row.decision_reason}</p> : null}
          {row.carry_over && row.can_withdraw ? (
            <button type="button" disabled={busy === row.id} onClick={() => withdraw(row)} data-testid={`squad-application-withdraw-${row.id}`}
              className="tls-btn tls-btn--quiet mt-2 inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              Abmelden
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
