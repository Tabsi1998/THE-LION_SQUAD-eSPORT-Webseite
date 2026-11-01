// Suche und „Mehr laden“ der Bildauswahl (#2122) - dieselben in Bildfeld, Texteditor und Galerie.
import { Search } from "lucide-react";

export function MediaLibrarySearch({ library, testId = "media-library" }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3">
        <Search className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
        <input
          type="search"
          value={library.search}
          onChange={(event) => library.setSearch(event.target.value)}
          placeholder="Dateinamen suchen …"
          aria-label="Medien suchen"
          data-testid={`${testId}-search`}
          className="min-h-11 w-full bg-transparent text-sm text-white focus:outline-none"
        />
      </label>
      <span className="text-xs tabular-nums text-white/45" data-testid={`${testId}-count`}>
        {library.items.length} von {library.total}
      </span>
    </div>
  );
}

export function MediaLibraryMore({ library, testId = "media-library" }) {
  if (!library.hasMore) return null;
  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={library.loadMore}
        disabled={library.loadingMore}
        data-testid={`${testId}-more`}
        className="min-h-11 rounded-sm border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 disabled:opacity-50"
      >
        {library.loadingMore ? "Lade …" : "Mehr laden"}
      </button>
    </div>
  );
}
