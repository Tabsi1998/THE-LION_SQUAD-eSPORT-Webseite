import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, MessageSquare, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Freunde (#259): Spieler direkt im Reiter suchen und anfragen, statt erst ihr
// öffentliches Profil zu öffnen. Eine Liste mit Abschnitten - offene Anfragen
// oben, dann Freunde, Gesendet eingeklappt; am PC zwei Spalten (Anfragen und
// Gesendet links, Freunde rechts). „Zuletzt gesehen“ gibt es nicht, das
// Backend führt keine Anwesenheit.

const EMPTY = { friends: [], incoming: [], outgoing: [] };

function normalize(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY;
  return {
    friends: Array.isArray(data.friends) ? data.friends : [],
    incoming: Array.isArray(data.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
  };
}

function nameOf(user) {
  return user?.display_name || user?.username || "Benutzer";
}

function Avatar({ user }) {
  const [failed, setFailed] = useState(false);
  const url = user?.avatar_url ? resolveMediaUrl(user.avatar_url) : "";
  const initials = nameOf(user).slice(0, 2).toUpperCase();
  return (
    <div className="w-10 h-10 shrink-0 rounded-sm border border-white/10 bg-[#0A0A0A] overflow-hidden flex items-center justify-center font-heading font-black text-sm text-[#29B6E8]">
      {url && !failed ? <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} /> : <span>{initials}</span>}
    </div>
  );
}

function Person({ user }) {
  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <Avatar user={user} />
      <div className="min-w-0">
        {user?.username ? (
          <Link to={`/u/${user.username}`} className="block font-bold text-sm text-white truncate hover:text-[#29B6E8]">{nameOf(user)}</Link>
        ) : (
          <div className="font-bold text-sm text-white truncate">{nameOf(user)}</div>
        )}
        {user?.username ? <div className="text-xs text-white/40 truncate">@{user.username}</div> : null}
      </div>
    </div>
  );
}

const buttonBase = "px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1 disabled:opacity-50";

function Section({ title, count, rows, empty, testIdPrefix, children }) {
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 font-heading font-black uppercase">{title} ({count})</div>
      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <div key={row.id} data-testid={`${testIdPrefix}-${row.id}`} className="p-4 flex flex-wrap items-center gap-3">
            <Person user={row.user} />
            <div className="flex flex-wrap gap-2">{children(row)}</div>
          </div>
        ))}
        {rows.length === 0 ? <div className="p-6 text-sm text-white/35 text-center">{empty}</div> : null}
      </div>
    </section>
  );
}

export function FriendsPanel({ onChanged }) {
  const confirm = useConfirm();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get("/friends");
      setData(normalize(res));
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
    onChanged?.();
  }, [onChanged]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["friends", "admin/notifications"]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setCandidates([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data: rows } = await api.get(`/messages/users?q=${encodeURIComponent(needle)}`);
        setCandidates(Array.isArray(rows) ? rows : []);
      } catch {
        setCandidates([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  // Was ein Suchtreffer zu mir ist: Freund, Anfrage gesendet, Anfrage offen
  // oder noch nichts.
  const relationOf = (userId) => {
    if (data.friends.some((row) => row.user?.id === userId)) return { kind: "friend" };
    const incoming = data.incoming.find((row) => row.user?.id === userId);
    if (incoming) return { kind: "incoming", row: incoming };
    if (data.outgoing.some((row) => row.user?.id === userId)) return { kind: "sent" };
    return { kind: "none" };
  };

  const request = async (candidate) => {
    setBusyId(candidate.id);
    try {
      await api.post(`/friends/${candidate.id}/request`);
      toast.success(`Anfrage an ${nameOf(candidate)} gesendet.`);
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Anfrage konnte nicht gesendet werden."));
    } finally {
      setBusyId("");
    }
  };

  const act = async (row, action) => {
    try {
      if (action === "accept") {
        await api.post(`/friends/${row.id}/accept`);
        toast.success("Freundschaftsanfrage angenommen.");
      } else if (action === "decline") {
        await api.post(`/friends/${row.id}/decline`);
        toast.success("Freundschaftsanfrage abgelehnt.");
      } else if (action === "withdraw") {
        await api.delete(`/friends/${row.user.id}`);
        toast.success("Anfrage zurückgezogen.");
      } else if (action === "remove") {
        const ok = await confirm({
          title: `${nameOf(row.user)} entfernen?`,
          description: "Ihr seid danach keine Freunde mehr; eine neue Anfrage ist jederzeit möglich.",
          confirmLabel: "Entfernen",
          destructive: true,
        });
        if (!ok) return;
        await api.delete(`/friends/${row.user.id}`);
        toast.success("Freund entfernt.");
      }
      await load();
    } catch (err) {
      toast.error(formatRequestError(err, "Aktion konnte nicht ausgeführt werden."));
    }
  };

  const needle = query.trim();

  return (
    <div className="space-y-5" data-testid="profile-friends-tab">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
        <div className="flex items-start gap-3">
          <UserPlus className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-2xl md:text-3xl font-black uppercase">Freunde</h2>
            <p className="text-sm text-white/55 mt-1">Suche einen Spieler und schicke die Anfrage direkt hier. In der Privatsphäre kannst du Nachrichten auf Freunde beschränken.</p>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="Spieler suchen: Name oder @nutzername"
                aria-label="Spieler suchen"
                data-testid="profile-friends-search"
                className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] pl-9 pr-3 py-2 rounded-sm text-sm"
              />
            </div>
            {needle.length >= 2 ? (
              <div className="mt-3 border border-white/5 rounded-sm bg-[#0F0F10] divide-y divide-white/5" data-testid="profile-friends-results">
                {candidates.map((candidate) => {
                  const relation = relationOf(candidate.id);
                  return (
                    <div key={candidate.id} data-testid={`friends-candidate-${candidate.id}`} className="p-3 flex flex-wrap items-center gap-3">
                      <Person user={candidate} />
                      {relation.kind === "friend" ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-[#00FF88]">Befreundet</span>
                      ) : relation.kind === "sent" ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-white/50">Anfrage gesendet</span>
                      ) : relation.kind === "incoming" ? (
                        <button type="button" onClick={() => act(relation.row, "accept")} className={`${buttonBase} bg-[#29B6E8] text-black`}><Check className="w-3 h-3" /> Anfrage annehmen</button>
                      ) : candidate.blocked_by_me ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-white/40">Blockiert</span>
                      ) : (
                        <button type="button" onClick={() => request(candidate)} disabled={busyId === candidate.id} data-testid={`friends-request-${candidate.id}`} className={`${buttonBase} bg-[#29B6E8] text-black`}>
                          <UserPlus className="w-3 h-3" /> Anfrage senden
                        </button>
                      )}
                    </div>
                  );
                })}
                {!searching && candidates.length === 0 ? <div className="p-3 text-xs text-white/35">Keine passenden Spieler gefunden.</div> : null}
                {searching && candidates.length === 0 ? <div className="p-3 text-xs text-white/35">Suche …</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-white/40 font-display tracking-widest">LADE FREUNDE ...</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <div className="order-1 lg:col-start-1">
            <Section title="Offene Anfragen" count={data.incoming.length} rows={data.incoming} empty="Keine offenen Anfragen." testIdPrefix="friends-incoming">
              {(row) => (
                <>
                  <button type="button" onClick={() => act(row, "accept")} className={`${buttonBase} bg-[#29B6E8] text-black`}><Check className="w-3 h-3" /> Annehmen</button>
                  <button type="button" onClick={() => act(row, "decline")} className={`${buttonBase} border border-white/15 text-white/60`}><X className="w-3 h-3" /> Ablehnen</button>
                </>
              )}
            </Section>
          </div>
          <div className="order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <Section title="Freunde" count={data.friends.length} rows={data.friends} empty="Noch keine Freunde. Suche oben einen Spieler." testIdPrefix="friends-friend">
              {(row) => (
                <>
                  <Link to={`/messages/${row.user?.id}`} className={`${buttonBase} border border-[#29B6E8]/45 text-[#29B6E8]`}><MessageSquare className="w-3 h-3" /> Schreiben</Link>
                  <button type="button" onClick={() => act(row, "remove")} className={`${buttonBase} border border-[#FF3B30]/40 text-[#FF3B30]`}>Entfernen</button>
                </>
              )}
            </Section>
          </div>
          <details className="order-3 lg:col-start-1 group" data-testid="profile-friends-outgoing">
            <summary className="cursor-pointer select-none text-xs uppercase tracking-wider font-bold text-white/55 hover:text-white mb-2">
              Gesendet ({data.outgoing.length}) – aufklappen
            </summary>
            <Section title="Gesendet" count={data.outgoing.length} rows={data.outgoing} empty="Keine gesendeten offenen Anfragen." testIdPrefix="friends-outgoing">
              {(row) => (
                <button type="button" onClick={() => act(row, "withdraw")} className={`${buttonBase} border border-white/15 text-white/60`}>Zurückziehen</button>
              )}
            </Section>
          </details>
        </div>
      )}
    </div>
  );
}
