import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, formatRequestError, formatUploadError, resolveMediaUrl, uploadApi } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload, prepareImageForUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { UploadProgressPanel } from "@/components/tls/UploadProgressPanel";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useUploadProgress } from "@/hooks/useUploadProgress";
import {
  buildExternalGalleryPayload,
  galleryMediaUrl,
  galleryPosterUrl,
  isVideoLike,
  MEDIA_ACCEPT,
  mediaTypeFromItem,
  mediaTypeFromFile,
  providerLabel,
} from "@/lib/galleryMedia";
import { logUploadClientFailure } from "@/lib/uploadDiagnostics";
import { toast } from "sonner";
import { Plus, Save, X, Trash2, Image as ImageIcon, ArrowLeft, Upload, Link as LinkIcon, Play, Film, Layers, Pencil } from "lucide-react";

const parseUploadMb = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_VIDEO_UPLOAD_MB = parseUploadMb(process.env.REACT_APP_MAX_VIDEO_UPLOAD_MB, 1536);
const PROXY_UPLOAD_LIMIT_MB = parseUploadMb(process.env.REACT_APP_PROXY_UPLOAD_LIMIT_MB, 1700);
const VIDEO_MAX_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024;

function albumMediaCount(album) {
  return album.media_count ?? ((album.photo_count || 0) + (album.video_count || 0));
}

const UNSECTIONED_VALUE = "__none";

function sortSections(sections) {
  return [...(sections || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || String(a.title || "").localeCompare(String(b.title || "")));
}

function sectionIdFromValue(value) {
  return value && value !== UNSECTIONED_VALUE ? value : null;
}

function sectionValue(sectionId) {
  return sectionId || UNSECTIONED_VALUE;
}

function sectionTitle(sections, sectionId) {
  return sections.find((section) => section.id === sectionId)?.title || "Ohne Abschnitt";
}

function mediaGroupsBySection(media, sections, includeEmpty = false) {
  const orderedSections = sortSections(sections);
  if (!orderedSections.length) {
    return [{ id: "__all", title: "Medien", description: "", items: media || [], section: null }];
  }
  const groups = orderedSections
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description || "",
      section,
      items: (media || []).filter((item) => item.section_id === section.id),
    }))
    .filter((group) => includeEmpty || group.items.length > 0);
  const unsectioned = (media || []).filter((item) => !orderedSections.some((section) => section.id === item.section_id));
  if (unsectioned.length) {
    groups.push({ id: UNSECTIONED_VALUE, title: "Ohne Abschnitt", description: "", section: null, items: unsectioned });
  }
  return groups;
}

function captionFromFilename(name, fallback = "Medium") {
  return (name || fallback).replace(/\.[^/.]+$/, "");
}

function galleryPayloadFromMediaItem(item, orderIndex, sectionId = null) {
  const type = mediaTypeFromItem(item);
  const base = {
    caption: captionFromFilename(item.original_filename || item.filename, type === "video" ? "Video" : "Bild"),
    order_index: orderIndex,
    section_id: sectionId || null,
    thumbnail_url: type === "image" ? item.url : "",
    original_url: item.original_url || null,
    original_filename: item.original_filename || null,
    original_mime: item.original_mime || null,
    original_file_size: item.original_file_size || null,
    mime: item.mime || undefined,
    file_size: item.original_file_size || item.size || undefined,
    width: item.width || undefined,
    height: item.height || undefined,
  };
  if (type === "video") {
    return {
      ...base,
      media_type: "video",
      source_type: "upload",
      video_url: item.url,
      thumbnail_url: "",
    };
  }
  return {
    ...base,
    media_type: "image",
    source_type: "upload",
    image_url: item.url,
  };
}

export default function AdminGalleryPage() {
  const [albums, setAlbums] = useState([]);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [events, setEvents] = useState([]);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/admin/gallery");
    setAlbums(data);
  }, []);

  useEffect(() => {
    load();
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data)).catch(() => {});
  }, [load]);
  useApiInvalidation(load, ["gallery"]);

  const remove = async (id) => {
    if (!await confirm({
      title: "Album löschen?",
      description: "Das Album und alle zugeordneten Medien werden entfernt.",
      confirmLabel: "Löschen",
    })) return;
    const previous = albums;
    setAlbums((rows) => rows.filter((a) => a.id !== id));
    if (activeAlbum?.id === id) setActiveAlbum(null);
    if (editingAlbum?.id === id) setEditingAlbum(null);
    try {
      await api.delete(`/gallery/${id}`);
      toast.success("Gelöscht.");
      load();
    } catch (err) {
      setAlbums(previous);
      toast.error(formatApiError(err.response?.data?.detail));
      load();
    }
  };

  if (activeAlbum) {
    return <AlbumPhotos album={activeAlbum} events={events} onBack={() => { setActiveAlbum(null); load(); }} />;
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Galerie</h1>
        </div>
        <button onClick={() => setEditingAlbum({})} data-testid="album-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#1E95C2] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Album
        </button>
      </div>

      {albums.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <ImageIcon className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine Alben</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {albums.map((a) => (
            <div key={a.id} className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
              <div className="aspect-video bg-[#0A0A0A]">
                {a.cover_url ? <img src={resolveMediaUrl(a.cover_url)} alt={a.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-10 h-10 text-white/15" /></div>}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-heading font-black uppercase truncate">{a.title}</div>
                  <span className="text-[10px] uppercase tracking-widest text-white/40">{albumMediaCount(a)} Medien</span>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[#29B6E8]/80 mt-1">
                  {a.visibility} · {a.published ? "live" : "entwurf"}{a.section_count ? ` · ${a.section_count} Abschnitte` : ""}{a.video_count ? ` · ${a.video_count} Videos` : ""}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setActiveAlbum(a)} data-testid={`album-open-${a.id}`} className="flex-1 text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10">Medien</button>
                  <button onClick={() => setEditingAlbum(a)} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-white/15 text-white/70 hover:text-white">Bearb.</button>
                  <button onClick={() => remove(a.id)} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingAlbum && <AlbumModal album={editingAlbum} events={events} onClose={() => setEditingAlbum(null)} onSaved={load} />}
    </AdminLayout>
  );
}

function AlbumModal({ album, events, onClose, onSaved }) {
  const isNew = !album?.id;
  const slugFrom = (txt) => (txt || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const [form, setForm] = useState({
    title: album.title || "",
    slug: album.slug || "",
    description: album.description || "",
    cover_url: album.cover_url || "",
    event_id: album.event_id || "",
    visibility: album.visibility || "public",
    taken_at: album.taken_at?.slice(0, 10) || "",
    published: album.published ?? true,
    order_index: album.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (payload.taken_at) payload.taken_at = `${payload.taken_at}T00:00:00`;
      payload.order_index = parseInt(form.order_index) || 0;
      if (payload.slug) payload.slug = slugFrom(payload.slug);
      if (isNew) await api.post("/gallery", payload);
      else await api.patch(`/gallery/${album.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Album konnte nicht gespeichert werden.", { slug: form.slug, title: form.title }));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Neues Album" : "Album bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <Field label="Titel"><Input value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="album-title" required /></Field>
          <Field label="Slug"><Input value={form.slug} onChange={(v) => set("slug", v)} testId="album-slug" required /></Field>
          <Field label="Beschreibung"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
          <Field label="Cover-Bild"><ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} testId="album-cover" variant="wide" allowLibrary /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Verknüpftes Event">
              <select value={form.event_id || ""} onChange={(e) => set("event_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                <option value="">— keines —</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Aufgenommen am"><input type="date" value={form.taken_at} onChange={(e) => set("taken_at", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
            <Field label="Sichtbarkeit">
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} data-testid="album-visibility" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                <option value="public">Öffentlich</option>
                <option value="community">Community</option>
                <option value="members">Nur Mitglieder</option>
              </select>
            </Field>
            <Field label="Sortierung"><Input value={form.order_index} onChange={(v) => set("order_index", v)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} className="accent-[#29B6E8]" /> Veröffentlicht
          </label>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="album-save" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AlbumPhotos({ album, events, onBack }) {
  const [photos, setPhotos] = useState([]);
  const [sections, setSections] = useState([]);
  const [targetSectionId, setTargetSectionId] = useState("");
  const [editingSection, setEditingSection] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [media, setMedia] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const confirm = useConfirm();
  const uploadProgress = useUploadProgress();

  const load = useCallback(async () => {
    const { data } = await api.get(`/admin/gallery/${album.id}`);
    const nextSections = sortSections(data.sections || []);
    setSections(nextSections);
    setPhotos(data.photos || []);
    setTargetSectionId((current) => {
      if (!current) return "";
      return nextSections.some((section) => section.id === current) ? current : "";
    });
  }, [album.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["gallery"]);

  const nextOrderIndex = (sectionId = targetSectionId, offset = 0) => {
    const key = sectionId || null;
    return photos.filter((item) => (item.section_id || null) === key).length + offset + 1;
  };

  const onPickMedia = async (files) => {
    if (!files || !files.length) return;
    const picked = Array.from(files);
    uploadProgress.start(picked);
    setUploading(true);
    let ok = 0, fail = 0, originals = 0;
    for (const [index, file] of picked.entries()) {
      let kind = mediaTypeFromFile(file);
      try {
        uploadProgress.startFile(file, index, kind === "image" ? "Bild wird vorbereitet" : "Upload startet");
        if (kind === "video" && file.size > VIDEO_MAX_BYTES) {
          throw new Error(`Datei zu groß (max ${MAX_VIDEO_UPLOAD_MB} MB).`);
        }
        const uploadFile = kind === "image" ? await prepareImageForUpload(file) : file;
        const fd = new FormData();
        fd.append("file", uploadFile);
        uploadProgress.beginTransfer(uploadFile.size);
        const { data } = await uploadApi.post("/uploads/media?media_scope=gallery", fd, {
          onUploadProgress: uploadProgress.updateUpload,
        });
        if (data.media_type === "file") {
          originals++;
          uploadProgress.finishFile({ original: true });
          ok++;
          continue;
        }
        uploadProgress.setPhase("Zum Album hinzufügen");
        if (data.media_type === "video") {
          await api.post(`/gallery/${album.id}/photos`, {
            media_type: "video",
            source_type: "upload",
            video_url: data.url,
            caption: captionFromFilename(file.name, "Video"),
            order_index: nextOrderIndex(targetSectionId, ok - originals),
            section_id: targetSectionId || null,
            mime: data.mime,
            file_size: data.size,
          });
          uploadProgress.finishFile();
          ok++;
          continue;
        }
        await api.post(`/gallery/${album.id}/photos`, {
          media_type: "image",
          source_type: "upload",
          image_url: data.url,
          thumbnail_url: data.url,
          original_url: data.original_url || null,
          original_filename: data.original_filename || null,
          original_mime: data.original_mime || null,
          original_file_size: data.original_file_size || null,
          caption: captionFromFilename(file.name, "Bild"),
          order_index: nextOrderIndex(targetSectionId, ok - originals),
          section_id: targetSectionId || null,
          mime: data.mime,
          file_size: data.original_file_size || data.size,
          width: data.width,
          height: data.height,
        });
        uploadProgress.finishFile();
        ok++;
      } catch (err) {
        fail++;
        uploadProgress.failFile();
        const message = formatUploadError(err, "Upload fehlgeschlagen.", {
          appLimitMb: MAX_VIDEO_UPLOAD_MB,
          proxyLimitMb: PROXY_UPLOAD_LIMIT_MB,
        });
        await logUploadClientFailure(err, file, {
          endpoint: "/uploads/media",
          mediaScope: "gallery",
          kind,
          message,
          phase: uploadProgress.progress?.phase,
          appLimitMb: MAX_VIDEO_UPLOAD_MB,
          proxyLimitMb: PROXY_UPLOAD_LIMIT_MB,
        });
        toast.error(`${file.name}: ${message}`);
      }
    }
    setUploading(false);
    uploadProgress.finish();
    toast.success(`${Math.max(0, ok - originals)} Medium/Medien hinzugefügt${originals ? `, ${originals} Originaldatei(en) nur gespeichert` : ""}${fail ? `, ${fail} fehlgeschlagen` : ""}.`);
    load();
  };
  const remove = async (id) => {
    if (!await confirm({
      title: "Medium löschen?",
      description: "Der Eintrag wird aus diesem Album entfernt.",
      confirmLabel: "Löschen",
    })) return;
    const previous = photos;
    setPhotos((rows) => rows.filter((p) => p.id !== id));
    try {
      await api.delete(`/gallery/photos/${id}`);
      load();
    } catch (err) {
      setPhotos(previous);
      toast.error(formatApiError(err.response?.data?.detail));
      load();
    }
  };
  const saveSection = async (payload) => {
    if (editingSection?.id) {
      await api.patch(`/gallery/${album.id}/sections/${editingSection.id}`, payload);
      toast.success("Abschnitt gespeichert.");
    } else {
      await api.post(`/gallery/${album.id}/sections`, payload);
      toast.success("Abschnitt angelegt.");
    }
    setEditingSection(null);
    load();
  };
  const deleteSection = async (section) => {
    if (!await confirm({
      title: "Abschnitt löschen?",
      description: "Die Medien bleiben im Album und werden zu „Ohne Abschnitt“ verschoben.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/gallery/${album.id}/sections/${section.id}`);
      if (targetSectionId === section.id) setTargetSectionId("");
      toast.success("Abschnitt gelöscht.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const moveMediaToSection = async (item, sectionId) => {
    const cleanSectionId = sectionId || null;
    const previous = photos;
    setPhotos((rows) => rows.map((row) => row.id === item.id
      ? { ...row, section_id: cleanSectionId, section_title: sectionTitle(sections, cleanSectionId) }
      : row));
    try {
      await api.patch(`/gallery/photos/${item.id}`, { section_id: cleanSectionId });
      toast.success("Abschnitt aktualisiert.");
      load();
    } catch (err) {
      setPhotos(previous);
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const openMedia = async () => {
    setMediaOpen(true);
    setLoadingMedia(true);
    setSelectedMedia([]);
    try {
      const { data } = await api.get("/admin/media?type=media");
      setMedia(data || []);
    } catch {
      toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setLoadingMedia(false);
    }
  };
  const toggleMedia = (item) => {
    setSelectedMedia((rows) => rows.some((x) => x.url === item.url)
      ? rows.filter((x) => x.url !== item.url)
      : [...rows, item]);
  };
  const addSelectedMedia = async () => {
    if (!selectedMedia.length) return toast.error("Bitte mindestens ein Medium auswählen.");
    let ok = 0, fail = 0;
    for (const item of selectedMedia) {
      try {
        await api.post(`/gallery/${album.id}/photos`, galleryPayloadFromMediaItem(item, nextOrderIndex(targetSectionId, ok), targetSectionId || null));
        ok++;
      } catch (err) {
        fail++;
        toast.error(`${item.filename || "Medium"}: ${formatRequestError(err, "Medium konnte nicht hinzugefügt werden.")}`);
      }
    }
    toast.success(`${ok} Medium/Medien hinzugefügt${fail ? `, ${fail} fehlgeschlagen` : ""}.`);
    setMediaOpen(false);
    setSelectedMedia([]);
    load();
  };
  const addExternalMedia = async (payload) => {
    await api.post(`/gallery/${album.id}/photos`, {
      ...payload,
      order_index: nextOrderIndex(targetSectionId),
      section_id: targetSectionId || null,
    });
    toast.success("Video-Link hinzugefügt.");
    setLinkOpen(false);
    load();
  };

  return (
    <AdminLayout>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8] mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Alben
      </button>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase">{album.title}</h1>
          <div className="text-xs text-white/50">{photos.length} Medien · {sections.length} Abschnitte · /{album.slug}</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={openMedia} data-testid="photo-media-picker" className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/75 font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-white/5">
            <ImageIcon className="w-3.5 h-3.5" /> Aus Medien
          </button>
          <button type="button" onClick={() => setLinkOpen(true)} data-testid="gallery-video-link" className="inline-flex items-center gap-2 px-4 py-2 border border-[#9F7AEA]/40 text-[#C4B5FD] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#9F7AEA]/10">
            <LinkIcon className="w-3.5 h-3.5" /> Video-Link
          </button>
          <label className={`inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm cursor-pointer ${uploading ? "opacity-50" : ""}`} data-testid="media-bulk-upload">
            <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Medien hochladen"}
            <input type="file" accept={MEDIA_ACCEPT} multiple disabled={uploading} className="hidden" onChange={(e) => { onPickMedia(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      <UploadProgressPanel progress={uploadProgress.progress} className="mb-6" />

      <div className="mb-6 border border-white/10 bg-[#101010] rounded-sm p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">
              <Layers className="w-3.5 h-3.5" /> Album-Abschnitte
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {sections.length === 0 ? (
                <span className="text-sm text-white/45">Noch keine Abschnitte.</span>
              ) : sections.map((section) => (
                <div key={section.id} className="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-black/20 px-2.5 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-white">{section.title}</span>
                  <span className="text-[10px] text-white/35">#{section.order_index || 0}</span>
                  <button type="button" onClick={() => setEditingSection(section)} className="text-white/45 hover:text-[#29B6E8]" aria-label={`${section.title} bearbeiten`}>
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => deleteSection(section)} className="text-white/45 hover:text-[#FF3B30]" aria-label={`${section.title} löschen`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setEditingSection({})} data-testid="gallery-section-new" className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/15 text-white font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-white/10">
            <Plus className="w-3.5 h-3.5" /> Abschnitt
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] items-end">
          <Field label="Upload-Ziel">
            <select value={targetSectionId || ""} onChange={(e) => setTargetSectionId(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              <option value="">Ohne Abschnitt</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select>
          </Field>
          <div className="text-xs text-white/45 pb-2">
            Aktuell: <span className="text-white/75">{sectionTitle(sections, targetSectionId || null)}</span>
          </div>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Noch keine Medien. Lade Fotos oder Videos hoch, oder füge einen Video-Link hinzu.</div>
      ) : (
        <div className="space-y-8">
          {mediaGroupsBySection(photos, sections, true).map((group) => (
            <div key={group.id}>
              <div className="mb-3 flex items-end justify-between gap-3 border-b border-white/10 pb-2">
                <div>
                  <h2 className="font-heading text-lg font-black uppercase">{group.title}</h2>
                  {group.description && <p className="mt-1 text-sm text-white/50">{group.description}</p>}
                </div>
                <span className="text-[10px] uppercase tracking-widest text-white/40">{group.items.length} Medien</span>
              </div>
              {group.items.length === 0 ? (
                <div className="border border-dashed border-white/10 rounded-sm p-6 text-center text-sm text-white/35">Leer</div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                  {group.items.map((p) => (
                    <div key={p.id} className="relative group aspect-square bg-[#0A0A0A] border border-white/10">
                      <GalleryAdminThumb item={p} />
                      <MediaBadge item={p} />
                      <select
                        value={sectionValue(p.section_id)}
                        onChange={(e) => moveMediaToSection(p, sectionIdFromValue(e.target.value))}
                        className="absolute left-1 top-1 max-w-[calc(100%-2.5rem)] bg-black/75 border border-white/10 px-1.5 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition rounded-sm"
                        aria-label="Abschnitt ändern"
                      >
                        <option value={UNSECTIONED_VALUE}>Ohne Abschnitt</option>
                        {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
                      </select>
                      <button onClick={() => remove(p.id)} className="absolute top-1 right-1 p-1 bg-black/70 text-[#FF3B30] opacity-0 group-hover:opacity-100 transition" aria-label="Löschen"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mediaOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setMediaOpen(false)}>
          <div className="max-w-5xl mx-auto bg-[#121212] border border-white/10 rounded-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-heading text-xl font-black uppercase">Medienbibliothek</h3>
                <div className="text-xs text-white/45">{selectedMedia.length} ausgewählt</div>
              </div>
              <button type="button" onClick={() => setMediaOpen(false)} className="text-white/50 hover:text-white">×</button>
            </div>
            {loadingMedia ? (
              <div className="text-white/40 py-12 text-center">Lade Medien…</div>
            ) : media.length === 0 ? (
              <div className="text-white/40 py-12 text-center">Keine Medien vorhanden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {media.map((item) => {
                  const active = selectedMedia.some((x) => x.url === item.url);
                  return (
                    <button
                      key={item.filename}
                      type="button"
                      onClick={() => toggleMedia(item)}
                      className={`aspect-square border bg-[#0A0A0A] rounded-sm overflow-hidden relative ${active ? "border-[#29B6E8] ring-2 ring-[#29B6E8]/30" : "border-white/10 hover:border-[#29B6E8]/60"}`}
                      title={item.filename}
                    >
                      <GalleryAdminThumb item={item} />
                      <MediaBadge item={item} />
                      {active && <span className="absolute top-1 right-1 bg-[#29B6E8] text-black text-[10px] font-black px-1.5 py-0.5 rounded-sm">OK</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2 border-t border-white/10 pt-4">
              <button type="button" onClick={() => setMediaOpen(false)} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
              <button type="button" onClick={addSelectedMedia} disabled={!selectedMedia.length} data-testid="photo-media-add" className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Auswahl hinzufügen</button>
            </div>
          </div>
        </div>
      )}
      {linkOpen && <VideoLinkModal onClose={() => setLinkOpen(false)} onSave={addExternalMedia} />}
      {editingSection && <SectionModal section={editingSection} onClose={() => setEditingSection(null)} onSave={saveSection} />}
    </AdminLayout>
  );
}

function SectionModal({ section, onClose, onSave }) {
  const isNew = !section?.id;
  const [form, setForm] = useState({
    title: section.title || "",
    description: section.description || "",
    order_index: section.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return toast.error("Bitte Abschnittstitel eingeben.");
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        description: form.description.trim() || null,
        order_index: parseInt(form.order_index, 10) || 0,
      });
    } catch (err) {
      toast.error(formatRequestError(err, "Abschnitt konnte nicht gespeichert werden."));
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Abschnitt anlegen" : "Abschnitt bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Titel">
            <Input value={form.title} onChange={(value) => set("title", value)} placeholder="Aufbau, Tag 1, Tag 2" required testId="gallery-section-title" />
          </Field>
          <Field label="Beschreibung">
            <textarea value={form.description} onChange={(event) => set("description", event.target.value)} rows={2} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
          </Field>
          <Field label="Reihenfolge">
            <Input value={form.order_index} onChange={(value) => set("order_index", value)} testId="gallery-section-order" />
          </Field>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function GalleryAdminThumb({ item }) {
  const type = mediaTypeFromItem(item);
  const poster = galleryPosterUrl(item);
  const url = galleryMediaUrl(item);
  if (type === "image") {
    return <img src={resolveMediaUrl(poster || url)} alt={item.caption || ""} className="w-full h-full object-cover" loading="lazy" />;
  }
  if (type === "video" && url && item.source_type !== "external") {
    return (
      <video
        src={resolveMediaUrl(url)}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  if (poster) {
    return (
      <div className="relative w-full h-full">
        <img src={resolveMediaUrl(poster)} alt={item.caption || ""} className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/20" />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/35">
      <Film className="w-8 h-8" />
      <span className="text-[10px] uppercase tracking-widest font-bold text-center px-2">{type === "embed" ? "Video-Link" : "Video"}</span>
    </div>
  );
}

function MediaBadge({ item }) {
  if (!isVideoLike(item)) return null;
  const label = item.embed_provider ? providerLabel(item.embed_provider) : "Video";
  return (
    <span className="absolute left-1 bottom-1 inline-flex items-center gap-1 rounded-sm bg-black/75 px-1.5 py-1 text-[9px] font-black uppercase tracking-widest text-white">
      <Play className="w-3 h-3 fill-current" /> {label}
    </span>
  );
}

function VideoLinkModal({ onClose, onSave }) {
  const [form, setForm] = useState({ url: "", caption: "", thumbnail_url: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((cur) => ({ ...cur, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.url.trim()) return toast.error("Bitte Video-Link eingeben.");
    setSaving(true);
    try {
      await onSave(buildExternalGalleryPayload(form.url, form.caption, form.thumbnail_url));
    } catch (err) {
      toast.error(formatRequestError(err, "Video-Link konnte nicht hinzugefügt werden."));
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">Video-Link hinzufügen</h2>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <Field label="Video-URL">
            <Input value={form.url} onChange={(v) => set("url", v)} placeholder="YouTube, Twitch, Kick, Vimeo oder direkte MP4/WebM-URL" required testId="gallery-video-url" />
          </Field>
          <Field label="Titel / Caption">
            <Input value={form.caption} onChange={(v) => set("caption", v)} placeholder="Optional" testId="gallery-video-caption" />
          </Field>
          <Field label="Vorschaubild">
            <ImageUpload value={form.thumbnail_url} onChange={(v) => set("thumbnail_url", v)} testId="gallery-video-thumb" variant="wide" allowLibrary mediaScope="gallery" />
          </Field>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#9F7AEA] text-white text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#805AD5] disabled:opacity-50">
            <LinkIcon className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Link hinzufügen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}
function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
