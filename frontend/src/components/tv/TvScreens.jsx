import { useRef } from "react";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { checkInView, pauseClock, pauseView, registrationView } from "@/lib/tvScreens";
import { charsPerLine, wrapLines } from "@/lib/tvType";
import { useTv, useTvArea } from "./TvScreen";
import { useSecondTick } from "./TvTreeNode";

// Pause-, Check-in- und Anmelde-Bildschirm (#1123), gestaltet wie in der TV-Vorschau. Die Pause zählt bis „Weiter um
// 14:30“ herunter und sagt, was danach kommt; der Check-in zeigt „12 von 16 da“ mit Balken und alle Namen mit Haken; die
// Anmeldung einen großen QR-Code (aus 3 Metern scanbar), den Termin und die freien Plätze. Ein neuer Haken erscheint
// sofort - die Seite lädt nach, sobald sich Status oder Check-in ändern.

/** Die Pause: „Kurze Pause · Weiter um 14:30“, großer Countdown, darunter, was danach kommt. */
export function TvPauseScreen({ tournament, matches = [] }) {
  const second = useSecondTick();
  const view = pauseView(tournament, matches, second * 1000);
  // Der Balken zeigt, wie viel von der Pause noch übrig ist - gemessen ab dem Moment, ab dem dieser TV die Uhrzeit kennt.
  const firstRef = useRef({ until: null, seconds: null });
  if (firstRef.current.until !== view.until) firstRef.current = { until: view.until, seconds: view.seconds };
  const total = firstRef.current.seconds || 0;
  const share = view.state === "running" && total ? Math.min(1, view.seconds / total) : 0;
  return (
    <section className="tv-screen-pause" data-testid="tv-pause-screen" data-state={view.state}>
      <div className="tv-kicker tv-t-head tv-gold">{view.state === "over" ? "Pause vorbei" : "Kurze Pause"}</div>
      <div className="tv-screen-pause__headline font-heading" data-testid="tv-pause-headline">{view.headline}</div>
      {view.state === "running" ? (
        <>
          <div className="tv-screen-pause__count" data-testid="tv-pause-countdown"><small className="tv-t-head">noch</small><span className="font-display">{pauseClock(view.seconds)}</span></div>
          <div className="tv-screen-pause__line" role="presentation"><i style={{ width: `${(share * 100).toFixed(2)}%` }} /></div>
        </>
      ) : null}
      {view.next ? <div className="tv-screen-pause__next tv-t-head" data-testid="tv-pause-next">Danach: {view.next.text}</div> : null}
    </section>
  );
}

function Check({ present }) {
  return <span className={`tv-check__mark ${present ? "tv-check__mark--ok" : ""}`} aria-hidden="true" />;
}

/**
 * Der Check-in: links „12 von 16 da“ mit Balken und dem Hinweis, rechts alle Namen mit Haken. Passen nicht alle Namen,
 * stehen die Fehlenden zuerst und der Rest als „+ N weitere da“ - es wird nichts abgeschnitten.
 */
export function TvCheckInScreen({ tournament, registrations = [] }) {
  const { scale } = useTv();
  const view = checkInView(tournament, registrations);
  const [gridRef, area, trim] = useTvArea(`${view.people.length}:${view.present}`);
  // Spalten nach Fläche; die Fehlenden zuerst, damit man sieht, auf wen noch gewartet wird.
  const columns = area ? Math.max(1, Math.min(5, Math.floor((area.w + 1) / 25))) : 4;
  const ordered = [...view.people.filter((person) => !person.present), ...view.people.filter((person) => person.present)];
  const width = area ? (area.w - (columns - 1)) / columns - 5 : 20;
  const lineHeight = (person) => Math.max(1, Math.min(2, wrapLines(person.name, charsPerLine(width, scale.name)))) * scale.name * 1.12 + 2 * 0.9 + 0.2;
  let rowsFit = Infinity;
  if (area) {
    const tallest = Math.max(4, ...ordered.map(lineHeight));
    rowsFit = Math.max(1, Math.floor((area.h + 0.8) / (tallest + 0.8)));
  }
  const capacity = rowsFit === Infinity ? ordered.length : Math.max(0, rowsFit * columns - trim);
  const shown = ordered.length > capacity ? ordered.slice(0, Math.max(0, capacity - 1)) : ordered;
  const hidden = ordered.length - shown.length;
  const hiddenPresent = ordered.slice(shown.length).filter((person) => person.present).length;
  const share = view.total ? view.present / view.total : 0;
  return (
    <section className="tv-screen-checkin" data-testid="tv-checkin-screen">
      <div className="tv-screen-checkin__left">
        <div className="tv-kicker tv-t-head tv-green">Check-in läuft</div>
        <div className="tv-screen-checkin__title font-heading" data-fit={String(tournament?.title || "").length > 22 ? "small" : undefined}>{tournament?.title}</div>
        <div className="tv-screen-checkin__num" data-testid="tv-checkin-count"><b className="font-heading">{view.present}</b><small className="tv-t-head">von {view.total} da</small></div>
        <div className="tv-screen-checkin__bar" role="presentation"><i style={{ width: `${(share * 100).toFixed(2)}%` }} /></div>
        <p className="tv-t-head tv-muted" data-testid="tv-checkin-hint">
          {view.allPresent ? "Alle da. Gleich geht es los." : [view.closesText, "Noch nicht da? Bitte bei der Turnierleitung melden."].filter(Boolean).join(" ")}
        </p>
      </div>
      <div ref={gridRef} className="tv-screen-checkin__grid" style={{ "--cols": columns }} data-testid="tv-checkin-names">
        {shown.map((person) => (
          <div key={person.id} className={`tv-check ${person.present ? "tv-check--ok" : ""}`} data-testid={`tv-check-${person.id}`} data-present={person.present ? "1" : "0"}>
            <Check present={person.present} />
            <b className="tv-t-name" data-tv-name="1">{person.name}</b>
          </div>
        ))}
        {hidden > 0 ? <div className="tv-check tv-check--more tv-t-info">+ {hidden} weitere{hiddenPresent === hidden ? " – alle da" : ""}</div> : null}
      </div>
    </section>
  );
}

/** Die Anmeldung: großer QR-Code zur Anmeldung, Termin, freie Plätze als Kästchen. */
export function TvRegistrationScreen({ tournament, seats, registrations = [], url }) {
  const second = useSecondTick();
  const view = registrationView(tournament, seats, registrations, second * 1000);
  const boxes = view.capacity && view.capacity <= 64 ? Array.from({ length: view.capacity }, (_, index) => index < view.taken) : [];
  return (
    <section className="tv-screen-reg" data-testid="tv-registration-screen">
      <div className="tv-screen-reg__qr" data-testid="tv-registration-qr">
        {/* Das Bild ist ein SVG - es wird auf die Fläche gezogen und bleibt scharf. */}
        <BrandedQRCode value={url} size={600} />
      </div>
      <div className="tv-screen-reg__text">
        <div className="tv-kicker tv-t-head tv-green">Anmeldung offen</div>
        <div className="tv-screen-reg__title font-heading" data-fit={String(tournament?.title || "").length > 22 ? "small" : undefined}>{tournament?.title}</div>
        {view.startText ? <div className="tv-t-head tv-muted">{view.startText}</div> : null}
        {boxes.length ? (
          <div className="tv-screen-reg__seats" style={{ "--seat-cols": Math.min(16, boxes.length) }} aria-hidden="true">
            {boxes.map((taken, index) => <i key={index} data-taken={taken ? "1" : undefined} />)}
          </div>
        ) : null}
        {view.seatsText ? <div className="tv-t-head font-bold" data-testid="tv-registration-seats">{view.seatsText}</div> : null}
        {view.untilText ? <div className="tv-t-info tv-muted">{view.untilText}</div> : null}
        <div className="tv-kicker tv-t-info">QR scannen und mitspielen</div>
      </div>
    </section>
  );
}
