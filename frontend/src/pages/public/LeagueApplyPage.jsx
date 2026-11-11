// Mit Co-Team anmelden (docs/LIGA.md, B.4, #2205) unter /liga/<liga>/<season>/anmelden: vier Schritte, ohne Vorwissen bedienbar. Co-Team wählen, Prüfung im Klartext, Regeln und
// Datenschutz zustimmen, einreichen. Danach zeigt die Ligaseite den Stand. Geprüft wird beim Einreichen noch einmal auf dem Server.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { HelpLink } from "@/components/tls/HelpLink";
import { ApplicationStateBadge } from "@/components/tls/league/application/LeagueApplicationPanel";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { isSelectable, submittedToast, teamStateLabel } from "@/lib/leagueApplications";
import { platformLines, platformShort } from "@/lib/leaguePlatform";
import { dayNoon, viennaDate } from "@/lib/vienna";
import "@/components/tls/league/public/league.css";

const STEPS = ["Co-Team", "Prüfung", "Zustimmen", "Einreichen"];
// Je Schritt der passende Abschnitt der Hilfe (#2295).
const HELP_STEPS = ["co-team-auswahl", "passt-alles", "regelwerk", "einreichen"];
const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const QUIET = "tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm px-4 py-2.5 text-xs font-bold uppercase tracking-wider";
const PRIMARY = "tls-btn tls-btn--primary inline-flex min-h-[44px] items-center justify-center rounded-sm px-5 py-2.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50";

function Stepper({ step }) {
  return (
    <ol className="tls-apply-steps" aria-label="Schritte">
      {STEPS.map((label, index) => (
        <li key={label} className="tls-apply-steps__item" data-state={index < step ? "done" : index === step ? "now" : "next"} aria-current={index === step ? "step" : undefined}>
          <span className="tls-apply-steps__mark" aria-hidden="true">{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
          <span className="tls-apply-steps__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function SquadChoice({ rows, chosen, onChoose }) {
  return (
    <fieldset>
      <legend className="sr-only">Co-Team wählen</legend>
      <ul className="space-y-2">
        {rows.map((row) => {
          const free = isSelectable(row);
          return (
            <li key={row.squad_id} data-testid={`apply-squad-row-${row.squad_id}`}>
              <label className={`flex min-h-[56px] items-start gap-3 rounded-sm border px-3 py-3 ${chosen === row.squad_id ? "border-[#29B6E8]/70 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"} ${free ? "cursor-pointer" : "opacity-70"}`}>
                <input type="radio" name="apply-squad" className="mt-1 accent-[#29B6E8]" checked={chosen === row.squad_id} disabled={!free} onChange={() => onChoose(row.squad_id)} data-testid={`apply-squad-${row.squad_id}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
                  <span className="block text-xs text-white/55">{row.member_count} Spieler im Kader</span>
                </span>
                {free ? null : <ApplicationStateBadge state={row.state} label={teamStateLabel(row.state, row.application)} />}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Plattform je Season (#2270): was gilt, bevor die Liga feststeht - eine Liga N mit eigener Regel steht darunter. */
function PlatformNote({ platform }) {
  const lines = platformLines(platform);
  const own = (platform?.divisions || []).filter((division) => division.differs);
  if (!lines.length && !own.length) return null;
  return (
    <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 text-sm text-white/75" data-testid="apply-platform">
      <p className="font-semibold text-white/85">Plattform in dieser Season</p>
      {lines.length ? <ul className="mt-1 space-y-0.5">{lines.map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}</ul> : null}
      {own.length ? (
        <p className="mt-1 text-xs text-white/55 [overflow-wrap:anywhere]">
          Abweichend: {own.map((division) => `${division.label}: ${platformShort(division)}`).join(" · ")}. In welche Liga das Co-Team kommt, entscheidet die Liga-Leitung.
        </p>
      ) : null}
    </div>
  );
}

/** Offene Punkte (#2313): fehlende Angaben halten die Anmeldung nicht auf - gesperrt wird erst beim Check-in und bei der Aufstellung. */
function OpenPoints({ row }) {
  const warnings = row.warnings || [];
  if (!warnings.length && !row.shortfall) return null;
  return (
    <div className="rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 p-3" data-testid="apply-warnings">
      <p className="flex items-start gap-2 text-sm font-semibold text-white/90">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
        <span>Die Anmeldung geht trotzdem. Bis zum ersten Spiel noch nachtragen:</span>
      </p>
      {row.shortfall ? <p className="mt-2 text-sm text-white/85 [overflow-wrap:anywhere]" data-testid="apply-shortfall">{row.shortfall}</p> : null}
      {warnings.length ? (
        <ul className="mt-2 space-y-1 text-sm text-white/75">{warnings.map((text) => <li key={text} className="[overflow-wrap:anywhere]">{text}</li>)}</ul>
      ) : null}
      <p className="mt-2 text-xs text-white/60">
        Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden. Jeder trägt es im eigenen Profil nach. Wir erinnern die Spieler und dich jetzt und noch einmal vor dem ersten Spiel.
      </p>
    </div>
  );
}

function CheckStep({ row, seasonProblems, platform }) {
  const problems = [...seasonProblems, ...(row.problems || [])];
  const open = Boolean(row.warnings?.length || row.shortfall);
  return (
    <div className="space-y-4">
      <PlatformNote platform={platform} />
      {problems.length ? (
        <div className="rounded-sm border border-warn/40 bg-warn/5 p-3" data-testid="apply-problems">
          <p className="font-semibold text-warn">So geht die Anmeldung noch nicht:</p>
          <ul className="mt-2 space-y-2 text-sm text-white/85">
            {problems.map((text) => <li key={text} className="flex gap-2 [overflow-wrap:anywhere]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{text}</span></li>)}
          </ul>
          <Link to={`/teams?team=${encodeURIComponent(row.team_id)}`} data-testid="apply-team-link" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:underline">Kader und Rollen ändern</Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-sm border border-ok/40 bg-ok/5 p-3 text-sm text-white/90" data-testid="apply-check-ok">
          <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> {open ? `${row.display_name} kann angemeldet werden.` : `${row.display_name} erfüllt die Vorgaben dieser Season.`}
        </p>
      )}
      <OpenPoints row={row} />
    </div>
  );
}

function ConsentStep({ rules, privacy, acceptRules, acceptPrivacy, onRules, onPrivacy }) {
  return (
    <div className="space-y-5">
      <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
        <p className="font-semibold text-white [overflow-wrap:anywhere]">{rules.title}</p>
        <p className="text-sm text-white/65" data-testid="apply-rules-version">{rules.label} · gültig ab {viennaDate(dayNoon(rules.valid_from), DAY)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={rules.url} target="_blank" rel="noopener noreferrer" data-testid="apply-rules-link" className={QUIET}><ExternalLink className="h-4 w-4" aria-hidden="true" /> Regeln lesen</a>
          <a href={`${API}${rules.pdf_url.replace(/^\/api/, "")}`} target="_blank" rel="noopener noreferrer" className={QUIET}><FileText className="h-4 w-4" aria-hidden="true" /> PDF</a>
        </div>
        <label className="mt-3 flex min-h-[44px] items-start gap-2 text-sm text-white/90">
          <input type="checkbox" className="mt-1 accent-[#29B6E8]" checked={acceptRules} onChange={(event) => onRules(event.target.checked)} data-testid="apply-accept-rules" />
          <span>Ich habe die Regeln gelesen und stimme für mein Co-Team zu.</span>
        </label>
      </div>
      <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
        <p className="font-semibold text-white">Datenschutz</p>
        <p className="mt-1 whitespace-pre-line text-sm text-white/70 [overflow-wrap:anywhere]" data-testid="apply-privacy-text">{privacy.text}</p>
        <a href={privacy.url} target="_blank" rel="noopener noreferrer" data-testid="apply-privacy-link" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:underline">Datenschutzerklärung <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
        <label className="mt-3 flex min-h-[44px] items-start gap-2 text-sm text-white/90">
          <input type="checkbox" className="mt-1 accent-[#29B6E8]" checked={acceptPrivacy} onChange={(event) => onPrivacy(event.target.checked)} data-testid="apply-accept-privacy" />
          <span>Ich habe den Hinweis gelesen und stimme zu.</span>
        </label>
      </div>
    </div>
  );
}

// ``auto``: Die Season nimmt Anmeldungen automatisch an (#2348) - dann zählt das Einreichen gleich, sonst entscheidet die Leitung.
function Summary({ row, rules, auto }) {
  return (
    <div className="space-y-3" data-testid="apply-summary">
      <dl className="space-y-2 rounded-sm border border-white/10 bg-[#0A0A0A] p-3 text-sm">
        <div><dt className="text-xs uppercase tracking-wider text-white/50">Co-Team</dt><dd className="font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-white/50">Regeln</dt><dd className="text-white/85">{rules.label}, zugestimmt</dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-white/50">Datenschutz</dt><dd className="text-white/85">zugestimmt</dd></div>
      </dl>
      {auto ? (
        <p className="text-sm text-white/70" data-testid="apply-summary-auto">Ist ein Startplatz frei, seid ihr mit dem Einreichen angemeldet. Sind alle vergeben oder wartet schon jemand, kommt ihr auf die Warteliste. Liga und Staffel teilt die Liga-Leitung zu, gibt es nur eine Staffel, steht ihr gleich darin. Zurückziehen geht dann, bis der Spielplan steht. Du bekommst eine Nachricht.</p>
      ) : (
        <p className="text-sm text-white/70">Einreichen heißt noch nicht, dass ihr dabei seid: Die Liga-Leitung prüft die Anmeldung, nimmt sie an oder lehnt sie ab und teilt Liga und Staffel zu. Du bekommst eine Nachricht.</p>
      )}
    </div>
  );
}

export default function LeagueApplyPage() {
  const { league, season } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState("");
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef(null);
  const backPath = `/liga/${league}/${season}`;
  useDocumentTitle("Mit Co-Team anmelden", "Anmeldung eines Co-Teams für die Liga.", { robots: "noindex, nofollow" });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/leagues/${league}/${season}/application`);
      setView(data);
      const free = (data.squads || []).filter(isSelectable);
      if (free.length === 1) setChosen((current) => current || free[0].squad_id);
    } catch {
      setMissing(true);
    }
  }, [league, season]);
  useEffect(() => { load(); }, [load]);

  const goTo = (next) => {
    setStep(next);
    // Wer mit Tastatur oder Vorlesehilfe arbeitet, landet beim neuen Schritt.
    requestAnimationFrame(() => heading.current?.focus());
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/leagues/${league}/${season}/applications`, { squad_id: chosen, rule_version_id: view.rules?.version_id, accept_rules: acceptRules, accept_privacy: acceptPrivacy });
      toast.success(submittedToast(data?.status));
      navigate(backPath);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      // Der Stand kann sich geändert haben (neue Fassung, Kader, Plätze): frisch laden, die Zustimmung gilt nur der Fassung, die sie gesehen hat.
      setAcceptRules(false);
      setAcceptPrivacy(false);
      await load();
      goTo(2);
    }
    setBusy(false);
  };

  const shell = (children) => (
    <PublicLayout>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Liga", to: "/liga" }, { label: "Season", to: backPath }, { label: "Anmelden" }]} className="mb-3" />
        {children}
      </div>
    </PublicLayout>
  );
  const back = <Link to={backPath} className={`${QUIET} mt-4`}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Zur Ligaseite</Link>;

  if (missing) {
    return shell(<div data-testid="apply-missing"><h1 className="font-heading text-3xl font-black uppercase">Liga nicht gefunden</h1><p className="mt-3 text-white/60">Diese Season gibt es nicht oder sie ist (noch) nicht sichtbar.</p>{back}</div>);
  }
  if (!view) return shell(<SkeletonDetailHeader label="Lade Anmeldung" />);
  if (view.application?.state !== "open") {
    return shell(<div data-testid="apply-closed"><h1 className="font-heading text-3xl font-black uppercase">Anmeldung nicht offen</h1><p className="mt-3 text-white/70">{view.season_problems?.[0] || "Für diese Season gibt es keine Selbstanmeldung."}</p>{back}</div>);
  }
  const rows = (view.squads || []).filter((row) => row.can_apply);
  if (!rows.length) {
    return shell(<div data-testid="apply-none"><h1 className="font-heading text-3xl font-black uppercase">Mit Co-Team anmelden</h1><p className="mt-3 text-white/70">{view.hint || "Anmelden dürfen Captain und Vertreter eines Co-Teams für dieses Spiel. Du bist bei keinem eingetragen."}</p>{back}</div>);
  }
  const row = rows.find((item) => item.squad_id === chosen);
  const blocked = Boolean((view.season_problems || []).length || row?.problems?.length);
  const canGoOn = step === 0 ? Boolean(row) : step === 1 ? !blocked : step === 2 ? acceptRules && acceptPrivacy && Boolean(view.rules) : false;
  const titles = ["Welches Co-Team meldest du an?", "Passt alles?", "Regeln und Datenschutz", "Alles richtig?"];

  return shell(
    <>
      <h1 className="font-heading text-3xl font-black uppercase">Mit Co-Team anmelden</h1>
      <Stepper step={step} />
      <section key={step} className="tls-apply-step mt-6" aria-labelledby="apply-step-title">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 id="apply-step-title" ref={heading} tabIndex={-1} className="font-heading text-xl font-bold uppercase outline-none">{titles[step]}</h2>
          <HelpLink thema="liga-captains" schritt={HELP_STEPS[step]} />
        </div>
        {step === 0 ? <SquadChoice rows={rows} chosen={chosen} onChoose={setChosen} /> : null}
        {step === 1 && row ? <CheckStep row={row} seasonProblems={view.season_problems || []} platform={view.platform} /> : null}
        {step === 2 && view.rules ? <ConsentStep rules={view.rules} privacy={view.privacy} acceptRules={acceptRules} acceptPrivacy={acceptPrivacy} onRules={setAcceptRules} onPrivacy={setAcceptPrivacy} /> : null}
        {step === 3 && row ? <Summary row={row} rules={view.rules} auto={Boolean(view.application?.auto_accept)} /> : null}
      </section>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {step === 0
          ? <Link to={backPath} className={QUIET}>Abbrechen</Link>
          : <button type="button" onClick={() => goTo(step - 1)} className={QUIET} data-testid="apply-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Zurück</button>}
        {step < 3
          ? <button type="button" disabled={!canGoOn} onClick={() => goTo(step + 1)} className={PRIMARY} data-testid="apply-next">Weiter</button>
          : <button type="button" disabled={busy} onClick={submit} className={PRIMARY} data-testid="apply-submit">{busy ? "Reiche ein …" : "Anmeldung einreichen"}</button>}
      </div>
    </>,
  );
}
