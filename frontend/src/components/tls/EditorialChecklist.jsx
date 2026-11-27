import { CheckCircle2, Circle, Info } from "lucide-react";

function itemState(item) {
  if (item.done) {
    return {
      Icon: CheckCircle2,
      iconClass: "text-ok",
      borderClass: "border-ok/20 bg-ok/5",
      textClass: "text-white",
    };
  }
  if (item.tone === "note") {
    return {
      Icon: Info,
      iconClass: "text-brand",
      borderClass: "border-brand/20 bg-brand/5",
      textClass: "text-white/80",
    };
  }
  return {
    Icon: Circle,
    iconClass: "text-white/30",
    borderClass: "border-white/10 bg-[#121212]",
    textClass: "text-white/60",
  };
}

export function EditorialChecklist({ title = "Redaktions-Checkliste", items = [], className = "" }) {
  const done = items.filter((item) => item.done).length;
  const total = items.filter((item) => item.tone !== "note").length || items.length;

  return (
    <section className={`rounded-sm border border-white/10 bg-[#0A0A0A] p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="tls-type-label text-brand">{title}</div>
          <div className="mt-1 tls-type-small text-white/45">Vor dem Veröffentlichen kurz gegenprüfen.</div>
        </div>
        <span className="rounded-sm border border-white/10 px-2 py-1 tls-type-label text-white/45">
          {done}/{total} erledigt
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const state = itemState(item);
          const Icon = state.Icon;
          return (
            <div key={item.label} className={`rounded-sm border px-3 py-2 ${state.borderClass}`}>
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${state.iconClass}`} />
                <div className="min-w-0">
                  <div className={`tls-type-label ${state.textClass}`}>{item.label}</div>
                  {item.description && <div className="mt-0.5 tls-type-small leading-relaxed text-white/45">{item.description}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
