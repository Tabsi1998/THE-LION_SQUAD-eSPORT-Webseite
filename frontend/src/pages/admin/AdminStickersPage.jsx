import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

function errorText(err, fallback) {
  return formatApiError(err?.response?.data?.detail) || fallback;
}

export default function AdminStickersPage() {
  const [packs, setPacks] = useState([]);
  const [source, setSource] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/stickers/admin");
      setPacks(data?.packs || []);
      setSource(data?.source || null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load().catch(() => toast.error("Sticker konnten nicht geladen werden.")); }, [load]);
  useApiInvalidation(load, ["stickers"]);

  const run = async (action, success, fallback) => {
    try {
      await action();
      if (success) toast.success(success);
      await load();
      return true;
    } catch (err) {
      toast.error(errorText(err, fallback));
      return false;
    }
  };

  const createPack = async (event) => {
    event.preventDefault();
    const name = newPackName.trim();
    if (!name) return;
    const ok = await run(() => api.post("/stickers/admin/packs", { name }), "Paket angelegt.", "Paket konnte nicht angelegt werden.");
    if (ok) setNewPackName("");
  };

  const toggle = (pack) => run(
    () => api.patch(`/stickers/admin/packs/${pack.id}`, { active: !pack.active }),
    pack.active ? "Paket wird im Chat nicht mehr angeboten." : "Paket wird im Chat angeboten.",
    "Konnte nicht gespeichert werden.",
  );

  const rename = (pack, name) => run(
    () => api.patch(`/stickers/admin/packs/${pack.id}`, { name }),
    "Name gespeichert.",
    "Name konnte nicht gespeichert werden.",
  );

  const removePack = async (pack) => {
    const approved = await confirm({
      title: "Stickerpaket löschen?",
      description: `„${pack.name}“ und seine ${pack.stickers.length} Sticker verschwinden aus der Auswahl. Bereits gesendete Sticker bleiben in den Chats sichtbar.`,
      confirmLabel: "Löschen",
    });
    if (approved) await run(() => api.delete(`/stickers/admin/packs/${pack.id}`), "Paket gelöscht.", "Paket konnte nicht gelöscht werden.");
  };

  const removeSticker = async (sticker) => {
    const approved = await confirm({
      title: "Sticker löschen?",
      description: `„${sticker.name}“ lässt sich danach nicht mehr senden. In Chats, in denen er schon steht, bleibt er sichtbar.`,
      confirmLabel: "Löschen",
    });
    if (approved) await run(() => api.delete(`/stickers/admin/stickers/${sticker.id}`), "Sticker gelöscht.", "Sticker konnte nicht gelöscht werden.");
  };

  const custom = packs.filter((pack) => !pack.builtin);
  const builtin = packs.filter((pack) => pack.builtin);

  return (
    <AdminLayout>
      <div className="mb-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Content</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Sticker</h1>
        <p className="mt-2 text-white/60 text-sm max-w-2xl">
          Sticker für Team-, Turnier-, Match- und Direktchats, im Web und in der App. Eigene Pakete stehen in der Auswahl vor dem Startpaket.
        </p>
      </div>

      <section className="space-y-4" data-testid="sticker-custom-packs">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-xl font-bold uppercase">Eigene Pakete</h2>
          <form onSubmit={createPack} className="flex w-full max-w-md gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Name des neuen Pakets</span>
              <input
                value={newPackName}
                onChange={(event) => setNewPackName(event.target.value)}
                maxLength={60}
                placeholder="z. B. Lion Squad"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
              />
            </label>
            <button type="submit" disabled={!newPackName.trim()} className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs disabled:opacity-45">
              <Plus className="w-4 h-4" /> Paket anlegen
            </button>
          </form>
        </div>
        {custom.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            onToggle={toggle}
            onRename={rename}
            onDelete={removePack}
            onAdd={() => setAddingTo(pack)}
            onDeleteSticker={removeSticker}
          />
        ))}
        {loaded && custom.length === 0 && (
          <p className="border border-dashed border-white/10 rounded-sm p-6 text-sm text-white/45">
            Noch kein eigenes Paket. Lege eins an, etwa für das Maskottchen oder Vereinsmomente.
          </p>
        )}
      </section>

      <section className="mt-10 space-y-4" data-testid="sticker-builtin-packs">
        <div>
          <h2 className="font-heading text-xl font-bold uppercase">Startpaket</h2>
          {source && (
            <p className="mt-1 text-xs text-white/45">
              {source.source}, {source.license}-Lizenz ·{" "}
              <a href={resolveMediaUrl(source.license_url)} target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">Lizenztext</a>
              {" · "}
              <a href={source.project_url} target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">Projekt</a>
              . Fest mitgeliefert: abschalten geht, ändern nicht.
            </p>
          )}
        </div>
        {builtin.map((pack) => (
          <PackCard key={pack.id} pack={pack} onToggle={toggle} />
        ))}
      </section>

      {addingTo && (
        <StickerForm
          pack={addingTo}
          onClose={() => setAddingTo(null)}
          onSaved={() => { setAddingTo(null); load(); }}
        />
      )}
    </AdminLayout>
  );
}

function PackCard({ pack, onToggle, onRename, onDelete, onAdd, onDeleteSticker }) {
  const [draftName, setDraftName] = useState(null);

  const submitName = async (event) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name || name === pack.name) {
      setDraftName(null);
      return;
    }
    if (await onRename(pack, name)) setDraftName(null);
  };

  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`sticker-pack-${pack.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {draftName !== null ? (
          <form onSubmit={submitName} className="flex min-w-0 flex-1 items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Paketname</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={60}
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-1.5 rounded-sm text-sm"
              />
            </label>
            <button type="submit" aria-label="Namen speichern" className="p-1.5 text-[#29B6E8] hover:text-white"><Check className="w-4 h-4" /></button>
            <button type="button" aria-label="Abbrechen" onClick={() => setDraftName(null)} className="p-1.5 text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
          </form>
        ) : (
          <div className="min-w-0">
            <div className="font-heading text-lg font-bold truncate">{pack.name}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/45">
              {pack.stickers.length} Sticker
              {!pack.active && <span className="ml-2 font-bold text-[#FF6B61]">Nicht im Chat</span>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={pack.active} onChange={() => onToggle(pack)} className="accent-[#29B6E8]" />
            Im Chat anbieten
          </label>
          {!pack.builtin && (
            <>
              <button type="button" onClick={onAdd} className="px-3 py-1.5 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 hover:bg-[#29B6E8]/10">
                <Plus className="w-3.5 h-3.5" /> Sticker
              </button>
              <button type="button" aria-label={`${pack.name} umbenennen`} onClick={() => setDraftName(pack.name)} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
              <button type="button" aria-label={`${pack.name} löschen`} onClick={() => onDelete(pack)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
        {pack.stickers.map((sticker) => (
          <div key={sticker.id} className="relative flex aspect-square items-center justify-center rounded-sm bg-black/30 p-1" title={[sticker.name, ...(sticker.keywords || [])].join(", ")}>
            <img src={resolveMediaUrl(sticker.url)} alt={sticker.name} loading="lazy" className="h-full w-full object-contain" />
            {!pack.builtin && (
              <button
                type="button"
                onClick={() => onDeleteSticker(sticker)}
                aria-label={`${sticker.name} löschen`}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white/80 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {!pack.builtin && pack.stickers.length === 0 && (
          <p className="col-span-full text-sm text-white/40">Noch leer. Ein leeres Paket erscheint nicht im Chat.</p>
        )}
      </div>
    </div>
  );
}

function StickerForm({ pack, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", url: "", keywords: "" });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    if (!form.url) {
      toast.error("Bitte zuerst ein Bild hochladen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/stickers/admin/packs/${pack.id}/stickers`, {
        name: form.name,
        url: form.url,
        keywords: form.keywords.split(",").map((word) => word.trim()).filter(Boolean),
      });
      toast.success("Sticker hinzugefügt.");
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Sticker konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  // Seitenblatt statt Fenster (#435); Esc und Klick daneben übernimmt das Blatt.
  return (
    <AdminSheet title={`Sticker für ${pack.name}`} eyebrow="Sticker" onClose={onClose} onSubmit={save} saving={saving} submitTestId="sticker-save" testId="sticker-sheet">
      <ImageUpload
        value={form.url}
        onChange={(value) => set("url", value)}
        label="Bild"
        testId="sticker-image"
        variant="square"
        endpoint="/uploads/image?trim_empty_borders=true"
        mediaScope="admin"
        allowLibrary
      />
      <p className="text-xs text-white/45">Am besten PNG oder WebP mit durchsichtigem Hintergrund, etwa 512 × 512 Pixel. Leere Ränder schneidet der Upload ab.</p>
      <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} required maxLength={60} placeholder="z. B. Brüllender Löwe" testId="sticker-name" />
      <TextField label="Suchwörter" value={form.keywords} onChange={(v) => set("keywords", v)} placeholder="löwe, brüllen, gg" hint="Mit Komma trennen. Die Stickersuche im Chat findet Name und Suchwörter." testId="sticker-keywords" />
    </AdminSheet>
  );
}
