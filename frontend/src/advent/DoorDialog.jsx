import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ExternalLink, Gift, LogIn, ScrollText, X } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { VideoEmbed } from "@/components/tls/VideoEmbed";
import { clipEmbedSrc } from "@/components/tls/TwitchClips";
import { KIND_ICONS } from "./Door";
import { opensLabel } from "./doors";
import { errorText } from "./useAdventCalendar";
import { asInstant, viennaDate } from "@/lib/vienna";

// Der Inhalt eines Türchens (#641) im Fenster: Text, Bild, Video, Clip, Karte (News, Event, Mitglied), Sticker,
// Quiz oder Gewinn. Videos und Clips laden erst nach der Zustimmung zu externen Medien. Das Quiz zeigt die
// Auflösung nach der Antwort; bei der Verlosung ist Mitmachen ein eigener Klick.

export const KIND_LABELS = {
  text: "Gruß",
  image: "Bild",
  video: "Video",
  clip: "Clip",
  news: "News",
  event: "Event",
  member_spotlight: "Mitglied der Woche",
  sticker: "Sticker",
  quiz: "Quiz",
  prize: "Gewinn",
};
const CARD_KICKER = { news: "News-Beitrag", event: "Event", member_spotlight: "Mitglied der Woche" };
const LETTERS = ["A", "B", "C"];

function isInternal(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
}

function SmartLink({ url, className, children, testId }) {
  if (isInternal(url)) return <Link to={url} className={className} data-testid={testId}>{children}</Link>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId}>{children}</a>;
}

function dateText(value) {
  const date = asInstant(value || "");
  return Number.isNaN(date.getTime()) ? "" : viennaDate(date, { day: "numeric", month: "long", year: "numeric" });
}

function ClipEmbed({ clip, title }) {
  const { hasConsent } = useCookieConsent();
  if (!clip?.id) return null;
  if (!hasConsent("external_media")) {
    return <ExternalMediaNotice service="Twitch Clip" reason="Der Clip-Player von Twitch wird erst nach deiner Zustimmung zu externen Medien geladen." url={clip.url} accent="#9146FF" compact testId="advent-clip-consent" />;
  }
  return <iframe src={clipEmbedSrc(clip.id).replace("autoplay=true", "autoplay=false")} className="tls-adv-dialog__frame" allow="fullscreen; picture-in-picture" allowFullScreen title={title} data-testid="advent-clip-frame" />;
}

function CardLink({ kind, card }) {
  const meta = kind === "event" ? [dateText(card.date), card.location].filter(Boolean).join(" · ") : kind === "news" ? card.excerpt || dateText(card.date) : card.role;
  const inner = (
    <>
      {card.image_url && <img className="tls-adv-card__image" src={resolveMediaUrl(card.image_url)} alt="" loading="lazy" />}
      <span className="tls-adv-card__text">
        <span className="tls-adv-card__kicker">{CARD_KICKER[kind]}</span>
        <span className="tls-adv-card__title">{card.title || card.name}</span>
        {meta && <span className="tls-adv-card__meta">{meta}</span>}
      </span>
    </>
  );
  const className = `tls-adv-card${card.image_url ? "" : " tls-adv-card--plain"}`;
  if (!card.url) return <div className={className} data-testid="advent-card">{inner}</div>;
  return <SmartLink url={card.url} className={className} testId="advent-card">{inner}</SmartLink>;
}

export function QuizBlock({ day, quiz, onAnswer }) {
  const [result, setResult] = useState(null);
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    setResult(null);
    setChoice(null);
    setProblem("");
  }, [day]);

  const pick = async (index) => {
    if (busy || result) return;
    setBusy(true);
    setChoice(index);
    setProblem("");
    try {
      setResult(await onAnswer(day, index));
    } catch (failure) {
      setChoice(null);
      setProblem(errorText(failure, "Die Antwort ist nicht angekommen. Versuch es noch einmal."));
    } finally {
      setBusy(false);
    }
  };

  const state = (index) => {
    if (!result) return undefined;
    if (index === result.correct_index) return "right";
    return index === choice ? "wrong" : "other";
  };
  return (
    <div className="grid gap-3" data-testid="advent-quiz">
      <div className="tls-adv-quiz__question">{quiz.question}</div>
      <div className="tls-adv-quiz__answers" role="group" aria-label="Antworten">
        {(quiz.answers || []).map((answer, index) => (
          <button key={index} type="button" className="tls-adv-quiz__answer" disabled={busy || Boolean(result)} data-result={state(index)} onClick={() => pick(index)} data-testid={`advent-quiz-answer-${index}`}>
            <span className="tls-adv-quiz__letter" aria-hidden="true">{state(index) === "right" ? <Check className="w-4 h-4" /> : LETTERS[index]}</span>
            <span className="min-w-0 break-words">{answer}</span>
          </button>
        ))}
      </div>
      {result && (
        <div className={`tls-adv-note ${result.correct ? "tls-adv-note--good" : "tls-adv-note--bad"}`} role="status" data-testid="advent-quiz-result">
          <strong>{result.correct ? "Richtig!" : `Leider nein – richtig ist „${result.correct_answer}“.`}</strong>
          {result.explanation ? ` ${result.explanation}` : ""}
        </div>
      )}
      {!result && quiz.done && <div className="tls-adv-note" data-testid="advent-quiz-done">Du hast bei diesem Quiz schon mitgemacht – raten darfst du trotzdem noch einmal.</div>}
      {problem && <div className="tls-adv-note tls-adv-note--bad" role="alert">{problem}</div>}
    </div>
  );
}

function closesText(prize) {
  const label = opensLabel(prize.closes_at);
  return label ? `Teilnahme bis ${label}` : "";
}

export function PrizeBlock({ day, prize, signedIn, onRaffle }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => setProblem(""), [day]);

  const act = async (join) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      await onRaffle(day, join);
    } catch (failure) {
      setProblem(errorText(failure, join ? "Das Mitmachen hat nicht geklappt. Versuch es noch einmal." : "Das Zurückziehen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  const winners = prize.winners === 1 ? "1 Gewinn" : `${prize.winners} Gewinne`;
  const entries = prize.entries === 1 ? "1 Person macht mit" : `${prize.entries} Personen machen mit`;
  return (
    <div className="tls-adv-prize" data-testid="advent-prize" data-status={prize.status}>
      <div className="tls-adv-prize__head">
        <span className="tls-adv-prize__icon" aria-hidden="true"><Gift /></span>
        <div className="min-w-0">
          <div className="tls-adv-prize__label">{prize.label}</div>
          {prize.value && <div className="tls-adv-prize__value">{prize.value}</div>}
        </div>
      </div>
      <div className="tls-adv-prize__facts">
        <span className="tls-adv-prize__fact">{winners}</span>
        <span className="tls-adv-prize__fact" data-testid="advent-prize-entries">{entries}</span>
        {prize.status === "open" && closesText(prize) && <span className="tls-adv-prize__fact">{closesText(prize)}</span>}
        {prize.audience === "members" && <span className="tls-adv-prize__fact">Nur für Vereinsmitglieder</span>}
      </div>
      {prize.hint && <div className={`tls-adv-note${prize.won || prize.entered ? " tls-adv-note--good" : ""}`} role="status" data-testid="advent-prize-hint">{prize.hint}</div>}
      <div className="tls-adv-prize__actions">
        {prize.can_enter && <button type="button" className="tls-adv-button" disabled={busy} onClick={() => act(true)} data-testid="advent-prize-enter">Mitmachen</button>}
        {prize.can_withdraw && <button type="button" className="tls-adv-button tls-adv-button--quiet" disabled={busy} onClick={() => act(false)} data-testid="advent-prize-withdraw">Teilnahme zurückziehen</button>}
        {!signedIn && prize.status === "open" && <Link to="/login" className="tls-adv-button" data-testid="advent-prize-login"><LogIn className="w-4 h-4" /> Anmelden</Link>}
        {prize.won && <Link to="/me/prizes" className="tls-adv-button" data-testid="advent-prize-mine"><Gift className="w-4 h-4" /> Meine Gewinne</Link>}
      </div>
      {problem && <div className="tls-adv-note tls-adv-note--bad" role="alert" data-testid="advent-prize-problem">{problem}</div>}
      {Array.isArray(prize.terms) && prize.terms.length > 0 && (
        <details className="tls-adv-prize__terms" data-testid="advent-prize-terms">
          <summary>Teilnahmebedingungen</summary>
          <ol>{prize.terms.map((line, index) => <li key={index}>{line}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

export function DoorContent({ day, content, signedIn, onAnswer, onRaffle }) {
  return (
    <>
      {content.kind === "image" && content.media_url && <img className="tls-adv-dialog__image" src={resolveMediaUrl(content.media_url)} alt={content.title || ""} data-testid="advent-image" />}
      {content.kind === "sticker" && content.sticker?.url && <img className="tls-adv-dialog__sticker" src={resolveMediaUrl(content.sticker.url)} alt={content.sticker.name || "Sticker"} width={content.sticker.width || undefined} height={content.sticker.height || undefined} data-testid="advent-sticker" />}
      {content.kind !== "image" && content.kind !== "sticker" && content.media_url && <img className="tls-adv-dialog__image" src={resolveMediaUrl(content.media_url)} alt="" data-testid="advent-illustration" />}
      {content.body && <p className="tls-adv-dialog__text" data-testid="advent-text">{content.body}</p>}
      {content.kind === "video" && content.video?.url && <VideoEmbed url={content.video.url} title={content.title} />}
      {content.kind === "clip" && <ClipEmbed clip={content.clip} title={content.title} />}
      {content.card && <CardLink kind={content.kind} card={content.card} />}
      {content.quiz && <QuizBlock day={day} quiz={content.quiz} onAnswer={onAnswer} />}
      {content.prize && <PrizeBlock day={day} prize={content.prize} signedIn={signedIn} onRaffle={onRaffle} />}
      {content.link?.url && (
        <div>
          <SmartLink url={content.link.url} className="tls-adv-button tls-adv-button--quiet" testId="advent-link">
            {content.link.label || "Mehr dazu"} {isInternal(content.link.url) ? <ArrowRight className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
          </SmartLink>
        </div>
      )}
    </>
  );
}

export function DoorDialog({ door: current, light, signedIn, onClose, onAnswer, onRaffle }) {
  // Beim Schließen bleibt der Inhalt stehen, bis das Fenster ausgeblendet ist.
  const [kept, setKept] = useState(current);
  useEffect(() => {
    if (current) setKept(current);
  }, [current]);
  const open = Boolean(current?.content);
  const door = current || kept;
  const content = door?.content;
  const Icon = (content && KIND_ICONS[content.kind]) || ScrollText;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="tls-adv-dialog fixed left-[50%] top-[50%] z-[60] translate-x-[-50%] translate-y-[-50%] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          style={light ? { "--dialog-light": light.soft } : undefined}
          data-testid="advent-dialog"
          aria-describedby={undefined}
        >
          {content && (
            <>
              <div className="tls-adv-dialog__head">
                <div className="tls-adv-dialog__eyebrow"><Icon aria-hidden="true" /> Türchen {door.day} · {KIND_LABELS[content.kind] || "Gruß"}</div>
                <DialogPrimitive.Title className="tls-adv-dialog__title" data-testid="advent-dialog-title">{content.title}</DialogPrimitive.Title>
              </div>
              <div className="tls-adv-dialog__body">
                <DoorContent day={door.day} content={content} signedIn={signedIn} onAnswer={onAnswer} onRaffle={onRaffle} />
              </div>
            </>
          )}
          <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e9c46a]" data-testid="advent-dialog-close">
            <X className="h-4 w-4" />
            <span className="sr-only">Schließen</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
