/**
 * Phase D — Breadcrumbs.
 *
 * Usage:
 *   <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "eSports", to: "/tournaments" }, { label: t.title }]} />
 *
 * Last item is rendered as text (current page).
 */
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

export function Breadcrumbs({ items = [], className = "" }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={`text-xs ${className}`} data-testid="breadcrumbs">
      <ol className="flex items-center flex-wrap gap-1 text-white/50">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.to || item.label}-${idx}`} className="inline-flex items-center gap-1">
              {idx > 0 && <ChevronRight className="w-3 h-3 text-white/30" />}
              {isLast || !item.to ? (
                <span className="px-1 py-0.5 text-white/80 font-medium" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="px-1 py-0.5 hover:text-[#29B6E8] transition inline-flex items-center gap-1"
                >
                  {idx === 0 && <Home className="w-3 h-3" />}
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
