import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { MapPin, Calendar } from "lucide-react";

export default function EventsPage() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/events").then(({ data }) => setList(data)); }, []);

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Events</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Vereinsevents</h1>
        <div className="mt-10 grid md:grid-cols-2 gap-6">
          {list.map((e) => (
            <Link
              key={e.id}
              to={`/events/${e.slug || e.id}`}
              data-testid={`event-card-${e.slug}`}
              className="group block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm overflow-hidden bg-[#121212] transition"
            >
              <div className="aspect-[16/9] overflow-hidden relative">
                {e.banner_url && <img src={e.banner_url} className="w-full h-full object-cover group-hover:scale-105 transition" alt="" />}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] to-transparent" />
                <div className="absolute top-3 left-3"><StatusBadge status={e.status || "upcoming"} /></div>
              </div>
              <div className="p-5">
                <h3 className="font-heading text-2xl font-bold group-hover:text-[#29B6E8] transition">{e.name}</h3>
                <p className="mt-2 text-sm text-white/60 line-clamp-2">{e.description}</p>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/60">
                  {e.start_date && <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{new Date(e.start_date).toLocaleDateString("de-DE")}</span>}
                  {e.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{e.location}</span>}
                </div>
              </div>
            </Link>
          ))}
          {list.length === 0 && <div className="col-span-full text-center py-20 text-white/40 font-display tracking-widest">KEINE EVENTS</div>}
        </div>
      </div>
    </PublicLayout>
  );
}
