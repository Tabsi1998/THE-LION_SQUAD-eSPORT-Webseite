import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Link2, Search, Unlink, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";

// Konto ↔ Vereinsprofil (#506): der Vorstand sucht das Website-Konto (Name, E-Mail, Benutzername), verknüpft
// oder löst es und übernimmt auf Wunsch Bild, Spiele und Plattformen aus dem Konto. Ein Profil ist kein Konto
// und keine Mitgliedschaft - das bleibt getrennt. Hat ein Konto schon ein anderes Profil, steht es dabei.

const TAKEOVER_LABELS = { photo_url: "Profilbild", games: "Spiele", platforms: "Plattformen", gamertag: "Gamertag" };

function splitList(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function AccountBox({ form, set, profile, profiles = [] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [account, setAccount] = useState(profile?.linked_account || null);

  useEffect(() => {
    if (!form.user_id) setAccount(null);
  }, [form.user_id]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get("/users", { params: { q: needle } })
        .then(({ data }) => { if (!cancelled) setResults((Array.isArray(data) ? data : []).slice(0, 8)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const otherProfileOf = (userId) => profiles.find((entry) => entry.user_id === userId && entry.id !== profile?.id);
  const link = (user) => {
    setAccount({ id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, email: user.email });
    set("user_id", user.id);
    setQuery("");
    setResults([]);
  };
  const unlink = () => {
    set("user_id", "");
    setAccount(null);
  };
  const takeOver = async () => {
    try {
      const { data } = await api.get(`/users/${form.user_id}`);
      const patch = {};
      if (!form.photo_url && data?.avatar_url) patch.photo_url = data.avatar_url;
      if (!splitList(form.games).length && Array.isArray(data?.favorite_games) && data.favorite_games.length) patch.games = data.favorite_games.join(", ");
      if (!splitList(form.platforms).length) {
        const platforms = Array.isArray(data?.main_platforms) && data.main_platforms.length ? data.main_platforms : (data?.main_platform ? [data.main_platform] : []);
        if (platforms.length) patch.platforms = platforms.join(", ");
      }
      if (!form.gamertag && data?.username) patch.gamertag = data.username;
      if (!Object.keys(patch).length) {
        toast.info("Nichts zu übernehmen – Bild, Spiele und Plattformen sind schon gesetzt oder im Konto leer.");
        return;
      }
      Object.entries(patch).forEach(([key, value]) => set(key, value));
      toast.success(`Übernommen: ${Object.keys(patch).map((key) => TAKEOVER_LABELS[key]).join(", ")}.`);
    } catch (error) {
      toast.error(formatRequestError(error, "Das Konto konnte nicht gelesen werden."));
    }
  };

  const initials = String(account?.display_name || account?.username || "?").slice(0, 2).toUpperCase();
  return (
    <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-3 space-y-2" data-testid="club-member-account">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] inline-flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Konto</div>
      {form.user_id && account ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-10 h-10 shrink-0 rounded-sm border border-white/15 bg-[#0A0A0A] overflow-hidden inline-flex items-center justify-center font-heading font-black text-xs text-[#29B6E8]">
            {account.avatar_url ? <img src={resolveMediaUrl(account.avatar_url)} alt="" className="w-full h-full object-cover" /> : initials}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-bold text-white truncate" data-testid="club-member-account-name">{account.display_name || account.username}</div>
            <div className="text-xs text-white/50 truncate">@{account.username}{account.email ? ` · ${account.email}` : ""}</div>
          </div>
          <Link to={`/u/${account.username}`} target="_blank" data-testid="club-member-account-profile" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">
            <ExternalLink className="w-3.5 h-3.5" /> Spielerprofil
          </Link>
          <button type="button" onClick={takeOver} data-testid="club-member-account-takeover" className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-white/15 rounded-sm text-xs font-bold uppercase tracking-wider text-white/70 hover:text-white">
            <Wand2 className="w-3.5 h-3.5" /> Bild, Spiele, Plattformen übernehmen
          </button>
          <button type="button" onClick={unlink} data-testid="club-member-account-unlink" className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#FF3B30]/35 rounded-sm text-xs font-bold uppercase tracking-wider text-[#FF3B30] hover:bg-[#FF3B30]/10">
            <Unlink className="w-3.5 h-3.5" /> Konto lösen
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-white/55">
            Ohne Konto ist das Profil rein redaktionell. Mit Konto pflegt das Mitglied sein Profil unter Meine Mitgliedschaft, und der Abgleich findet es wieder.
            {profile?.account_unlinked_at ? " Zuletzt hat der Vorstand ein Konto gelöst – der Abgleich hängt es nicht von selbst wieder an." : ""}
          </p>
          <label className="relative block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Konto suchen: Name, E-Mail oder Benutzername" data-testid="club-member-account-search"
              className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] pl-9 pr-3 py-2 rounded-sm text-sm text-white" />
          </label>
          {searching ? <p className="text-xs text-white/40">Suche …</p> : null}
          {results.length > 0 ? (
            <ul className="divide-y divide-white/5 border border-white/10 rounded-sm bg-[#0A0A0A]" data-testid="club-member-account-results">
              {results.map((user) => {
                const other = otherProfileOf(user.id);
                return (
                  <li key={user.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-bold text-white truncate">{user.display_name || user.username}</div>
                      <div className="text-xs text-white/50 truncate">@{user.username}{user.email ? ` · ${user.email}` : ""}{other ? ` · hat schon das Profil „${other.display_name}“` : ""}</div>
                    </div>
                    <button type="button" disabled={Boolean(other)} onClick={() => link(user)} data-testid={`club-member-account-link-${user.username}`}
                      className="px-2.5 py-1.5 border border-[#29B6E8]/50 rounded-sm text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:bg-[#29B6E8]/10 disabled:opacity-40">Verknüpfen</button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {query.trim().length >= 2 && !searching && results.length === 0 ? <p className="text-xs text-white/40">Kein Konto gefunden.</p> : null}
        </>
      )}
    </div>
  );
}
