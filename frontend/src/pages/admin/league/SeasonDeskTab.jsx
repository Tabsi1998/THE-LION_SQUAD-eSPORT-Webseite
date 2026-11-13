// Reiter „Leitstand“ der Season-Seite (E.4, Nr. 152, docs/LIGA.md „E.4 Leitstand“): alle offenen Aufgaben der Season an einem Ort,
// gruppiert nach Art mit Zähler, je Aufgabe Frist, Zuständigkeit und der direkte Weg dorthin, wo sie erledigt wird. Filter „Alle“ und
// „Nur meine“ (was die Person selbst erledigen kann - nicht befangen, nicht von jemand anderem übernommen). Darunter das Protokoll der
// Season (seitenweise) und die Rundnachricht (Nr. 153, SeasonBroadcastSheet). Welche Gruppen jemand sieht, entscheidet der Server nach
// den Zuständigkeiten; eigene Spiele stehen mit dem Hinweis, dass eine zweite Person entscheidet.
//
// Bewegung: Zähler laufen beim ersten Anzeigen hoch, die Aufgaben steigen gestaffelt auf, ein geänderter Zähler leuchtet einmal auf.
// „Bewegung reduzieren“: alles steht sofort (die Bausteine aus components/tls/motion prüfen das selbst).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Megaphone, ShieldAlert } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { CountUp, Glow, StaggerIn } from "@/components/tls/motion";
import { DESK_FILTERS, deskResponsible, deskWhen, filterGroups } from "@/lib/leagueDesk";
import { viennaDateTime } from "@/lib/vienna";
import { incidentReviewText, rulesPendingText } from "@/pages/admin/duty/DutyAttention";
import { SeasonBroadcastSheet } from "./SeasonBroadcastSheet";

const WHEN = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" };
const ACTION = "tls-btn tls-btn--secondary inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider sm:w-auto";

/** Der Satz einer Aufgabe. Vorfälle und Regelwerk sagen es wie „Mein Dienst“ - mit derselben Funktion. */
export function deskText(item) {
  if (item.kind === "incidents") return incidentReviewText(item.detail || {});
  if (item.kind === "rules") return rulesPendingText(item.detail || {});
  return item.text || "";
}

function DeskItem({ item, group, now }) {
  const when = deskWhen(item, now);
  return (
    <li className={`rounded-sm border bg-[#121212] p-4 ${item.conflict ? "border-warn/40" : "border-white/10"}`} data-testid={`desk-item-${item.id}`}
      data-mine={item.mine ? "true" : "false"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-heading font-bold text-white [overflow-wrap:anywhere]">{item.title}</div>
          <p className="mt-1 text-sm text-white/70 [overflow-wrap:anywhere]">{deskText(item)}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
            {when ? (
              <div className={when.over ? "text-[#FF6B60]" : when.kind === "due" ? "text-white/75" : ""}>
                <dt className="sr-only">{when.kind === "due" ? "Frist" : "Offen"}</dt>
                <dd className="tabular-nums" data-testid={`desk-item-when-${item.id}`}>{when.text}</dd>
              </div>
            ) : (
              <div><dt className="sr-only">Frist</dt><dd>ohne Frist</dd></div>
            )}
            <div>
              <dt className="inline">Zuständig: </dt>
              <dd className="inline [overflow-wrap:anywhere]" data-testid={`desk-item-responsible-${item.id}`}>{deskResponsible(item, group)}</dd>
            </div>
          </dl>
          {item.conflict ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warn" data-testid={`desk-item-conflict-${item.id}`}>
              <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {item.conflict_text}
            </p>
          ) : null}
        </div>
        <Link to={item.url} className={ACTION} data-testid={`desk-item-open-${item.id}`}>
          {item.action || "Öffnen"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

function DeskGroup({ group, now }) {
  const count = group.items.length;
  return (
    <section aria-labelledby={`desk-group-${group.key}`} data-testid={`desk-group-${group.key}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`desk-group-${group.key}`} className="flex items-center gap-2 font-heading text-base font-bold uppercase">
          {group.label}
          <Glow trigger={count} className="inline-flex min-w-[1.75rem] justify-center rounded-full bg-[#29B6E8]/15 px-2 py-0.5 text-xs font-bold text-[#29B6E8]">
            <CountUp value={count} data-testid={`desk-group-count-${group.key}`} />
          </Glow>
        </h3>
        <span className="text-xs text-white/45">{group.responsible}</span>
      </div>
      <StaggerIn as="ul" className="space-y-2">
        {group.items.map((item) => <DeskItem key={item.id} item={item} group={group} now={now} />)}
      </StaggerIn>
    </section>
  );
}

function DeskLog({ seasonId, version }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: "loading", items: [], pages: 1, total: 0 });
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/desk/log`, { params: { page } })
      .then(({ data }) => alive && setState({ status: "ready", items: data.items || [], pages: data.pages || 1, total: data.total || 0 }))
      .catch((failure) => alive && setState({ status: "error", items: [], pages: 1, total: 0, error: formatApiError(failure.response?.data?.detail) }));
    return () => { alive = false; };
  }, [seasonId, page, version]);
  return (
    <section id="protokoll" className="scroll-mt-24" aria-labelledby="desk-log-heading" data-testid="desk-log">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="desk-log-heading" className="font-heading text-base font-bold uppercase">Protokoll der Season</h3>
        <span className="text-xs text-white/45">{state.total === 1 ? "1 Eintrag" : `${state.total} Einträge`}, ohne Begründungen und Namen aus den Fällen</span>
      </div>
      {state.status === "loading" ? <p className="text-sm text-white/50">Protokoll wird geladen …</p> : null}
      {state.status === "error" ? <p className="text-sm text-warn" role="alert">{state.error || "Das Protokoll ließ sich nicht laden."}</p> : null}
      {state.status === "ready" && !state.items.length ? <p className="text-sm text-white/55" data-testid="desk-log-empty">Noch nichts im Protokoll.</p> : null}
      {state.items.length ? (
        <ol className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]">
          {state.items.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4" data-testid={`desk-log-${row.id}`}>
              <span className="shrink-0 text-xs tabular-nums text-white/45 sm:w-32">{row.at ? viennaDateTime(row.at, WHEN) : ""}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="font-semibold text-white">{row.label}</span>
                {row.broadcast ? <span className="text-white/65"> · {row.broadcast.audience}, {row.broadcast.scope}, {row.broadcast.recipients} Empfänger{row.broadcast.mail ? ", mit Mail" : ""}</span> : null}
                {row.staffel ? <span className="text-white/55"> · {row.staffel}</span> : null}
                {row.match_id ? <> · <Link to={`/matches/${row.match_id}`} className="text-[#29B6E8] hover:underline">Spiel</Link></> : null}
              </span>
              <span className="shrink-0 text-xs text-white/55 [overflow-wrap:anywhere]">{row.actor}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {state.pages > 1 ? (
        <nav className="mt-2 flex items-center justify-between gap-2" aria-label="Seiten des Protokolls">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} data-testid="desk-log-newer"
            className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-1 rounded-sm px-3 text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Neuer
          </button>
          <span className="text-xs tabular-nums text-white/55" data-testid="desk-log-page">Seite {page} von {state.pages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(state.pages, value + 1))} disabled={page >= state.pages} data-testid="desk-log-older"
            className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-1 rounded-sm px-3 text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            Älter <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

export function SeasonDeskTab({ seasonId, divisions = [] }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [filter, setFilter] = useState("all");
  const [sheet, setSheet] = useState(false);
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/desk`);
      setState({ status: "ready", data });
    } catch (failure) {
      setState((current) => ({ status: current.data ? "ready" : "error", data: current.data, error: formatApiError(failure.response?.data?.detail) }));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues", "matches", "tournaments"]);

  const data = state.data;
  const groups = useMemo(() => filterGroups(data?.groups, filter), [data, filter]);
  const open = groups.filter((group) => group.items.length);
  const quiet = groups.filter((group) => !group.items.length);
  const failed = groups.filter((group) => group.failed);
  const shown = open.reduce((sum, group) => sum + group.items.length, 0);
  const now = Date.now();

  return (
    <div className="space-y-8" data-testid="season-desk">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Leitstand</span>
          <h2 className="mt-1 font-heading text-2xl font-black uppercase">
            {data ? <CountUp value={shown} data-testid="desk-total" /> : "…"} {shown === 1 ? "offene Aufgabe" : "offene Aufgaben"}
          </h2>
          {data ? (
            <p className="mt-1 text-sm text-white/55" data-testid="desk-summary">
              {data.mine === data.total ? (data.total ? "Alle davon kannst du selbst erledigen." : "In dieser Season wartet gerade nichts.")
                : `${data.mine} von ${data.total} kannst du selbst erledigen – der Rest wartet auf eine zweite Person oder die Gegenseite.`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Welche Aufgaben" className="inline-flex rounded-sm border border-white/10 bg-[#0A0A0A] p-0.5" data-testid="desk-filter">
            {DESK_FILTERS.map((row) => {
              const selected = filter === row.key;
              const count = row.key === "mine" ? data?.mine : data?.total;
              return (
                <button key={row.key} type="button" role="radio" aria-checked={selected} onClick={() => setFilter(row.key)} data-testid={`desk-filter-${row.key}`}
                  className={`tls-press inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] ${selected ? "bg-[#29B6E8] text-black" : "text-white/60 hover:text-white"}`}>
                  {row.label}{count != null ? <span className="tabular-nums opacity-80">{count}</span> : null}
                </button>
              );
            })}
          </div>
          {data?.can_broadcast ? (
            <button type="button" id="rundnachricht" onClick={() => setSheet(true)} data-testid="desk-broadcast-open"
              className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 rounded-sm px-4 text-xs font-bold uppercase tracking-wider">
              <Megaphone className="h-4 w-4" aria-hidden="true" /> Rundnachricht
            </button>
          ) : null}
        </div>
      </div>

      {state.status === "loading" ? <p className="text-sm text-white/50" data-testid="desk-loading">Leitstand wird geladen …</p> : null}
      {state.status === "error" ? <p className="text-sm text-warn" role="alert" data-testid="desk-error">{state.error || "Der Leitstand ließ sich nicht laden."}</p> : null}

      {data && !open.length ? (
        <StaggerIn>
        <div className="flex items-start gap-3 rounded-sm border border-ok/30 bg-ok/5 p-5" data-testid="desk-empty">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-ok" aria-hidden="true" />
          <div>
            <div className="font-heading text-lg font-bold uppercase text-white">Alles erledigt</div>
            <p className="mt-1 text-sm text-white/65">
              {filter === "mine" && data.total ? "Für dich liegt hier gerade nichts. Was noch offen ist, entscheidet eine zweite Person oder die Gegenseite – unter „Alle“ siehst du es."
                : data.limited ? "Für deine Zuständigkeiten wartet gerade nichts. Neue Fälle erscheinen hier von selbst."
                  : "In dieser Season wartet gerade keine Aufgabe auf die Liga-Leitung. Neue Fälle erscheinen hier von selbst."}
            </p>
          </div>
        </div>
        </StaggerIn>
      ) : null}

      {open.length ? <div className="space-y-6">{open.map((group) => <DeskGroup key={group.key} group={group} now={now} />)}</div> : null}

      {data && quiet.length ? (
        <p className="text-xs text-white/45" data-testid="desk-quiet">
          Ohne offene Aufgabe: {quiet.map((group) => group.label).join(", ")}.
        </p>
      ) : null}
      {failed.length ? (
        <p className="text-xs text-warn" role="status" data-testid="desk-failed">
          Nicht geladen: {failed.map((group) => group.label).join(", ")}. Die Stelle selbst zeigt den Stand – bitte gleich noch einmal laden.
        </p>
      ) : null}

      {data ? <DeskLog seasonId={seasonId} version={version} /> : null}

      {sheet ? (
        <SeasonBroadcastSheet seasonId={seasonId} divisions={divisions} onClose={() => setSheet(false)}
          onSent={() => { setSheet(false); setVersion((value) => value + 1); }} />
      ) : null}
    </div>
  );
}
