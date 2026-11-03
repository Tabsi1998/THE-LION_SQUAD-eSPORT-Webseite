// Reiter „Überblick“ der Season-Seite (#2267): Ablaufleiste der Phasen, „Was fehlt noch?“ aus der Prüfung (C.2) mit Sprung an die
// Stelle, Name, Sichtbarkeit und Stand mit einem Satz, was sie bewirken, der Hinweis aufs Regelwerk und „Gestaltung und Gewinne“.
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, Minus } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { SEASON_STATUS_OPTIONS, VISIBILITY_OPTIONS, VISIBILITY_SHORT } from "@/lib/league";
import { STATUS_EFFECT, VISIBILITY_EFFECT, seasonPhases } from "@/lib/seasonTabs";
import { BannerField, EmblemField, PrizeEditor } from "./LeagueLookFields";
import { SeasonReadinessPanel } from "./SeasonReadinessPanel";
import { SeasonTabForm } from "./SeasonTabForm";

const STATUS_TEXT = Object.fromEntries(SEASON_STATUS_OPTIONS);

function PhaseDot({ state }) {
  if (state === "done") {
    return <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#29B6E8] text-black"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>;
  }
  if (state === "current") {
    return <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#29B6E8] bg-[#0A0A0A]"><span className="h-2 w-2 rounded-full bg-[#29B6E8]" /></span>;
  }
  if (state === "skipped") {
    return <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 bg-[#0A0A0A] text-white/35"><Minus className="h-3 w-3" aria-hidden="true" /></span>;
  }
  return <span className="relative z-10 h-6 w-6 shrink-0 rounded-full border border-white/20 bg-[#0A0A0A]" />;
}

const STATE_TEXT = { done: "erledigt", current: "jetzt", upcoming: "kommt noch", skipped: "entfällt" };

/** Die Phasen der Season als Leiste - am Handy untereinander, ab 768 px nebeneinander. */
export function SeasonPhaseBar({ season, calendar, divisions, now }) {
  const steps = seasonPhases({ season, calendar, divisions, now });
  return (
    <section className="rounded-sm border border-white/10 bg-[#121212] p-4 md:p-5" aria-labelledby="season-phases-title" data-testid="season-phases">
      <h2 id="season-phases-title" className="mb-4 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Ablauf der Season</h2>
      <ol className="grid gap-3 md:grid-cols-5 md:gap-0">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const current = step.state === "current";
          return (
            <li key={step.key} className="relative flex gap-3 md:block md:pr-4" data-testid={`season-phase-${step.key}`} data-state={step.state}
              aria-current={current ? "step" : undefined}>
              {!last ? (
                <span aria-hidden="true" className={`absolute left-[11px] top-7 -bottom-3 w-px md:left-7 md:right-1 md:top-[11px] md:bottom-auto md:h-px md:w-auto ${step.state === "done" ? "bg-[#29B6E8]/60" : "bg-white/10"}`} />
              ) : null}
              <PhaseDot state={step.state} />
              <div className="min-w-0 pb-1 md:mt-2.5">
                <div className={`flex flex-wrap items-center gap-x-2 text-xs font-bold uppercase tracking-wider ${current ? "text-white" : step.state === "upcoming" ? "text-white/55" : "text-white/70"}`}>
                  {step.label}
                  {current ? <span className="rounded-sm bg-[#29B6E8]/15 px-1.5 py-0.5 text-[10px] text-[#29B6E8]">Jetzt</span> : <span className="sr-only">({STATE_TEXT[step.state]})</span>}
                </div>
                {step.when ? <div className="mt-0.5 text-xs tabular-nums text-white/60">{step.when}</div> : null}
                <div className={`mt-0.5 text-xs ${current ? "text-white/75" : "text-white/40"}`}>{step.note}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RulesNotice({ notice, rulesLink, onJump }) {
  if (!notice) return null;
  return (
    <div role="status" className="flex flex-wrap items-start gap-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3" data-testid="season-rules-notice" data-kind={notice.kind}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-white">Regelwerk muss freigegeben werden</p>
        <p className="mt-0.5 text-white/70">{notice.text}</p>
      </div>
      {rulesLink ? (
        <Link to={rulesLink} className="tls-btn tls-btn--secondary inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid="season-rules-notice-link">
          Regelwerk öffnen <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      ) : (
        <button type="button" onClick={() => onJump("regelwerk")} className="tls-btn tls-btn--quiet inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
          Zu Regelwerk <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Effect({ children, testId }) {
  return <p className="-mt-2 text-xs leading-relaxed text-white/60" data-testid={testId}>{children}</p>;
}

export function SeasonOverviewTab({ data, form, set, setForm, saved, canSeason, readiness, overrideReason, onOverrideReason, onJump, rulesNotice, rulesLink,
  formProps, now }) {
  const season = data.season;
  const publishing = form.visibility !== saved.visibility && ["members", "public"].includes(form.visibility) && !["members", "public"].includes(saved.visibility);
  const blocked = publishing && readiness.result && !readiness.result.ok;
  const lookSet = Boolean(form.emblem_url || form.banner_url || (form.prizes || []).length);
  const check = (
    <SeasonReadinessPanel readiness={readiness} visibility={season.visibility} overrideReason={overrideReason}
      onOverrideReason={canSeason ? onOverrideReason : undefined} onJump={onJump} />
  );
  return (
    <div className="space-y-6">
      <SeasonPhaseBar season={season} calendar={data.calendar} divisions={data.divisions} now={now} />
      <RulesNotice notice={rulesNotice} rulesLink={rulesLink} onJump={onJump} />
      {canSeason ? (
        <SeasonTabForm {...formProps}>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div id="pruefung" className="min-w-0 scroll-mt-24">{check}</div>
            <FormSection title="Season" testId="season-state" hint="Name, wer die Season sieht und in welchem Stand sie ist.">
              <TextField label="Name" maxLength={80} value={form.name} onChange={(value) => set("name", value)} testId="season-form-name" />
              <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(value) => set("visibility", value)} options={VISIBILITY_OPTIONS} testId="season-form-visibility" />
              <Effect testId="season-visibility-effect">{VISIBILITY_EFFECT[form.visibility]} Gilt beim Speichern sofort, auch für alle Staffeln.</Effect>
              {blocked ? (
                <p className="text-xs text-warn" data-testid="season-visibility-blocked">Die Prüfung links meldet noch Probleme – so lässt sich die Season noch nicht veröffentlichen.</p>
              ) : null}
              <SelectField label="Stand" value={form.status} onChange={(value) => set("status", value)} options={SEASON_STATUS_OPTIONS} testId="season-form-status" />
              <Effect testId="season-status-effect">{STATUS_EFFECT[form.status]}</Effect>
            </FormSection>
          </div>
          {/* Gestaltung (#2107): Emblem und Banner überschreiben die der Liga, leer heißt „wie die Liga“. Die Farbe gehört der Liga (Stift in
              der Ligaübersicht). Gewinne sind reine Anzeige - kein Bezug zu XP oder Pokalen. */}
          <FormSection title="Gestaltung und Gewinne" testId="season-look" id="gestaltung" className="scroll-mt-24" collapsible defaultOpen={lookSet}
            hint="Freiwillig. Wirkt beim Speichern sofort auf Ligaseite, Übersicht, Teamseite und Link-Vorschau – ohne Übertragen. Das Banner bekommen auch die Staffeln.">
            <FormGrid>
              <EmblemField value={form.emblem_url} onChange={(value) => set("emblem_url", value || "")} inherited={data.league.emblem_url}
                inheritedLabel="Leer: das Emblem der Liga (Vorschau)." accent={data.league.accent_color} testId="season-emblem" />
              <BannerField url={form.banner_url} focus={form.banner_focus} inherited={data.league.banner_url ? { url: data.league.banner_url, ...(data.league.banner_focus || {}) } : null}
                inheritedLabel="Leer: das Banner der Liga (Vorschau)." emblem={form.emblem_url || data.league.emblem_url} accent={data.league.accent_color} testId="season-banner"
                onChange={(url, focus) => setForm((current) => ({ ...current, banner_url: url || "", banner_focus: focus }))} />
            </FormGrid>
            <PrizeEditor rows={form.prizes} onChange={(value) => set("prizes", value)} testId="season-prizes"
              emptyHint="Noch keine Gewinne – die Ligaseite zeigt dann keinen Block „Um was gespielt wird“." />
          </FormSection>
        </SeasonTabForm>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div id="pruefung" className="min-w-0 scroll-mt-24">{check}</div>
          <FormSection title="Season" testId="season-state">
            <p className="text-sm text-white/80"><strong className="text-white">Sichtbarkeit:</strong> {VISIBILITY_SHORT[season.visibility]}</p>
            <Effect>{VISIBILITY_EFFECT[season.visibility]}</Effect>
            <p className="text-sm text-white/80"><strong className="text-white">Stand:</strong> {STATUS_TEXT[season.status] || season.status}</p>
            <Effect>{STATUS_EFFECT[season.status]}</Effect>
          </FormSection>
        </div>
      )}
    </div>
  );
}
