import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, Copy, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { feedUrls } from "@/lib/calendar";
import { motionAllowed } from "@/lib/motion";
import { SUBSCRIBE_ANCHOR, SUBSCRIBE_GUIDE, googleSubscribeUrl, subscriptionLine } from "@/lib/myCalendar";
import { viennaDateTime } from "@/lib/vienna";

// Mein Kalender-Abo (#1189, #1788): der persönliche Link - nur die eigenen Termine, für die Kalender-App. Ein Baustein
// für /calendar, „Mein Kalender“ und die Einstellungen. Gespeichert ist nur ein Hash: die Adresse steht nur direkt nach
// dem Erzeugen da. „Neu erzeugen“ sperrt die alte Adresse, „Abschalten“ alle - beides mit Rückfrage.

const ORIGIN_FALLBACK = "https://lionsquad.at";

/** Eine Abo-Adresse zum Kopieren - mit kurzem Haken-Moment (Bewegung nur ohne „Bewegung reduzieren“, index.css). */
export function FeedAddress({ url, testId = "calendar-feed", label = "Abo-Adresse" }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-3 flex gap-2 min-w-0">
      <input readOnly value={url} onFocus={(ev) => ev.target.select()} data-testid={`${testId}-url`} aria-label={label} className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono" />
      <button type="button" onClick={copy} data-testid={`${testId}-copy`} data-copied={copied ? "true" : undefined} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
        {copied ? <Check key="check" className="tls-copy-check w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Kopiert" : "Kopieren"}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? `${label} kopiert` : ""}</span>
    </div>
  );
}

/** Kurzanleitung Google, Apple, Outlook - aufklappbar, damit der Kasten ruhig bleibt. */
export function SubscribeGuide({ testId = "calendar-guide" }) {
  return (
    <details className="mt-3 text-xs text-white/55 group" data-testid={testId}>
      <summary className="cursor-pointer select-none font-bold uppercase tracking-wider text-white/65 hover:text-white">So geht&apos;s in deinem Kalender</summary>
      <dl className="mt-2 space-y-1.5">
        {SUBSCRIBE_GUIDE.map((entry) => (
          <div key={entry.key}>
            <dt className="inline font-bold text-white/75">{entry.label}: </dt>
            <dd className="inline">{entry.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function PersonalFeedCard({ origin = typeof window !== "undefined" ? window.location.origin : ORIGIN_FALLBACK, onStatus, testId = "calendar-personal" }) {
  const [status, setStatus] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const remember = (next) => {
    setStatus(next);
    onStatus?.(next);
  };

  useEffect(() => {
    let alive = true;
    api.get("/calendar/personal")
      .then(({ data }) => alive && remember({ active: Boolean(data?.active), created_at: data?.created_at || null, last_used_at: data?.last_used_at || null }))
      .catch(() => alive && remember({ active: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einmal beim Öffnen
  }, []);

  // Der Hinweis nach einer Anmeldung führt hierher (#abo): einmal hinscrollen, sobald der Kasten steht.
  const ref = useRef(null);
  const ready = Boolean(status);
  useEffect(() => {
    if (!ready || typeof window === "undefined" || window.location.hash !== `#${SUBSCRIBE_ANCHOR}`) return;
    ref.current?.scrollIntoView?.({ block: "start", behavior: motionAllowed() ? "smooth" : "auto" });
    ref.current?.querySelector("button")?.focus?.({ preventScroll: true });
  }, [ready]);

  const run = async (action) => {
    setBusy(true);
    setProblem("");
    try {
      await action();
      setConfirming(null);
    } catch {
      setProblem("Das hat gerade nicht geklappt. Bitte später noch einmal.");
    } finally {
      setBusy(false);
    }
  };
  const issue = () => run(async () => {
    const { data } = await api.post("/calendar/personal");
    setFresh(feedUrls(origin, data.path));
    remember({ active: true, created_at: data.created_at, last_used_at: null });
  });
  const revoke = () => run(async () => {
    await api.delete("/calendar/personal");
    setFresh(null);
    remember({ active: false });
  });

  if (!status) return null;
  return (
    <div ref={ref} id={SUBSCRIBE_ANCHOR} className="scroll-mt-24 border border-[#FFD700]/40 bg-[#FFD700]/5 rounded-sm p-5" data-testid={testId}>
      <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-[#FFD700]"><CalendarPlus className="w-3.5 h-3.5" /> Automatisch in deinen Kalender</div>
      <p className="mt-2 text-sm text-white/65">
        Einmal abonnieren – danach erscheint jede Anmeldung von selbst im Handy- oder PC-Kalender: Events, Turniere (auch mit deinem Team), gefahrene Fast Laps, zugesagte Versammlungen und deine Schichten. Die Adresse ist privat – gib sie nicht weiter.
      </p>
      {fresh ? (
        <>
          <FeedAddress url={fresh.https} testId={`${testId}-feed`} label="Deine Abo-Adresse" />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <a href={fresh.webcal} data-testid={`${testId}-webcal`} className="tls-btn tls-btn--primary inline-flex items-center gap-1.5 px-3 py-2 font-bold uppercase tracking-wider rounded-sm">
              <ExternalLink className="w-3.5 h-3.5" /> Im Kalender öffnen
            </a>
            <a href={googleSubscribeUrl(fresh.webcal)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid={`${testId}-google`} className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 px-3 py-2 font-bold uppercase tracking-wider rounded-sm">
              Google Kalender
            </a>
          </div>
          <p className="mt-3 text-xs text-white/50" data-testid={`${testId}-once`}>Kopier sie jetzt: Wir zeigen sie nur dieses eine Mal.</p>
        </>
      ) : status.active ? (
        <p className="mt-3 text-xs text-white/55" data-testid={`${testId}-active`}>
          {subscriptionLine(status, viennaDateTime)} Die Adresse zeigen wir nur beim Erzeugen – brauchst du sie wieder, erzeug eine neue.
        </p>
      ) : null}
      {problem && <p className="mt-3 text-xs text-[#FF3B30]" role="alert">{problem}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {!status.active ? (
          <button type="button" onClick={issue} disabled={busy} data-testid={`${testId}-create`} className="tls-btn tls-btn--honor px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Abo einrichten</button>
        ) : confirming ? (
          <>
            <button type="button" onClick={confirming === "renew" ? issue : revoke} disabled={busy} data-testid={`${testId}-${confirming}-confirm`} className="tls-btn tls-btn--danger px-3 py-2 rounded-sm font-bold uppercase tracking-wider">
              {confirming === "renew" ? "Ja, neu erzeugen" : "Ja, abschalten"}
            </button>
            <button type="button" onClick={() => setConfirming(null)} disabled={busy} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Abbrechen</button>
            <span className="basis-full text-white/50" data-testid={`${testId}-confirm-text`}>
              {confirming === "renew"
                ? "Die alte Adresse gilt danach nicht mehr – Kalender damit bekommen keine Termine mehr."
                : "Dein Abo endet: Kalender mit dieser Adresse bekommen keine Termine mehr. Einrichten kannst du es jederzeit neu."}
            </span>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming("renew")} disabled={busy} data-testid={`${testId}-renew`} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Neu erzeugen</button>
            <button type="button" onClick={() => setConfirming("revoke")} disabled={busy} data-testid={`${testId}-revoke`} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">Abschalten</button>
          </>
        )}
      </div>
      <SubscribeGuide testId={`${testId}-guide`} />
    </div>
  );
}
