import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { friendPlaces, friendsSentence } from "@/lib/eventRecap";
import { SizedImage } from "@/components/tls/SizedImage";

// Freunde beim Event (#1188): „Von deinen Freunden dabei“ - nur mit Konto und nur bestätigte Freunde, die es erlauben.
// Was jemand sehen darf, entscheidet allein der Server (services/event_friends.py); Gäste fragen gar nicht erst.
// Dazu einmal der Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ mit „Ausschalten“ - sobald es für
// die Person selbst wirkt. Dieselbe Zeile hat die App (FriendsAtEventCard).
// Seit Teil 2 auch auf Turnier- und Fast-Lap-Seiten: ``path`` nennt dann die Abfrage, ``scope`` die Ortsangabe.

const SHOWN = 8;

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
}

function FriendAvatar({ friend }) {
  const fallback = (
    <span className="inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-[#9F7AEA]/25 text-[11px] font-bold text-white" aria-hidden="true">
      {initials(friend.display_name)}
    </span>
  );
  return <SizedImage src={friend.avatar_url || ""} size={32} round alt="" className="shrink-0" fallback={fallback} />;
}

export function FriendsAtEvent({ event, user, over = false, path = "", scope = "event" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = event?.slug || event?.id;
  const url = path || (key ? `/events/${key}/friends` : "");
  const userId = user?.id;

  useEffect(() => {
    let alive = true;
    setData(null);
    if (!userId || !url) return undefined;
    api.get(url)
      .then(({ data: body }) => { if (alive) setData(body && Array.isArray(body.friends) ? body : null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [url, userId]);

  if (!userId || !data) return null;
  const friends = data.friends;
  if (!friends.length && !data.hint) return null;

  const answerHint = async (turnOff) => {
    setBusy(true);
    try {
      await api.post("/users/me/friends-hint", { turn_off: turnOff });
      setData((current) => ({ ...current, hint: false, sharing: turnOff ? false : current.sharing }));
      if (turnOff) toast.success("Ausgeschaltet. Einschalten kannst du es unter Profil → Privatsphäre.");
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" data-section="friends" data-testid="event-friends">
      {data.hint && (
        <div className="border border-[#9F7AEA]/40 bg-[#9F7AEA]/5 rounded-sm p-4" role="note" data-testid="event-friends-hint">
          <p className="text-sm text-white/85">Deine Freunde sehen, zu welchen Events du angemeldet bist.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => answerHint(false)} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="event-friends-hint-ok">
              Verstanden
            </button>
            <button type="button" disabled={busy} onClick={() => answerHint(true)} className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="event-friends-hint-off">
              Ausschalten
            </button>
          </div>
        </div>
      )}
      {!!friends.length && (
        <div>
          <h2 className="font-heading text-2xl font-black uppercase mb-1 inline-flex items-center gap-2">
            <Users className="w-5 h-5 text-[#9F7AEA]" aria-hidden="true" /> {over ? "Deine Freunde waren dabei" : "Von deinen Freunden dabei"}
          </h2>
          <p className="text-sm text-white/60 mb-3" data-testid="event-friends-sentence">{friendsSentence(friends, { over })}.</p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {friends.slice(0, SHOWN).map((friend) => {
              const name = <span className="block font-bold text-white leading-tight break-words">{friend.display_name}</span>;
              return (
                <li key={friend.id} className="flex items-center gap-3 rounded-sm bg-white/[0.04] px-3 py-2 min-w-0" data-testid={`event-friend-${friend.id}`}>
                  <FriendAvatar friend={friend} />
                  <span className="min-w-0">
                    {friend.username ? <Link to={`/u/${friend.username}`} className="hover:text-[#9F7AEA]">{name}</Link> : name}
                    <span className="block text-xs text-white/55 break-words">{friendPlaces(friend, { scope }).join(" · ")}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {friends.length > SHOWN && <p className="mt-2 text-xs text-white/50">und {friends.length - SHOWN} weitere</p>}
        </div>
      )}
    </section>
  );
}
