import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Crown, Gamepad2, Medal, Server, Shield, Trophy, Users } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

function memberGamertag(member) {
  return member.gamertag || member.linked_account?.username || member.display_name;
}

function memberRealName(member) {
  const tag = memberGamertag(member);
  return member.real_name || (member.display_name && member.display_name !== tag ? member.display_name : "");
}

export default function CommunityPage() {
  useDocumentTitle(
    "Gaming Community",
    "Community, Teams, Spielerprofile und Vereinsmitglieder von THE LION SQUAD eSports aus Tirol."
  );

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [clubMembers, setClubMembers] = useState([]);
  const [servers, setServers] = useState([]);
  const [serverSummary, setServerSummary] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.get("/users/public-list?limit=24"),
      api.get("/teams?limit=24"),
      api.get("/membership/profiles"),
      api.get("/game-servers"),
    ]).then(([u, t, m, s]) => {
      if (u.status === "fulfilled") setPlayers(u.value.data || []);
      if (t.status === "fulfilled") setTeams(t.value.data || []);
      if (m.status === "fulfilled") setClubMembers(m.value.data || []);
      if (s.status === "fulfilled") {
        setServers(s.value.data?.items || []);
        setServerSummary(s.value.data?.summary || {});
      }
    }).finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => [
    { label: "Öffentliche Accounts", value: players.length, icon: Users },
    { label: "Teams", value: teams.length, icon: Shield },
    { label: "Vereinsmitglieder", value: clubMembers.length, icon: Crown },
    { label: "Server online", value: serverSummary.online || 0, icon: Server },
  ], [players.length, teams.length, clubMembers.length, serverSummary.online]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Accounts, Teams & Verein</h1>
        <p className="mt-4 text-white/60 max-w-3xl">
          Öffentliche Profile aller Community-Accounts, Teamseiten und die separat gepflegten offiziellen Vereinsmitglieder an einem Ort.
        </p>

        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <s.icon className="w-5 h-5 text-[#29B6E8]" />
              <div className="mt-3 text-3xl font-heading font-black">{loading ? "-" : s.value}</div>
              <div className="text-xs uppercase tracking-widest text-white/45 font-bold">{s.label}</div>
            </div>
          ))}
        </div>

        <CommunityPaths />

        <div className="mt-10 grid md:grid-cols-2 xl:grid-cols-4 gap-6">
          <CommunityBlock
            title="Community-Profile"
            text="Alle öffentlichen Benutzerkonten mit Profil, Achievements und Stats."
            to="/players"
            cta="Profile öffnen"
            items={players.slice(0, 6).map((p) => ({
              key: p.username,
              to: `/u/${p.username}`,
              title: p.display_name || p.username,
              subtitle: `@${p.username}`,
              image: p.avatar_url,
            }))}
          />
          <CommunityBlock
            title="Teams"
            text="Öffentliche Teamprofile mit Logo, Beschreibung und Mitgliedern."
            to="/teams"
            cta="Teams öffnen"
            items={teams.slice(0, 6).map((t) => ({
              key: t.id,
              to: `/teams/${t.id}`,
              title: t.name,
              subtitle: `[${t.tag}]`,
              image: t.logo_url,
            }))}
          />
          <CommunityBlock
            title="Vereinsmitglieder"
            text="Redaktionell gepflegte Mitgliederseite mit größeren Bildern und Biografie."
            to="/members"
            cta="Mitglieder öffnen"
            accent="gold"
            items={clubMembers.slice(0, 6).map((m) => ({
              key: m.slug,
              to: `/members/${m.slug}`,
              title: memberGamertag(m),
              subtitle: [memberRealName(m), m.role_title || "Vereinsmitglied"].filter(Boolean).join(" · "),
              image: m.photo_url,
            }))}
          />
          <CommunityBlock
            title="Server"
            text="Öffentliche, Community- und Vereinsserver mit Status, Zugriff und Spielerzahlen."
            to="/servers"
            cta="Server öffnen"
            accent="green"
            icon={Server}
            items={servers.slice(0, 6).map((s) => ({
              key: s.id,
              to: "/servers",
              title: s.name,
              subtitle: `${s.status === "online" ? "Online" : "Offline"} · ${s.player_count || 0}${s.max_players ? `/${s.max_players}` : ""} Spieler`,
              image: s.game?.logo_url,
            }))}
          />
        </div>
      </section>
    </PublicLayout>
  );
}

function CommunityPaths() {
  const paths = [
    { to: "/players", label: "Spieler", text: "Profile, Level und sichtbare Achievement-Signale.", icon: Users, color: "#29B6E8" },
    { to: "/teams", label: "Teams", text: "Squads, Clans und gemeinsame Teamseiten.", icon: Shield, color: "#00FF88" },
    { to: "/servers", label: "Server", text: "Aktive Community- und Vereinsserver.", icon: Server, color: "#9F7AEA" },
    { to: "/members", label: "Mitglieder", text: "Offizielle Vereinsprofile und Rollen.", icon: Crown, color: "#FFD700" },
    { to: "/references", label: "Referenzen", text: "Turnier-, Event- und Community-Historie.", icon: Trophy, color: "#FFD700" },
    { to: "/players", label: "Achievements", text: "Erfolge erscheinen direkt an den Spielerprofilen.", icon: Medal, color: "#29B6E8" },
  ];
  return (
    <section className="mt-10 rounded-sm border border-white/10 bg-[#0D0D0D] p-4 md:p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community-Welt</div>
          <h2 className="mt-2 font-heading text-2xl font-black uppercase">Alles verbunden</h2>
        </div>
        <p className="max-w-xl text-sm text-white/55">
          Profile, Teams, Server, Referenzen und Achievements greifen ineinander, damit Besucher schneller verstehen, was in der TLS-Community passiert.
        </p>
      </div>
      <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {paths.map(({ to, label, text, icon: Icon, color }) => (
          <Link key={label} to={to} className="group flex min-w-0 items-center gap-3 rounded-sm border border-white/10 bg-black/20 p-3 transition hover:border-white/25 hover:bg-white/[0.04]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-[#121212]">
              <Icon className="h-4 w-4" style={{ color }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-heading font-bold uppercase leading-tight group-hover:text-[#29B6E8]">{label}</span>
              <span className="mt-1 block text-xs text-white/45 line-clamp-2">{text}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-[#29B6E8]" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function CommunityBlock({ title, text, to, cta, items, accent = "cyan", icon: Icon = Gamepad2 }) {
  const color = accent === "gold" ? "#FFD700" : accent === "green" ? "#00FF88" : "#29B6E8";
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-black uppercase">{title}</h2>
          <p className="mt-2 text-sm text-white/55">{text}</p>
        </div>
        <Icon className="w-5 h-5 shrink-0" style={{ color }} />
      </div>
      <div className="mt-5 space-y-2 min-h-64">
        {items.length ? items.map((item) => (
          <Link key={item.key} to={item.to} className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-2 hover:border-white/25 transition">
            <div className="w-11 h-11 rounded-sm bg-[#121212] border border-white/10 overflow-hidden flex items-center justify-center">
              {item.image ? <img src={resolveMediaUrl(item.image)} alt="" className="w-full h-full object-cover" /> : <Users className="w-5 h-5 text-white/25" />}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">{item.title}</div>
              <div className="text-[11px] text-white/40 truncate">{item.subtitle}</div>
            </div>
          </Link>
        )) : (
          <div className="py-10 text-center text-sm text-white/35">Noch keine Einträge.</div>
        )}
      </div>
      <Link to={to} className="mt-5 inline-flex w-full items-center justify-center px-4 py-3 rounded-sm text-xs font-black uppercase tracking-wider border transition hover:bg-white/5" style={{ color, borderColor: `${color}55` }}>
        {cta}
      </Link>
    </section>
  );
}
