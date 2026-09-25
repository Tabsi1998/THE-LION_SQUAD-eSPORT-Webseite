import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ArrowLeft, Calendar, CheckCircle2, FileText, MapPin, Send, Vote, Video } from "lucide-react";

// Versammlungen und Abstimmungen (#327): alles kommt aus der Vereinsakte (Vereine 1.4) - Einladung,
// Tagesordnung, Anträge, Stimmrechte, Ergebnis. Die Website zeigt und reicht durch; sie hat keine eigene
// Wahl-Engine. Eine Stimme wird vor dem Senden bestätigt und lässt sich danach nicht ändern; welche Antwort
// jemand gab, schreibt die Website nirgends hin.

export function formatDay(day) {
  if (!day) return "";
  const [y, m, d] = String(day).split("-");
  return y && m && d ? `${d}.${m}.${y}` : day;
}

export function meetingWhen(meeting) {
  const parts = [formatDay(meeting.day)];
  if (meeting.time) parts.push(`${meeting.time} Uhr`);
  if (meeting.timezone && meeting.timezone !== "Europe/Vienna") parts.push(meeting.timezone);
  return parts.join(" · ");
}

const RESPONSES = [["yes", "Ich komme"], ["maybe", "Vielleicht"], ["no", "Ich komme nicht"]];

function MeetingCard({ meeting, busy, onRespond, onMotion }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const id = meeting.id;
  const submit = async (event) => {
    event.preventDefault();
    const ok = await onMotion(meeting, title, text);
    if (ok) {
      setTitle("");
      setText("");
    }
  };
  return (
    <div className={`border rounded-sm bg-[#121212] p-5 ${meeting.upcoming ? "border-[#FFD700]/40" : "border-white/10"}`} data-testid={`meeting-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">{meeting.kind_label}</div>
          <h2 className="font-heading text-xl font-black uppercase mt-1">{meeting.title}</h2>
          <div className="mt-1 text-sm text-white/70 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-[#FFD700]" /> {meetingWhen(meeting)}</span>
            <span>{meeting.format_label}</span>
            {meeting.place ? <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {meeting.place}</span> : null}
          </div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${meeting.status === "invited" ? "border-[#FFD700]/40 text-[#FFD700]" : "border-white/15 text-white/50"}`} data-testid={`meeting-${id}-status`}>
          {meeting.status_label}
        </span>
      </div>

      {meeting.access ? (
        <a href={meeting.access} target="_blank" rel="noreferrer" data-testid={`meeting-${id}-access`} className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#29B6E8] hover:underline">
          <Video className="w-4 h-4" /> Online teilnehmen
        </a>
      ) : null}

      {meeting.agenda.length ? (
        <div className="mt-4" data-testid={`meeting-${id}-agenda`}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-1.5">Tagesordnung</div>
          <ol className="list-decimal list-inside text-sm text-white/80 space-y-0.5">
            {meeting.agenda.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid={`meeting-${id}-response`}>
        <span className="text-sm text-white/70">Deine Antwort: <strong className="text-white">{meeting.response_label}</strong>{meeting.voting ? " · stimmberechtigt" : ""}</span>
        {meeting.can_respond ? RESPONSES.map(([code, label]) => (
          <button
            key={code}
            type="button"
            onClick={() => onRespond(meeting, code)}
            disabled={busy === `respond-${id}` || meeting.response === code}
            data-testid={`meeting-${id}-respond-${code}`}
            className={`px-3 py-1.5 rounded-sm border text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-60 ${meeting.response === code ? "border-[#FFD700] text-[#FFD700] bg-[#FFD700]/10" : "border-white/15 text-white/70 hover:border-[#FFD700]/60 hover:text-white"}`}
          >
            {label}
          </button>
        )) : null}
      </div>
      <p className="mt-1 text-xs text-white/40">Zu- oder Absage ist keine Anwesenheit und keine Stimme – die Anwesenheitsliste führt der Verein in der Versammlung.</p>

      {(meeting.can_motion || meeting.motions.length) ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2">Anträge zur Tagesordnung</div>
          {meeting.motions.length ? (
            <ul className="space-y-2 mb-3" data-testid={`meeting-${id}-motions`}>
              {meeting.motions.map((motion) => (
                <li key={motion.external_id} className="border border-white/10 rounded-sm p-3 text-sm" data-testid={`motion-${motion.external_id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-white">{motion.title}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/55">{motion.status_label}{motion.late ? " · verspätet" : ""}</span>
                  </div>
                  {motion.text ? <p className="mt-1 text-white/70 whitespace-pre-line">{motion.text}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {meeting.can_motion ? (
            <form onSubmit={submit} className="space-y-2" data-testid={`meeting-${id}-motion-form`}>
              {meeting.motion_deadline ? (
                <p className={`text-xs ${meeting.motion_late ? "text-[#FFD700]" : "text-white/45"}`} data-testid={`meeting-${id}-motion-deadline`}>
                  {meeting.motion_late
                    ? `Die Frist der Statuten (${formatDay(meeting.motion_deadline)}) ist vorbei – ein Antrag gilt als verspätet; ob er dennoch drankommt, entscheidet der Vorstand.`
                    : `Anträge bis ${formatDay(meeting.motion_deadline)} gelten als rechtzeitig.`}
                </p>
              ) : null}
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="Titel des Antrags" data-testid={`meeting-${id}-motion-title`} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#FFD700] px-3 py-2 rounded-sm text-sm" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={3} placeholder="Begründung (optional)" data-testid={`meeting-${id}-motion-text`} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#FFD700] px-3 py-2 rounded-sm text-sm" />
              <button type="submit" disabled={busy === `motion-${id}` || title.trim().length < 3} data-testid={`meeting-${id}-motion-submit`} className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider text-xs rounded-sm disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Antrag einreichen
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BallotCard({ ballot, busy, onVote }) {
  const id = ballot.id;
  const open = ballot.status === "open";
  return (
    <div className={`border rounded-sm bg-[#121212] p-5 ${open ? "border-[#29B6E8]/50" : "border-white/10"}`} data-testid={`ballot-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">{ballot.kind_label} · {ballot.meeting}{ballot.item ? ` · TOP ${ballot.item}` : ""}</div>
          <h3 className="font-heading text-lg font-black uppercase mt-1">{ballot.question}</h3>
          <div className="mt-1 text-xs text-white/55">{formatDay(ballot.day)}{ballot.closes ? ` · offen bis ${ballot.closes} Uhr` : ""}</div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${open ? "border-[#29B6E8]/50 text-[#29B6E8]" : "border-white/15 text-white/50"}`} data-testid={`ballot-${id}-status`}>
          {ballot.status_label}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {ballot.rights.map((right) => (
          <div key={`${right.right_id}-${right.for}-${right.name}`} className="border border-white/10 rounded-sm p-3" data-testid={`ballot-${id}-right-${right.right_id}`}>
            <div className="text-sm text-white/80">
              {right.for === "proxy" ? `Vollmacht von ${right.name}` : "Dein Stimmrecht"}
              <span className="text-white/45"> · {right.reason_text}</span>
            </div>
            {right.state === "used" ? (
              <div className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#00FF88]" data-testid={`ballot-${id}-right-${right.right_id}-used`}>
                <CheckCircle2 className="w-4 h-4" /> abgestimmt: {right.option_label || right.option}
              </div>
            ) : open && right.can_use ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {ballot.options.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => onVote(ballot, right, option)}
                    disabled={busy === `vote-${id}`}
                    data-testid={`ballot-${id}-vote-${right.right_id}-${option.code}`}
                    className="px-3 py-1.5 rounded-sm border border-[#29B6E8]/50 text-[#29B6E8] text-[11px] font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10 disabled:opacity-50"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-xs text-white/45">
                {right.state === "none" ? "Mit diesem Stimmrecht kannst du hier nicht abstimmen." : open ? "" : "Abstimmen geht nur, solange die Abstimmung offen ist."}
              </div>
            )}
          </div>
        ))}
        {!ballot.rights.length ? <p className="text-xs text-white/45">Kein Stimmrecht für dich bei dieser Abstimmung.</p> : null}
      </div>

      {ballot.result ? (
        <div className="mt-4 border-t border-white/10 pt-3 text-sm" data-testid={`ballot-${id}-result`}>
          <div className="font-bold text-white">Ergebnis: {ballot.result.outcome_label}{ballot.result.winner_label ? ` – ${ballot.result.winner_label}` : ""}</div>
          <div className="mt-1 text-white/70">
            {ballot.result.counts.map((row) => `${row.label} ${row.count}`).join(" · ")} · gültig {ballot.result.valid}
          </div>
        </div>
      ) : ballot.status === "closed" || ballot.status === "evaluated" ? (
        <p className="mt-3 text-xs text-white/45">Das Ergebnis erscheint, sobald die Versammlungsleitung es bestätigt hat.</p>
      ) : null}
    </div>
  );
}

export default function MemberMeetingsPage() {
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api.get("/membership/me/meetings")
      .then(({ data }) => setView(data && typeof data === "object" ? data : { available: false, reason: "error", text: "Konnte nicht geladen werden.", meetings: [], ballots: [] }))
      .catch(() => setView({ available: false, reason: "error", text: "Konnte nicht geladen werden.", meetings: [], ballots: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "dolibarr"]);

  const respond = async (meeting, response) => {
    setBusy(`respond-${meeting.id}`);
    try {
      await api.put(`/membership/me/meetings/${meeting.id}/response`, { response });
      toast.success(response === "yes" ? "Zugesagt." : response === "no" ? "Abgesagt." : "Als „vielleicht“ vermerkt.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const motion = async (meeting, title, text) => {
    setBusy(`motion-${meeting.id}`);
    try {
      const { data } = await api.post(`/membership/me/meetings/${meeting.id}/motions`, { title, text });
      toast.success(data?.late ? "Antrag eingegangen – nach der Frist, der Vorstand entscheidet über die Aufnahme." : "Antrag eingegangen.");
      load();
      return true;
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      return false;
    } finally {
      setBusy("");
    }
  };
  const vote = async (ballot, right, option) => {
    const ok = await confirm({
      title: "Stimme abgeben?",
      description: `„${option.label}“ zu: ${ballot.question}${right.for === "proxy" ? ` – als Vertretung für ${right.name}` : ""}. Eine abgegebene Stimme lässt sich nicht ändern.`,
      confirmLabel: "Abstimmen",
    });
    if (!ok) return;
    setBusy(`vote-${ballot.id}`);
    try {
      await api.post(`/membership/me/ballots/${ballot.id}/votes`, { right_id: right.right_id, option: option.code });
      toast.success("Stimme abgegeben.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Die Stimme wurde nicht angenommen.");
      load();
    } finally {
      setBusy("");
    }
  };

  const meetings = view?.meetings || [];
  const ballots = view?.ballots || [];
  const upcoming = meetings.filter((m) => m.upcoming);
  const past = meetings.filter((m) => !m.upcoming);
  const openBallots = ballots.filter((b) => b.status === "open" || b.status === "released");
  const doneBallots = ballots.filter((b) => !(b.status === "open" || b.status === "released"));

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="meetings-page">
        <Link to="/members/area" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-[#FFD700]"><ArrowLeft className="w-3 h-3" /> Mitgliederbereich</Link>
        <span className="block mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitgliederbereich</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Versammlungen & Abstimmungen</h1>
        <p className="mt-2 text-sm text-white/60 max-w-2xl">Einladungen, Tagesordnung, Anträge und Abstimmungen deiner Generalversammlungen – so, wie der Verein sie in der Mitgliederverwaltung führt.</p>

        {view === null ? <p className="mt-8 text-sm text-white/45" data-testid="meetings-loading">Wird geladen …</p> : null}

        {view && !view.available ? (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5 text-sm text-white/70" data-testid="meetings-unavailable">
            {view.text || "Versammlungen sind hier noch nicht verfügbar."}
            {view.reason === "not_bound" ? <div className="mt-3"><Link to="/members/membership" className="text-[#FFD700] hover:underline">Zu Meine Mitgliedschaft</Link></div> : null}
          </div>
        ) : null}

        {view && view.available ? (
          <>
            <h2 className="mt-8 font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Vote className="w-4 h-4 text-[#29B6E8]" /> Abstimmungen</h2>
            {view.ballots_reason ? <p className="mt-2 text-sm text-white/60" data-testid="ballots-reason">{view.ballots_text}</p> : null}
            {!view.ballots_reason && !ballots.length ? <p className="mt-2 text-sm text-white/45" data-testid="ballots-empty">Derzeit keine Abstimmung freigegeben.</p> : null}
            <div className="mt-3 space-y-4">
              {openBallots.map((ballot) => <BallotCard key={ballot.id} ballot={ballot} busy={busy} onVote={vote} />)}
              {doneBallots.map((ballot) => <BallotCard key={ballot.id} ballot={ballot} busy={busy} onVote={vote} />)}
            </div>

            <h2 className="mt-10 font-heading text-lg font-black uppercase inline-flex items-center gap-2"><FileText className="w-4 h-4 text-[#FFD700]" /> Versammlungen</h2>
            {view.meetings_reason ? <p className="mt-2 text-sm text-white/60" data-testid="meetings-reason">{view.meetings_text}</p> : null}
            {!view.meetings_reason && !meetings.length ? <p className="mt-2 text-sm text-white/45" data-testid="meetings-empty">Keine Einladung – sobald der Verein dich zu einer Versammlung einlädt, steht sie hier.</p> : null}
            <div className="mt-3 space-y-4">
              {upcoming.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} busy={busy} onRespond={respond} onMotion={motion} />)}
              {past.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} busy={busy} onRespond={respond} onMotion={motion} />)}
            </div>
          </>
        ) : null}
      </section>
    </PublicLayout>
  );
}
