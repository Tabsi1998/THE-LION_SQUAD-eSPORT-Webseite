import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Award, Gift, CheckCircle2, Clock, XCircle, MapPin, Trophy, Users, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";

const STATUS = {
  pending: { label: "Wird vorbereitet", color: "text-[#FFD700]", icon: Clock },
  ready: { label: "Bereit zur Abholung", color: "text-[#29B6E8]", icon: Gift },
  picked_up: { label: "Abgeholt", color: "text-[#00FF88]", icon: CheckCircle2 },
  expired: { label: "Verfallen", color: "text-[#FF3B30]", icon: XCircle },
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE");
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

export default function MyPrizesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/prizes/me").then(({ data }) => { setItems(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["prizes", "tournaments"]);

  const open = items.filter((p) => ["pending", "ready"].includes(p.status));
  const closed = items.filter((p) => ["picked_up", "expired"].includes(p.status));
  const ready = items.filter((p) => p.status === "ready");
  const teamPrizes = items.filter((p) => p.recipient_type === "team");

  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spieler</span>
        <h1 className="font-heading text-3xl md:text-5xl font-black uppercase mt-1 mb-4">Meine Gewinne</h1>
        <p className="text-white/60 max-w-2xl mb-8">
          Hier siehst du alle Preise, die du in TLS-Turnieren gewonnen hast — und ob sie schon zur Abholung bereit sind.
        </p>

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <PrizeStat icon={Gift} label="Offen" value={open.length} color="#FFD700" />
            <PrizeStat icon={MapPin} label="Abholbereit" value={ready.length} color="#29B6E8" />
            <PrizeStat icon={CheckCircle2} label="Abgeholt" value={closed.filter((p) => p.status === "picked_up").length} color="#00FF88" />
            <PrizeStat icon={Users} label="Team-Preise" value={teamPrizes.length} color="#10B981" />
          </div>
        )}

        {loading && <div className="text-white/40">Lade…</div>}

        {!loading && items.length === 0 && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-12 text-center">
            <Award className="w-12 h-12 text-white/20 mx-auto mb-3" />
            <p className="text-white/60">Noch keine Gewinne — der nächste Pokal wartet auf dich!</p>
            <Link to="/tournaments" className="inline-block mt-4 px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Aktuelle Turniere</Link>
          </div>
        )}

        {open.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-heading font-bold uppercase tracking-widest text-[#29B6E8] mb-4">Offene Gewinne</h2>
            <div className="grid sm:grid-cols-2 gap-4">{open.map((p) => <PrizeCard key={p.id} p={p} highlight />)}</div>
          </section>
        )}

        {closed.length > 0 && (
          <section>
            <h2 className="text-lg font-heading font-bold uppercase tracking-widest text-white/60 mb-4">Archiv</h2>
            <div className="grid sm:grid-cols-2 gap-4">{closed.map((p) => <PrizeCard key={p.id} p={p} />)}</div>
          </section>
        )}
      </div>
    </PublicLayout>
  );
}

function PrizeStat({ icon: Icon, label, value, color }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-2 font-heading text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function PrizeCard({ p, highlight }) {
  const s = STATUS[p.status] || STATUS.pending;
  const Icn = s.icon;
  const due = daysUntil(p.pickup_deadline);
  const urgent = ["pending", "ready"].includes(p.status) && due !== null && due <= 14;
  return (
    <div data-testid={`my-prize-${p.id}`} className={`border rounded-sm p-5 ${highlight ? "border-[#29B6E8]/40 bg-gradient-to-br from-[#29B6E8]/5 to-transparent" : "border-white/10 bg-[#121212]"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5" /> Platz #{p.place}
          </div>
          <div className="font-heading font-bold text-lg uppercase mt-1">{p.prize_label}</div>
          {p.recipient_type === "team" && (
            <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#10B981]">
              <Users className="w-3 h-3" /> Team-Gewinn: {p.recipient_label}
            </div>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${s.color}`}>
          <Icn className="w-3.5 h-3.5" /> {s.label}
        </span>
      </div>
      {p.tournament_slug && (
        <Link to={`/tournaments/${p.tournament_slug}`} className="text-sm text-white/70 hover:text-[#29B6E8] block mb-2">
          {p.tournament_title}
        </Link>
      )}
      {p.prize_value && <div className="text-xs text-white/40">{p.prize_value}</div>}
      {p.status === "ready" && (
        <div className="mt-3 text-xs text-[#29B6E8] flex items-center gap-1.5 border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm px-3 py-2">
          <MapPin className="w-3 h-3" /> Hol dir deinen Preis beim nächsten Vereinsabend!
        </div>
      )}
      {p.pickup_deadline && p.status !== "picked_up" && p.status !== "expired" && (
        <div className={`mt-3 text-[11px] flex items-center gap-1.5 ${urgent ? "text-[#FFD700]" : "text-white/40"}`}>
          <CalendarDays className="w-3 h-3" />
          Abholbar bis: {formatDate(p.pickup_deadline)}
          {urgent && <span className="font-bold uppercase tracking-widest">· {due < 0 ? "überfällig" : `${due} Tage`}</span>}
        </div>
      )}
      {p.picked_up_at && (
        <div className="mt-2 text-[11px] text-white/40">
          Übergeben: {formatDate(p.picked_up_at)}
        </div>
      )}
    </div>
  );
}
