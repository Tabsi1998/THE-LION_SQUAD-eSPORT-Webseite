import { Link } from "react-router-dom";
import { Search } from "lucide-react";

function ActionLink({ action, primary = false }) {
  if (!action) return null;
  const cls = primary
    ? "inline-flex items-center justify-center px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#1E95C2] transition"
    : "inline-flex items-center justify-center px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/45 hover:text-white transition";
  if (action.onClick) {
    return <button type="button" onClick={action.onClick} className={cls}>{action.label}</button>;
  }
  if (action.href) {
    return <a href={action.href} target="_blank" rel="noreferrer" className={cls}>{action.label}</a>;
  }
  return <Link to={action.to || "/"} className={cls}>{action.label}</Link>;
}

export function PublicEmptyState({
  icon: Icon = Search,
  eyebrow = "Nichts gefunden",
  title,
  description,
  primaryAction,
  secondaryAction,
  className = "",
}) {
  return (
    <div className={`border border-dashed border-white/15 bg-[#121212]/70 rounded-sm px-6 py-12 text-center ${className}`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-white/10 bg-[#0A0A0A]">
        <Icon className="h-6 w-6 text-[#29B6E8]" />
      </div>
      <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[#29B6E8]">{eyebrow}</div>
      <h2 className="mt-2 font-heading text-xl font-black uppercase text-white">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/55">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <ActionLink action={primaryAction} primary />
          <ActionLink action={secondaryAction} />
        </div>
      )}
    </div>
  );
}
