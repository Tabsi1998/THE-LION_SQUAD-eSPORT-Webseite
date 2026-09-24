// Einstellungen (#223): Abschnitt „Newsletter“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { Send, RefreshCw, Eye } from "lucide-react";

export function NewsletterSection({ newsletterSources, newsletter, setNewsletter, newsletterPreview, setNewsletterPreview, loadingNewsletterPreview, sendingNewsletter, loadNewsletterSources, previewNewsletter, sendNewsletter, newsletterOptions, selectedNewsletterSource }) {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-sm text-white/70">
        <div className="font-heading font-bold uppercase text-[#29B6E8] mb-1">Newsletter & Event-Mail</div>
        <p>News und Events werden beim Veröffentlichen automatisch an Nutzer mit Opt-in eingereiht. Hier kannst du Empfänger prüfen und einen Versand manuell auslösen.</p>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Typ</div>
            <select
              value={newsletter.kind}
              onChange={(e) => {
                const kind = e.target.value;
                const options = kind === "event" ? newsletterSources.events : newsletterSources.news;
                setNewsletter({ kind, id: options[0]?.id || "", force: false });
                setNewsletterPreview(null);
              }}
              data-testid="newsletter-kind"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            >
              <option value="news">News</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Quelle</div>
            <select
              value={newsletter.id}
              onChange={(e) => { setNewsletter((prev) => ({ ...prev, id: e.target.value })); setNewsletterPreview(null); }}
              data-testid="newsletter-source"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
            >
              {newsletterOptions.length === 0 && <option value="">Keine Quelle gefunden</option>}
              {newsletterOptions.map((item) => (
                <option key={item.id || item.slug} value={item.id || item.slug}>
                  {item.title || item.name || item.slug || item.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedNewsletterSource && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Status</div>
              <div className="text-white/80">{selectedNewsletterSource.published === false ? "Nicht veröffentlicht" : selectedNewsletterSource.status || "veröffentlicht"}</div>
            </div>
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Sichtbarkeit</div>
              <div className="text-white/80">{selectedNewsletterSource.visibility || "public"}</div>
            </div>
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Schon versendet</div>
              <div className="text-white/80">{selectedNewsletterSource.newsletter_sent_at ? new Date(selectedNewsletterSource.newsletter_sent_at).toLocaleString("de-DE") : "nein"}</div>
            </div>
          </div>
        )}

        <label className="inline-flex items-center gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={newsletter.force}
            onChange={(e) => setNewsletter((prev) => ({ ...prev, force: e.target.checked }))}
            data-testid="newsletter-force"
            className="accent-[#FFD700]"
          />
          <span>Erneut senden, auch wenn bereits versendet</span>
        </label>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={previewNewsletter}
            disabled={loadingNewsletterPreview || !newsletter.id}
            data-testid="newsletter-preview"
            className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" /> {loadingNewsletterPreview ? "Prüfe..." : "Empfänger prüfen"}
          </button>
          <button
            onClick={sendNewsletter}
            disabled={sendingNewsletter || !newsletter.id}
            data-testid="newsletter-send"
            className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> {sendingNewsletter ? "Reihe ein..." : "Newsletter senden"}
          </button>
          <button
            onClick={loadNewsletterSources}
            type="button"
            className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Aktualisieren
          </button>
        </div>
      </div>

      {newsletterPreview && (
        <div data-testid="newsletter-preview-result" className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">{newsletterPreview.kind === "event" ? "Event-Newsletter" : "News-Newsletter"}</div>
              <div className="font-heading text-xl font-black uppercase mt-1">{newsletterPreview.title || selectedNewsletterSource?.title || selectedNewsletterSource?.name || "Newsletter"}</div>
            </div>
            <div className="font-heading text-3xl font-black text-[#29B6E8] tabular-nums">{newsletterPreview.recipients ?? newsletterPreview.queued ?? 0}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Empfänger</div>
              <div className="text-white/80">{newsletterPreview.recipients ?? newsletterPreview.queued ?? 0}</div>
            </div>
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Sichtbarkeit</div>
              <div className="text-white/80">{newsletterPreview.visibility || selectedNewsletterSource?.visibility || "public"}</div>
            </div>
            <div className="border border-white/10 bg-black/20 rounded-sm p-3">
              <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Letzter Versand</div>
              <div className="text-white/80">{newsletterPreview.already_sent_at || newsletterPreview.sent_at ? new Date(newsletterPreview.already_sent_at || newsletterPreview.sent_at).toLocaleString("de-DE") : "nein"}</div>
            </div>
          </div>
          {(newsletterPreview.sample || []).length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2">Empfänger-Auszug</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {newsletterPreview.sample.map((user) => (
                  <div key={user.id || user.email} className="border border-white/10 bg-black/20 rounded-sm p-3 text-xs">
                    <div className="font-bold text-white/80">{user.display_name || user.email}</div>
                    <div className="text-white/45 font-mono break-all">{user.email}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {newsletterPreview.reason && <div className="text-xs text-[#FFD700] uppercase tracking-widest">Hinweis: {newsletterPreview.reason}</div>}
        </div>
      )}
    </div>
  );
}
