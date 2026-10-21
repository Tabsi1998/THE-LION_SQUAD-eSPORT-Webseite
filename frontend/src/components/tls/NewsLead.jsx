import { Link } from "react-router-dom";
import { ArrowRight, Pin } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { NewsTextCard } from "@/components/tls/NewsTextCard";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { newsCategoryColor } from "@/lib/categoryColors";

// Der Aufmacher (#1342, Fabians Variante A): eine News über die ganze Breite - links das Bild (16 : 9; 50 % am
// Tablet, 55 % am PC), rechts Kategorie, Titel, Anriss und „Weiterlesen“. Der Text steht nie auf dem Bild. Am Handy
// steht das Bild oben, der Text darunter. Ohne Bild links die Text-Karte (#1343). Dieselbe Karte oben auf der
// News-Seite (angepinnte News) und auf der Startseite.

export function NewsLead({ news, testId, headingLevel = 2, priority = false, eyebrow = null }) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const color = newsCategoryColor(news.category);
  return (
    <Link
      to={`/news/${news.slug}`}
      data-testid={testId || `news-lead-${news.slug}`}
      data-season-anchor="card"
      className="tls-card tls-reveal-item group grid md:grid-cols-2 lg:grid-cols-[55fr_45fr] items-stretch border border-white/10 rounded-sm bg-[#121212] overflow-hidden min-w-0"
    >
      {/* Am Handy 16 : 9; daneben hält der innere Platzhalter 16 : 9 als Mindesthöhe, ein längerer Text darf die Zeile strecken. */}
      <div className="relative aspect-video md:aspect-auto bg-[#0A0A0A] overflow-hidden" data-testid="news-lead-media">
        <div className="md:aspect-video">
          {news.banner_url ? (
            <LazyImg
              src={news.banner_url}
              alt=""
              priority={priority}
              sizes="(min-width: 1024px) 55vw, (min-width: 768px) 50vw, 100vw"
              className="absolute inset-0 w-full h-full object-cover tls-card__media"
            />
          ) : (
            <div className="absolute inset-0"><NewsTextCard news={news} size="lg" /></div>
          )}
        </div>
      </div>
      <div className="p-5 md:p-7 xl:p-10 flex flex-col justify-center min-w-0" data-testid="news-lead-text">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold">
          {eyebrow}
          <span style={{ color }}>{newsCategoryLabel(news.category)}</span>
          {news.pinned && <Pin className="w-3 h-3 text-white" aria-label="Angepinnt" />}
        </div>
        <Heading className="tls-card__title mt-3 font-heading text-2xl md:text-[1.7rem] xl:text-4xl font-black leading-[1.08] break-words line-clamp-4">
          {news.title}
        </Heading>
        {news.excerpt && <p className="mt-4 text-white/70 text-sm md:text-base xl:text-lg leading-relaxed line-clamp-3">{news.excerpt}</p>}
        <span className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-[#29B6E8]">
          Weiterlesen <ArrowRight className="tls-card__arrow w-3.5 h-3.5" />
        </span>
      </div>
    </Link>
  );
}
