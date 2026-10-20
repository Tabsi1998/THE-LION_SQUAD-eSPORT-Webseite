import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, ChevronDown, Clock, MapPin, Receipt, X } from "lucide-react";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { StepBar, tournamentSteps } from "@/components/tls/StepBar";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { formatWhen } from "@/lib/datetime";
import { gameLabel } from "@/lib/gameLabels";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { formatCents, previewQuote, startFeeSummary } from "@/lib/pricing";
import { checkInWindow, placeLine, rulesSummary } from "@/lib/registrationSheet";

// Bestätigungs-Blatt der Turnier-Anmeldung (#1261): jede Anmeldung auf der Website geht hierüber - Einzel und Team, mit
// und ohne Startgeld, mit und ohne Spieler-Kennungen, auf der Turnierseite und in der schlanken Vor-Ort-Ansicht. Oben
// die Zusammenfassung (Start, Check-in, Ort, Startgeld, Regeln in drei Sätzen mit „Alle Regeln“), darunter, was die
// Anmeldung braucht (Team, Kennungen, Kostenübernahme). Erst „Verbindlich anmelden“ meldet an; Abbrechen, Schließen,
// Escape und ein Tipp daneben melden nicht an. Am Handy ein Blatt von unten mit festem Knopf, ab 640 px ein Fenster.

function Fact({ icon: Icon, label, testId, children }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</dt>
        <dd className="mt-0.5 text-sm text-white break-words" data-testid={testId}>{children}</dd>
      </div>
    </div>
  );
}

export function RegistrationSheet({ tournament, user, myTeams = [], loading, error, onClose, onSubmit }) {
  const titleId = useId();
  const game = tournament.game || {};
  const fields = game.effective_player_id_fields || game.player_id_fields || [];
  const sourceSlug = game.identity_game_slug || game.slug;
  const needsTeam = (tournament.team_mode || "solo") !== "solo";
  const manageableTeams = myTeams.filter((team) => team.can_manage || ["leader", "co_leader"].includes(team.my_role));
  const initial = {
    ...((user?.game_ids || {})[sourceSlug] || {}),
    ...((user?.game_ids || {})[game.slug] || {}),
  };
  const [playerIds, setPlayerIds] = useState(initial);
  const [teamId, setTeamId] = useState(manageableTeams[0]?.id || "");
  const [rulesOpen, setRulesOpen] = useState(false);
  // Startgeld (#319): Summe vor dem Absenden, wählbare Positionen als Haken, Kostenübernahme als Pflicht.
  const offer = tournament.offer || null;
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const seats = needsTeam ? Math.max(1, Number(tournament.team_size) || 1) : 1;
  const quote = offer ? previewQuote(offer, { seats, selected: selectedPositions }) : null;
  const dialogRef = useModalBehavior(true, () => onClose?.());
  const set = (key, value) => setPlayerIds((cur) => ({ ...cur, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ playerIds, teamId: needsTeam ? teamId : null, acceptCosts, selectedPositions });
  };

  const checkIn = checkInWindow(tournament);
  // Die schlanke Vor-Ort-Ansicht (#1592) bekommt die Regeln erst nach der Anmeldung - dann sagt das Blatt das.
  const noRules = tournament.onsite_view
    ? "Es gelten die Turnierregeln und Fair Play – alle Regeln siehst du nach der Anmeldung auf dieser Seite."
    : "Für dieses Turnier sind keine eigenen Regeln hinterlegt – es gelten Fair Play und die Anweisungen der Turnierleitung.";
  const rules = rulesSummary(tournament.rules);
  const fee = offer?.enabled ? startFeeSummary(offer, { teamMode: tournament.team_mode || "solo", teamSize: tournament.team_size }) : "";
  const lead = needsTeam
    ? "Wähle das Team aus, das du als Leader oder Co-Leader anmelden möchtest."
    : fields.length
      ? `${gameLabel(game)} benötigt Spieler-IDs${sourceSlug !== game.slug ? ` aus ${game.identity_game_name || "dem Hauptspiel"}` : ""}.`
      : `Du meldest dich als ${user?.display_name || user?.username || "du"} an.`;

  return (
    <div
      className="tls-register-backdrop fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="register-sheet-backdrop"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="tls-register-sheet flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-md border border-white/10 bg-[#0F0F10] shadow-2xl shadow-black/60 focus:outline-none sm:rounded-sm"
        data-testid="register-sheet"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 pb-4 pt-3 sm:pt-4">
          <div className="min-w-0">
            {/* Griff am Handy: zeigt, dass es ein Blatt ist. */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{needsTeam ? "Team-Anmeldung" : "Anmeldung"}</div>
            <h2 id={titleId} className="mt-0.5 font-heading text-2xl font-black uppercase leading-tight break-words">{tournament.title}</h2>
            <p className="mt-1 text-sm text-white/60">{lead}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="tls-hit shrink-0 p-2 text-white/50 hover:text-white" data-testid="register-sheet-close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            <StepBar steps={tournamentSteps(tournament)} current={0} testId="tournament-register-steps" />

            <dl className="grid gap-3 rounded-sm border border-white/10 bg-[#121212] p-4 sm:grid-cols-2" data-testid="register-sheet-summary">
              <Fact icon={Calendar} label="Start" testId="register-sheet-start">{formatWhen(tournament.start_date, { fallback: "Termin folgt" })}</Fact>
              {checkIn ? <Fact icon={Clock} label="Check-in" testId="register-sheet-checkin">{checkIn}</Fact> : null}
              <Fact icon={MapPin} label="Ort" testId="register-sheet-place">{placeLine(tournament)}</Fact>
              {fee ? <Fact icon={Receipt} label="Startgeld" testId="register-sheet-fee">{fee}</Fact> : null}
            </dl>

            <section aria-label="Regeln" className="text-sm" data-testid="register-sheet-rules">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Regeln kurz</div>
              <p className="mt-1 text-white/80">
                {rules || noRules}
              </p>
              {tournament.rules ? (
                <>
                  <button
                    type="button"
                    onClick={() => setRulesOpen((open) => !open)}
                    aria-expanded={rulesOpen}
                    className="tls-hit mt-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"
                    data-testid="register-sheet-rules-all"
                  >
                    {rulesOpen ? "Regeln ausblenden" : "Alle Regeln"}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${rulesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {rulesOpen ? (
                    <div className="prose-cms mt-2 max-h-64 overflow-y-auto rounded-sm border border-white/10 bg-[#121212] p-4 text-sm" data-testid="register-sheet-rules-full" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(tournament.rules) }} />
                  ) : null}
                </>
              ) : null}
            </section>

            {needsTeam && (
              <label className="block">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60">Team *</div>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  required
                  className="min-h-11 w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm"
                >
                  {manageableTeams.map((team) => <option key={team.id} value={team.id}>[{team.tag}] {team.name}</option>)}
                </select>
                {manageableTeams.length === 0 && (
                  <div className="mt-2 text-xs text-[#FF3B30]">Du bist aktuell bei keinem Team als Leader oder Co-Leader eingetragen.</div>
                )}
              </label>
            )}
            {fields.map((field) => (
              <label key={field.key} className="block">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60">{field.label}{field.required !== false ? " *" : ""}</div>
                <input
                  value={playerIds[field.key] || ""}
                  onChange={(e) => set(field.key, e.target.value)}
                  required={field.required !== false}
                  placeholder={field.help_text || field.label}
                  className="min-h-11 w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm"
                />
              </label>
            ))}
            {offer && (
              <div className="space-y-2 rounded-sm border border-[#FFD700]/40 p-3" data-testid="tournament-register-costs">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Startgeld</div>
                {offer.positions.some((position) => position.optional) && (
                  <div className="space-y-1">
                    {offer.positions.filter((position) => position.optional).map((position) => (
                      <label key={position.key} className="flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" checked={selectedPositions.includes(position.key)} onChange={(e) => setSelectedPositions((current) => (e.target.checked ? [...current, position.key] : current.filter((key) => key !== position.key)))} className="h-5 w-5 shrink-0 accent-[#29B6E8]" data-testid={`tournament-offer-option-${position.key}`} />
                        <span>{position.label} <span className="text-white/50">{formatCents(position.amount_cents, offer.currency)} {position.basis === "per_person" ? "je Spieler" : position.basis === "per_team" ? "je Team" : "je Anmeldung"}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                {quote && !quote.free && (
                  <div className="flex items-baseline justify-between gap-3 text-sm" data-testid="tournament-quote">
                    <span className="text-white/65">{needsTeam ? `Summe für ein Team mit ${seats} Spielern` : "Summe"}</span>
                    <strong className="font-heading text-xl text-white">{formatCents(quote.total_cents, quote.currency)}</strong>
                  </div>
                )}
                {needsTeam && offer.positions.some((position) => position.basis === "per_person") && (
                  <div className="text-xs text-white/45">Gezählt wird der Roster bei der Freigabe – fehlen noch Spieler, gilt die Teamgröße.</div>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={acceptCosts} onChange={(e) => setAcceptCosts(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#29B6E8]" data-testid="tournament-accept-costs" />
                  <span>{needsTeam ? "Ich übernehme das Startgeld für das Team (Rechnung an mich)." : "Ich übernehme das Startgeld (Rechnung an mich)."}<br /><span className="text-xs text-white/45">Bezahlt wird erst mit der verbindlichen Teilnahme; die Rechnung kommt in dein Konto unter „Meine Rechnungen“.</span></span>
                </label>
              </div>
            )}
            {error && <AuthFormAlert id="tournament-registration-error">{error}</AuthFormAlert>}
          </div>

          {/* Fester Fuß: am Handy bleibt „Verbindlich anmelden“ unten stehen, auch wenn der Inhalt scrollt. */}
          <div className="border-t border-white/10 bg-[#0F0F10] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <p className="mb-3 text-xs text-white/55" data-testid="register-sheet-consent">
              Mit der Anmeldung akzeptierst du die Turnierregeln und den <Link to="/privacy" className="underline hover:text-white">Datenschutz</Link>.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="tls-btn tls-btn--quiet min-h-11 rounded-sm px-4 text-xs font-bold uppercase tracking-wider" data-testid="register-sheet-cancel">Abbrechen</button>
              <button
                type="submit"
                disabled={loading || (needsTeam && !teamId) || (offer && !acceptCosts)}
                data-testid="tournament-register-submit"
                className="tls-btn tls-btn--primary min-h-12 rounded-sm px-5 text-sm font-bold uppercase tracking-wider disabled:opacity-50 sm:min-h-11 sm:text-xs"
              >
                {loading ? "Sendet…" : quote && !quote.free ? `Verbindlich anmelden · ${formatCents(quote.total_cents, quote.currency)}` : "Verbindlich anmelden"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
