// Bausteine der Season-Übersicht (#2268): was gespielt wird, Ablauf, Sperrliste, Regelwerk, Platzhalter vor der Einteilung und
// Liga N mit ihren Staffeln. Reine Anzeige aus GET /api/leagues/<liga>/<season> - Helfer in lib/leagueSeasonPage.js.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CalendarClock, ChevronDown, Coffee, FileText, Gamepad2, ScrollText, Swords, Timer } from "lucide-react";
import { API } from "@/lib/api";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { StaggerIn } from "@/components/tls/motion";
import { LoadoutBansView, EquipmentThumb } from "@/components/tls/league/LoadoutBansView";
import { LeaguePrizes } from "@/components/tls/league/public/LeagueLook";
import { StaffelPanel } from "@/components/tls/league/public/StaffelPanel";
import { blockedLines, seasonPeriod, weekSpan } from "@/lib/leaguePage";
import { platformLines } from "@/lib/leaguePlatform";
import { formatFacts, mapOrder, nextSteps, playModes, pointsLines, scheduleLines, weeksText } from "@/lib/leagueSeasonPage";
import { publicGroups } from "@/lib/loadoutBans";
import { dayNoon, viennaDate } from "@/lib/vienna";

function SectionTitle({ id, icon: Icon, children, aside }) {
  return (
    <div className="tls-season-title">
      <h2 id={id} className="flex items-center gap-2 font-heading text-2xl font-black uppercase md:text-3xl">
        <Icon className="h-5 w-5 tls-league-accent" aria-hidden="true" /> {children}
      </h2>
      {aside}
    </div>
  );
}

/** „Was gespielt wird“: Format, Modi mit Symbol und Regel in Klartext, Map-Reihenfolge als Leiste, Plattform. */
export function SeasonPlay({ league, season, pool, platform }) {
  const modes = playModes(season, league?.game, pool);
  const order = mapOrder(season, league?.game, pool);
  const facts = formatFacts(season);
  const platforms = platformLines(platform);
  return (
    <section className="tls-season-section" aria-labelledby="season-play-title" data-testid="season-play">
      <SectionTitle id="season-play-title" icon={Swords}>Was gespielt wird</SectionTitle>
      <dl className="tls-season-facts" data-testid="season-format">
        {league?.game?.name ? (
          <div className="tls-season-fact"><dt>Spiel</dt><dd>{league.game.name}</dd></div>
        ) : null}
        {facts.map((fact) => <div key={fact.key} className="tls-season-fact" data-testid={`season-format-${fact.key}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      {modes.length ? (
        <StaggerIn as="ul" className="tls-season-modes" aria-label="Modi">
          {modes.map((mode) => (
            <li key={mode.mode} className="tls-season-mode" data-testid={`season-mode-${mode.mode}`}>
              <span className="tls-season-mode__icon"><ModeIcon src={mode.icon_url} label={mode.label} size="lg" /></span>
              <span className="min-w-0">
                <span className="block font-heading text-lg font-bold uppercase leading-tight [overflow-wrap:anywhere]">{mode.label}</span>
                <span className="mt-0.5 block text-sm text-white/70" data-testid={`season-mode-${mode.mode}-rule`}>
                  {mode.rule || "Regel steht im Regelwerk"}
                </span>
                {mode.maps ? <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">{mode.maps} {mode.maps === 1 ? "Map" : "Maps"} im Pool</span> : null}
              </span>
            </li>
          ))}
        </StaggerIn>
      ) : null}
      {order.length ? (
        <div className="mt-6">
          <p className="tls-league-subhead">Reihenfolge je Serie</p>
          <ol className="tls-season-order tls-swipe" data-testid="season-map-order">
            {order.map((row) => (
              <li key={row.position} className="tls-season-order__map" style={{ "--tls-i": row.position - 1 }} title={`Map ${row.position}: ${row.label}`}
                data-testid={`season-map-order-${row.position}`}>
                <span className="tls-season-order__nr">Map {row.position}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <ModeIcon src={row.icon_url} label={row.label} size="sm" />
                  <span className="tls-season-order__label">{row.label}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {platforms.length ? (
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/70" data-testid="season-platform">
          {platforms.map((line) => <li key={line} className="flex items-center gap-1.5 [overflow-wrap:anywhere]"><Gamepad2 className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" /> {line}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function Fact({ icon: Icon, label, children, testId }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
        <Icon className="h-3.5 w-3.5 tls-league-accent" aria-hidden="true" /> {label}
      </dt>
      <dd className="mt-1 text-sm text-white/85">{children}</dd>
    </div>
  );
}

/** Kopf-Fakten unter dem Titel: nur, was sonst nirgends steht (#2268, jede Angabe an einer Stelle) - Zeitraum, Spielwochen, Pausen.
 *  Best of und Teamgröße stehen in „Was gespielt wird“, Standardtermin und Punkte im „Ablauf“. */
export function SeasonHeadFacts({ season }) {
  const blocked = blockedLines(season);
  return (
    <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3" data-testid="league-facts">
      <Fact icon={CalendarClock} label="Zeitraum" testId="league-fact-period">{seasonPeriod(season)}</Fact>
      <Fact icon={Timer} label="Spielwochen" testId="league-fact-week">
        {weeksText(season) || "–"}<span className="block text-white/55">{weekSpan(season)}</span>
      </Fact>
      <Fact icon={Coffee} label="Pausen" testId="league-fact-breaks">
        {blocked.length ? blocked.map((row) => <span key={row.key} className="block">{row.label} {row.range}</span>) : "keine"}
      </Fact>
    </dl>
  );
}

/** Ablauf: Termine in Klartext (Regelwerk § 7) und Punkte und Gleichstand (E.1). */
export function SeasonFlow({ season }) {
  const lines = scheduleLines(season);
  const points = pointsLines(season);
  return (
    <section className="tls-season-section" aria-labelledby="season-flow-title" data-testid="season-flow">
      <SectionTitle id="season-flow-title" icon={CalendarClock}>Ablauf</SectionTitle>
      <div className="tls-season-flow">
        <ol className="tls-season-rules" aria-label="Termine">
          {lines.map((line) => (
            <li key={line.key} className="tls-season-rule" data-testid={`season-flow-${line.key}`}>
              <span className="tls-season-rule__title">{line.title}</span>
              <span className="text-sm text-white/80">{line.text}</span>
            </li>
          ))}
        </ol>
        <div className="tls-season-points" data-testid="season-points">
          <p className="tls-season-rule__title">Punkte und Gleichstand</p>
          {points.map((line) => <p key={line} className="mt-1 text-sm text-white/80">{line}</p>)}
        </div>
      </div>
    </section>
  );
}

/** Sperrliste mit Bildern (C.4), aufklappbar - der Kasten zeigt vorab die ersten Bilder und die Zahl. */
export function SeasonBans({ list, rulesUrl }) {
  const [open, setOpen] = useState(false);
  if (!list?.entries?.length) return null;
  const { categories, weapons } = publicGroups(list);
  const entries = categories.flatMap((category) => category.sections.flatMap((section) => section.entries));
  const count = entries.length + weapons.length;
  if (!count) return null;
  const preview = [...entries, ...weapons].filter((row) => row.image_url).slice(0, 4);
  return (
    <section className="tls-season-section" aria-labelledby="season-bans-title" data-testid="season-bans">
      <details className="tls-season-bans" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="tls-season-bans__summary" data-testid="season-bans-toggle">
          <span className="min-w-0">
            <span id="season-bans-title" className="flex items-center gap-2 font-heading text-2xl font-black uppercase md:text-3xl">
              <Ban className="h-5 w-5 text-warn" aria-hidden="true" /> Sperrliste
            </span>
            <span className="mt-1 block text-sm text-white/60">
              {count} {count === 1 ? "Sperre" : "Sperren"} – alles andere ist erlaubt.
            </span>
          </span>
          {preview.length ? (
            <span className="tls-season-bans__preview" aria-hidden="true">
              {preview.map((row) => <EquipmentThumb key={row.item_id || row.name} src={row.image_url} sizes="80px" className="w-16" />)}
            </span>
          ) : null}
          <ChevronDown className="tls-season-bans__chevron h-5 w-5 shrink-0 text-white/50" aria-hidden="true" />
        </summary>
        {open ? (
          <div className="tls-season-bans__body">
            <LoadoutBansView list={list} title="Sperrliste" hideTitle className="" testId="league-loadout-bans" />
            {rulesUrl ? (
              <p className="mt-6 text-sm text-white/60">Verbindlich ist das <Link to={rulesUrl} className="text-brand hover:text-white">Regelwerk</Link> – dort steht die Liste mit Version.</p>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}

/** Regelwerk (#1646) mit Version, Stand und PDF; offene Zustimmung des eigenen Co-Teams sagt es. */
export function SeasonRulesCard({ rules }) {
  return (
    <section className="tls-league-rules tls-season-rulescard" data-testid="league-rules-link">
      <div className="min-w-0">
        <Link to={rules.url} className="inline-flex items-center gap-2 font-heading text-xl font-bold uppercase hover:underline">
          <ScrollText className="h-5 w-5 tls-league-accent" aria-hidden="true" /> Regelwerk
        </Link>
        <p className="mt-1 text-sm text-white/70" data-testid="league-rules-version">{rules.label} · gültig ab {viennaDate(dayNoon(rules.valid_from), { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
        {rules.consent_open ? <p className="mt-1 text-sm font-semibold text-warn" data-testid="league-rules-consent">Dein Co-Team hat noch nicht zugestimmt. Ohne Zustimmung geht vor dem Spiel kein Check-in.</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={rules.url} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">
          <ScrollText className="h-4 w-4" aria-hidden="true" /> Lesen
        </Link>
        <a href={`${API}${rules.pdf_url.replace(/^\/api/, "")}`} target="_blank" rel="noopener noreferrer" data-testid="league-rules-pdf"
          className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">
          <FileText className="h-4 w-4" aria-hidden="true" /> PDF
        </a>
      </div>
    </section>
  );
}

/** Vor der Einteilung (#2268): was als Nächstes passiert statt einer leeren Zeile. */
export function SeasonPlaceholder({ season, application }) {
  const steps = nextSteps(season, application);
  return (
    <section className="tls-season-placeholder" aria-labelledby="season-placeholder-title" data-testid="league-no-divisions">
      <h2 id="season-placeholder-title" className="font-heading text-2xl font-black uppercase md:text-3xl">Die Ligen werden eingeteilt</h2>
      <p className="mt-2 max-w-2xl text-sm text-white/70">
        Sobald die Liga-Leitung die Teams eingeteilt hat, stehen hier die Tabellen jeder Liga und Staffel – mit dem aktuellen Spieltag.
      </p>
      <StaggerIn as="ol" className="tls-apply-steps mt-6" aria-label="So geht es weiter">
        {steps.map((step, index) => (
          <li key={step.key} className="tls-apply-steps__item" data-state={step.state} data-testid={`season-step-${step.key}`}>
            <span className="tls-apply-steps__mark" aria-hidden="true">{index + 1}</span>
            <span className="tls-apply-steps__label">{step.title}</span>
            <span className="mt-1 block text-center text-xs text-white/60">{step.text}</span>
          </li>
        ))}
      </StaggerIn>
    </section>
  );
}

/** Liga N mit Staffel-Reitern; jede Staffel zeigt Tabelle und aktuellen Spieltag. */
export function Division({ division, leagueSlug, seasonSlug, hash, topLevel, order }) {
  const staffeln = division.staffeln || [];
  const fromHash = staffeln.find((row) => hash === `#staffel-${row.slug}` || hash === `#staffel-${row.tournament_id}`);
  const [active, setActive] = useState(() => (fromHash || staffeln[0])?.tournament_id || null);
  const current = staffeln.find((row) => row.tournament_id === active) || staffeln[0];
  const tabs = useRef([]);
  const tabbed = staffeln.length > 1;
  const tabId = (row) => `liga-${division.level}-tab-${row.staffel}`;
  const panelId = `liga-${division.level}-staffel`;
  // Reiter wie üblich (WAI-ARIA): Pfeile links/rechts wechseln und setzen den Fokus mit, Pos1/Ende springen.
  const onTabKey = (event, index) => {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: staffeln.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + staffeln.length) % staffeln.length;
    setActive(staffeln[next].tournament_id);
    tabs.current[next]?.focus();
  };
  return (
    <section className="tls-season-division scroll-mt-24" aria-labelledby={`liga-${division.level}`} data-testid={`league-division-${division.level}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <h2 id={`liga-${division.level}`} className="font-heading text-2xl md:text-3xl font-black uppercase [overflow-wrap:anywhere]">{division.label}</h2>
        {tabbed ? (
          <div className="tls-season-tabs tls-swipe" role="tablist" aria-label={`Staffeln in ${division.label}`}>
            {staffeln.map((row, index) => {
              const selected = row.tournament_id === current?.tournament_id;
              return (
                <button key={row.tournament_id} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab"
                  id={tabId(row)} aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(row.tournament_id)} onKeyDown={(event) => onTabKey(event, index)}
                  data-testid={`league-staffel-tab-${row.staffel}`}
                  className={`tls-btn tls-league-tab ${selected ? "tls-btn--secondary" : "tls-btn--quiet"} shrink-0 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider`}>
                  Staffel {row.staffel}
                </button>
              );
            })}
          </div>
        ) : current ? <span className="text-xs font-bold uppercase tracking-wider text-white/45">Staffel {current.staffel}</span> : null}
      </div>
      {/* Eigene Gewinne dieser Liga N (#2107) - sonst gilt, was oben für die Season steht. */}
      <LeaguePrizes prizes={division.prizes} title={`Um was ${division.label} spielt`} compact testId={`league-prizes-${division.level}`} />
      <div className="mt-6 scroll-mt-24" id={tabbed ? panelId : current ? `staffel-${current.slug || current.tournament_id}` : undefined}
        {...(tabbed && current ? { role: "tabpanel", "aria-labelledby": tabId(current), tabIndex: 0 } : {})}>
        {/* Sprungziele aus der Teamseite (#staffel-…): je Staffel eines, die Reiter wählen beim Laden die richtige. */}
        {tabbed ? staffeln.map((row) => <span key={row.tournament_id} id={`staffel-${row.slug || row.tournament_id}`} className="block scroll-mt-24" />) : null}
        {current
          ? <StaffelPanel key={current.tournament_id} leagueSlug={leagueSlug} seasonSlug={seasonSlug} staffel={current} topLevel={topLevel} order={order} />
          : <p className="text-sm text-white/55">Die Staffeln dieser Liga werden gerade eingeteilt.</p>}
      </div>
    </section>
  );
}
