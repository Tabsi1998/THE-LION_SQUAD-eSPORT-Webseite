import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { dayNoon, viennaDate } from "@/lib/vienna";
import { markWhatsNewSeen, whatsNewItems } from "@/lib/whatsNew";
import whatsNew from "@/whatsnew.json";

// „Neu auf der Website“ (#1240): je Neuerung ein Satz mit Datum, die neuesten oben, höchstens die letzten 30. Die
// Sätze kommen aus `src/whatsnew.json`; beim Öffnen verschwindet der Punkt am Link in der Fußzeile.

export default function WhatsNewPage({ data = whatsNew }) {
  const items = useMemo(() => whatsNewItems(data), [data]);
  useDocumentTitle("Neu auf der Website", "Die letzten Neuerungen auf der Website von THE LION SQUAD - je ein Satz.");

  useEffect(() => {
    markWhatsNewSeen(items);
  }, [items]);

  return (
    <PublicLayout>
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Neu" }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Website</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Neu auf der Website</h1>
        <p className="mt-3 text-white/60 max-w-2xl">Die letzten Neuerungen, je in einem Satz.</p>
        {items.length > 0 ? (
          <ol className="mt-10 border-t border-white/10" data-testid="whatsnew-list">
            {items.map((item, index) => (
              <li key={`${item.date}-${index}`} data-testid={`whatsnew-item-${index}`} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6 py-4 border-b border-white/10">
                <time dateTime={item.date} className="text-xs font-bold uppercase tracking-widest text-white/45 tabular-nums sm:pt-0.5">
                  {viennaDate(dayNoon(item.date), { day: "2-digit", month: "2-digit", year: "numeric" })}
                </time>
                <p className="text-white/85 leading-relaxed">
                  {item.text}
                  {item.link && (
                    <>
                      {" "}
                      <Link to={item.link} className="inline-flex items-center gap-1 text-[#29B6E8] hover:underline whitespace-nowrap">
                        Ansehen <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-10 text-white/45" data-testid="whatsnew-empty">Gerade gibt es nichts Neues.</p>
        )}
      </article>
    </PublicLayout>
  );
}
