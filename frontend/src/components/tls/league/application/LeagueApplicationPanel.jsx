// Ligaseite (docs/LIGA.md, B.4, #2205): Fenster und freie Plätze für alle, Status und Knopf „Mit Co-Team anmelden“ für die eigenen Co-Teams.
// In der Solo-Liga (#1629, P2) „Als Spieler anmelden“ und der eigene Stand per Du.
// Andere Teams und ihre Anträge stehen hier nie. Die Schritte selbst stehen auf /liga/<liga>/<season>/anmelden.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, LogIn } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { HelpLink } from "@/components/tls/HelpLink";
import { useOptionalAuth } from "@/context/AuthContext";
import { APPLICATION_STATES, STATE_CLASS, afterStartLine, canStartApplication, canStartPersonApplication, isSoloApplication, seatsLine, teamStateLabel,
  windowLine } from "@/lib/leagueApplications";
import { carryLine } from "@/lib/leagueSuccessor";
import { rightLine, teamBadge, teamBadgeTone } from "@/lib/leagueStartRights";
import { StartRightBlock } from "./StartRightBlock";

// ``label``: eigener Text bei gleicher Farbe - das eigene Team liest „Angemeldet“ statt „Angenommen“ (#2348, ``teamStateLabel``).
// ``tone`` (#1627, F.2a): eigene Farbe bei eigenem Text - ein Startrecht mit offener Zusage ist noch nicht „grün“.
export function ApplicationStateBadge({ state, testId, label, tone }) {
  const info = APPLICATION_STATES[state] || APPLICATION_STATES.none;
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 rounded-sm border px-2 py-0.5 tls-type-label ${STATE_CLASS[tone] || STATE_CLASS[info.tone]}`}>{label || info.label}</span>
  );
}

function OwnSquadRow({ row, onWithdraw, onChanged }) {
  const application = row.application;
  // Startrecht (#1627, F.2a): Mit der Einstellung der Season sagt das Team zu - dann steht hier der Stand statt „automatisch dabei“.
  const startRight = application?.carry_over?.start_right || null;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-white/10 py-3 first:border-t-0" data-testid={`league-application-row-${row.squad_id}`}>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
          <ApplicationStateBadge state={row.state} label={teamBadge(application) || teamStateLabel(row.state, application)} tone={teamBadgeTone(application)}
            testId={`league-application-state-${row.squad_id}`} />
        </div>
        {["submitted", "in_review"].includes(row.state) ? <p className="mt-1 tls-type-small text-white/75">Die Liga-Leitung prüft die Anmeldung und meldet sich.</p> : null}
        {/* Aus der Vorgänger-Season übernommen (F.2, #1627): woher, welche Liga, bis wann Abmelden geht. */}
        {application?.carry_over ? <p className="mt-1 tls-type-small text-white/85" data-testid={`league-application-carry-${row.squad_id}`}>{carryLine(application.carry_over)}</p> : null}
        {application?.staffel ? <p className="mt-1 tls-type-small text-white/75">{application.staffel_left ? `Nicht mehr in ${application.staffel}: Austritt oder Disqualifikation.` : `Spielt in ${application.staffel}.`}</p> : null}
        {startRight ? <StartRightBlock applicationId={application.id} carry={application.carry_over} onChanged={onChanged} testPrefix="league-start-right" /> : null}
        {/* Mit Startrecht steht dessen Satz da (Frist, zugesagt, nachgerückt) - im Modus „automatisch“ hat es keinen, dann bleibt dieser. */}
        {row.state === "accepted" && !application?.staffel && !rightLine(application?.carry_over) ? (
          <p className="mt-1 tls-type-small text-white/75">{application?.carry_over ? "Ihr seid automatisch dabei. Die Staffel teilt die Liga-Leitung noch zu." : "Der Startplatz steht. Liga und Staffel teilt die Liga-Leitung noch zu."}</p>
        ) : null}
        {row.state === "waitlist" ? <p className="mt-1 tls-type-body text-white/75">Wird ein Platz frei, entscheidet die Liga-Leitung. Es rückt niemand von selbst nach.</p> : null}
        {application?.decision_reason ? <p className="mt-1 tls-type-small text-white/75 [overflow-wrap:anywhere]">Grund: {application.decision_reason}</p> : null}
        {/* Offene Punkte (#2313): Die Anmeldung läuft, gesperrt wird erst beim Check-in - bis dahin bleibt sichtbar, was fehlt.
            Der Kasten sagt zuerst, dass die Anmeldung zählt (#2322); die Folge beim Spiel steht im Satz vom Server. */}
        {application && (row.shortfall || row.warnings?.length) ? (
          <div className="mt-2 rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 p-2 tls-type-small text-white/80" data-testid={`league-application-open-${row.squad_id}`}>
            <p className="font-semibold text-white/90">Die Anmeldung zählt – fehlende Angaben halten euch nicht aus der Liga.</p>
            {row.shortfall ? <p className="mt-1 [overflow-wrap:anywhere]">{row.shortfall}</p> : null}
            {row.warnings?.length ? <ul className="mt-1 space-y-0.5 tls-type-small text-white/70">{row.warnings.map((text) => <li key={text} className="[overflow-wrap:anywhere]">{text}</li>)}</ul> : null}
            {row.warnings?.length ? <p className="mt-1 tls-type-small text-white/60">Wer bis zum ersten Spiel nichts im Profil nachträgt, kann nicht einchecken und nicht aufgestellt werden.</p> : null}
          </div>
        ) : null}
      </div>
      {application?.can_withdraw ? (
        <button type="button" onClick={() => onWithdraw(row)} data-testid={`league-application-withdraw-${row.squad_id}`}
          className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 tls-type-label">{application.carry_over ? "Abmelden" : "Zurückziehen"}</button>
      ) : null}
    </li>
  );
}

/** Solo-Liga (#1629, P2): die eigene Anmeldung als Spieler - dieselben Zustände wie beim Co-Team, per Du. */
function OwnPlayerRow({ row, onWithdraw }) {
  const application = row.application;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3" data-testid="league-application-player">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
          <ApplicationStateBadge state={row.state} label={teamStateLabel(row.state, application)} testId="league-application-player-state" />
        </div>
        {["submitted", "in_review"].includes(row.state) ? <p className="mt-1 tls-type-small text-white/75">Die Liga-Leitung prüft deine Anmeldung und meldet sich.</p> : null}
        {application?.staffel ? <p className="mt-1 tls-type-small text-white/75">{application.staffel_left ? `Nicht mehr in ${application.staffel}: Austritt oder Disqualifikation.` : `Du spielst in ${application.staffel}.`}</p> : null}
        {row.state === "accepted" && !application?.staffel ? <p className="mt-1 tls-type-small text-white/75">Dein Startplatz steht. Liga und Staffel teilt die Liga-Leitung noch zu.</p> : null}
        {row.state === "waitlist" ? <p className="mt-1 tls-type-body text-white/75">Wird ein Platz frei, entscheidet die Liga-Leitung. Es rückt niemand von selbst nach.</p> : null}
        {application?.decision_reason ? <p className="mt-1 tls-type-small text-white/75 [overflow-wrap:anywhere]">Grund: {application.decision_reason}</p> : null}
        {application && row.warnings?.length ? (
          <div className="mt-2 rounded-sm border border-brand/30 bg-brand/5 p-2 tls-type-small text-white/80" data-testid="league-application-player-open">
            <p className="font-semibold text-white/90">Deine Anmeldung zählt – fehlende Angaben halten dich nicht aus der Liga.</p>
            <ul className="mt-1 space-y-0.5 tls-type-small text-white/70">{row.warnings.map((text) => <li key={text} className="[overflow-wrap:anywhere]">{text}</li>)}</ul>
            <p className="mt-1 tls-type-small text-white/60">Trag es bis zum ersten Spiel im Profil nach, sonst kannst du nicht einchecken.</p>
          </div>
        ) : null}
      </div>
      {application?.can_withdraw ? (
        <button type="button" onClick={() => onWithdraw(row)} data-testid="league-application-player-withdraw"
          className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 tls-type-label">Zurückziehen</button>
      ) : null}
    </li>
  );
}

export function LeagueApplicationPanel({ leagueSlug, seasonSlug, block }) {
  const user = useOptionalAuth()?.user || null;
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const base = `/leagues/${leagueSlug}/${seasonSlug}`;
  const applyPath = `/liga/${leagueSlug}/${seasonSlug}/anmelden`;
  const signedIn = Boolean(user);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const { data } = await api.get(`${base}/application`);
      setView(data);
    } catch {
      setView(null); // Der öffentliche Teil bleibt stehen.
    }
  }, [base, signedIn]);
  useEffect(() => { load(); }, [load]);

  const solo = isSoloApplication(view, block);
  const withdraw = async (row) => {
    // Eine automatische Zuteilung zieht das Team selbst zurück, solange der Spielplan nicht steht (#2348) - dann fällt auch der Platz in der Staffel weg.
    const staffel = row.application?.staffel ? ` und spielt nicht mehr in ${row.application.staffel}` : "";
    const carried = Boolean(row.application?.carry_over);
    const sure = await confirm(solo
      // Solo-Liga (#1629, P2): Die Person zieht ihre eigene Anmeldung zurück.
      ? { title: "Anmeldung zurückziehen?", description: `Du bist dann nicht mehr angemeldet${row.application?.staffel ? ` und spielst nicht mehr in ${row.application.staffel}` : ""}. Solange das Fenster offen ist, kannst du neu einreichen.`, confirmLabel: "Zurückziehen" }
      : carried
        ? { title: "Von der Season abmelden?", description: `${row.display_name} spielt dann nicht in dieser Season${staffel}. Der Platz geht an die Warteliste oder neue Anmeldungen.`, confirmLabel: "Abmelden", tone: "danger" }
        : { title: "Anmeldung zurückziehen?", description: `${row.display_name} ist dann nicht mehr angemeldet${staffel}. Solange das Fenster offen ist, kannst du neu einreichen.`, confirmLabel: "Zurückziehen" });
    if (!sure) return;
    try {
      await api.post(`${base}/applications/${row.application.id}/withdraw`, {});
      toast.success(carried ? "Abgemeldet. Der Platz ist frei." : "Anmeldung zurückgezogen.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    await load();
  };

  const current = view?.application || block || {};
  const seats = seatsLine(current);
  // Nachmeldung (Entscheidung Nr. 180): Das Fenster geht über den Season-Start hinaus - solange es noch nicht vorbei ist, sagt es ein Satz.
  const afterStart = current.state && current.state !== "closed" ? afterStartLine(current.closes_at, current.season_starts_at) : "";
  // Ohne Anmeldefenster (Season aus dem Vorgänger übernommen, F.2): nur die eigenen Co-Teams mit Antrag - sonst gibt es hier nichts zu tun.
  const rows = (view?.squads || []).filter((row) => current.state || row.application);
  // Solo-Liga (#1629, P2): statt der Co-Teams die eigene Anmeldung als Spieler - sobald es eine gibt.
  const player = solo && view?.player && (current.state || view.player.application) ? view.player : null;
  if (!current.state && !rows.length && !player) return null;
  const problems = rows.some((row) => row.can_apply) || player ? view?.season_problems || [] : [];
  const playerProblems = player && !player.application ? player.problems || [] : [];
  return (
    <section className="tls-league-application mt-10 rounded-sm border border-white/10 bg-[#121212] p-4 md:p-5" aria-labelledby="league-application-title" data-testid="league-application">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Das „?“ steht neben der Überschrift, nicht darin - sie benennt den Abschnitt (aria-labelledby). */}
          <div className="flex items-center gap-2">
            <h2 id="league-application-title" className="inline-flex items-center gap-2 tls-type-section">
              <ClipboardCheck className="h-5 w-5 tls-league-accent" aria-hidden="true" /> Anmeldung
            </h2>
            <HelpLink thema="liga-captains" schritt={solo ? "als-spieler-anmelden" : "anmeldung-starten"} />
          </div>
          {solo ? <p className="mt-1 tls-type-small text-white/70" data-testid="league-application-solo">Solo-Liga: Du meldest dich selbst als Spieler an, 1 gegen 1.</p> : null}
          <p className="mt-1 tls-type-small text-white/85" data-testid="league-application-window">
            {current.state ? windowLine(current) : "Aus der Vorgänger-Season übernommen: Eure Co-Teams sind automatisch dabei."}
          </p>
          {afterStart ? <p className="mt-0.5 tls-type-small text-white/70" data-testid="league-application-after-start">{afterStart}</p> : null}
          {seats ? <p className="mt-0.5 tls-type-small text-white/70" data-testid="league-application-seats">{seats}</p> : null}
          {current.entry_policy === "members" ? <p className="mt-0.5 tls-type-small text-white/70" data-testid="league-application-policy">Nur für Vereinsmitglieder.</p> : null}
          {current.waitlist && current.waitlist_note ? <p className="mt-0.5 tls-type-body text-white/60 [overflow-wrap:anywhere]" data-testid="league-application-waitlist-note">{current.waitlist_note}</p> : null}
        </div>
        {!solo && canStartApplication(view) ? (
          <Link to={applyPath} data-testid="league-application-start"
            className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center rounded-sm px-4 py-2.5 tls-type-label">Mit Co-Team anmelden</Link>
        ) : null}
        {solo && canStartPersonApplication(view) ? (
          <Link to={applyPath} data-testid="league-application-start-player"
            className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center rounded-sm px-4 py-2.5 tls-type-label">Als Spieler anmelden</Link>
        ) : null}
        {!signedIn && current.state === "open" ? (
          <Link to={`/login?next=${encodeURIComponent(applyPath)}`} data-testid="league-application-login"
            className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 py-2.5 tls-type-label">
            <LogIn className="h-4 w-4" aria-hidden="true" /> {solo ? "Anmelden, dann mitspielen" : "Anmelden, dann Team melden"}
          </Link>
        ) : null}
      </div>
      {problems.length || playerProblems.length ? (
        <ul className="mt-3 space-y-1 tls-type-small text-warn" data-testid="league-application-season-problems">
          {[...problems, ...playerProblems].map((text) => <li key={text} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{text}</span></li>)}
        </ul>
      ) : null}
      {player && player.application ? (
        <ul className="mt-3 border-t border-white/10" aria-label="Deine Anmeldung" data-testid="league-application-own-player">
          <OwnPlayerRow row={player} onWithdraw={withdraw} />
        </ul>
      ) : null}
      {view?.hint ? <p className="mt-3 tls-type-body text-white/70" data-testid="league-application-hint">{view.hint}</p> : null}
      {rows.length ? (
        <ul className="mt-3" aria-label="Deine Co-Teams" data-testid="league-application-squads">
          {rows.map((row) => <OwnSquadRow key={row.squad_id} row={row} onWithdraw={withdraw} onChanged={load} />)}
        </ul>
      ) : null}
    </section>
  );
}
