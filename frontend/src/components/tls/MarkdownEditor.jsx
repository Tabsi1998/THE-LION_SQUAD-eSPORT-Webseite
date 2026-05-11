import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table as TableExtension } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  Code,
  Eye,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Images,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  PanelTop,
  PenLine,
  Quote,
  Rows3,
  Strikethrough,
  Table,
  Trash2,
  Underline as UnderlineIcon,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { prepareImageForUpload } from "@/components/tls/ImageUpload";
import { MentionSuggestionList, MentionTextarea, mentionTriggerAt, useMentionSearch } from "@/components/tls/MentionTextarea";

function normalizeMarkdown(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactInline(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function joinChildren(node, context = {}) {
  return Array.from(node.childNodes || [])
    .map((child) => htmlNodeToMarkdown(child, context))
    .join("");
}

function prefixBlock(value, prefix) {
  return normalizeMarkdown(value)
    .split("\n")
    .filter(Boolean)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => compactInline(joinChildren(cell))))
    .filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row) => Array.from({ length: width }, (_, index) => row[index] || "");
  const header = pad(rows[0]);
  const divider = header.map(() => "---");
  const body = rows.slice(1).map(pad);
  return [header, divider, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function htmlNodeToMarkdown(node, context = {}) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";

  const tag = node.tagName.toLowerCase();
  if (["script", "style", "iframe", "object", "embed", "svg", "meta", "link"].includes(tag)) return "";

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${compactInline(joinChildren(node, context))}**`;
  if (tag === "em" || tag === "i") return `*${compactInline(joinChildren(node, context))}*`;
  if (tag === "s" || tag === "del" || tag === "strike") return `~~${compactInline(joinChildren(node, context))}~~`;
  if (tag === "u") return `++${compactInline(joinChildren(node, context))}++`;
  if (tag === "code" && context.inPre) return node.textContent || "";
  if (tag === "code") return `\`${compactInline(node.textContent)}\``;
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    const label = compactInline(joinChildren(node, context)) || href;
    return href ? `[${label}](${href})` : label;
  }
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    if (!src) return "";
    const alt = node.getAttribute("alt") || "Bild";
    return `![${alt}](${src})`;
  }
  if (tag === "pre") {
    const code = joinChildren(node, { ...context, inPre: true }).trim();
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }
  if (tag === "h1") return `# ${compactInline(joinChildren(node, context))}`;
  if (tag === "h2") return `## ${compactInline(joinChildren(node, context))}`;
  if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") return `### ${compactInline(joinChildren(node, context))}`;
  if (tag === "blockquote") return prefixBlock(joinChildren(node, context), "> ");
  if (tag === "hr") return "---";
  if (tag === "ul" || tag === "ol") {
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((li, index) => {
        const marker = tag === "ol" ? `${index + 1}. ` : "- ";
        const text = normalizeMarkdown(joinChildren(li, context)).replace(/\n/g, "\n  ");
        return `${marker}${text}`;
      })
      .join("\n");
  }
  if (tag === "table") return tableToMarkdown(node);
  if (["p", "div", "section", "article", "header", "footer", "main", "aside", "figure"].includes(tag)) {
    return normalizeMarkdown(joinChildren(node, context));
  }
  if (tag === "li") return normalizeMarkdown(joinChildren(node, context));
  return joinChildren(node, context);
}

function htmlToMarkdownLite(html) {
  const raw = String(html || "").trim();
  if (!raw || raw === "<p></p>") return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return raw;
  const doc = new DOMParser().parseFromString(raw, "text/html");
  return normalizeMarkdown(Array.from(doc.body.childNodes).map((node) => htmlNodeToMarkdown(node)).join("\n\n"));
}

function markdownToEditorHtml(value) {
  const html = renderMarkdownLite(value);
  return html || "<p></p>";
}

function defaultLibraryEndpoint() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin")
    ? "/admin/media?type=images"
    : "/media?type=images";
}

function defaultMediaScope() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? "admin" : "user";
}

function endpointWithMediaScope(endpoint, scope) {
  if (!scope || scope === "user") return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}media_scope=${encodeURIComponent(scope)}`;
}

function ToolButton({ active, label, onClick, icon: Icon, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      disabled={disabled}
      className={`w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-sm border transition ${
        active
          ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]"
          : "border-white/10 text-white/65 hover:text-white hover:border-[#29B6E8]/60"
      } disabled:opacity-35 disabled:pointer-events-none`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function MediaThumb({ item, onSelect }) {
  const [error, setError] = useState(false);
  const label = item.alt_text || item.filename || "Bild";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group text-left border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden hover:border-[#29B6E8]/70 transition"
      title={item.filename}
    >
      <div className="aspect-square">
        {error ? (
          <div className="w-full h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-[#FF3B30]">
            Defekt
          </div>
        ) : (
          <img
            src={resolveMediaUrl(item.url)}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setError(true)}
          />
        )}
      </div>
      <div className="px-2 py-1.5 text-[10px] text-white/45 truncate group-hover:text-white/75">{label}</div>
    </button>
  );
}

export function MarkdownEditor({
  value = "",
  onChange,
  rows = 12,
  testId,
  placeholder = "",
  helperText = "WYSIWYG-Editor mit Markdown-Speicherung, HTML-Import, Tabellen und Medienbibliothek.",
  required = false,
  libraryEndpoint,
  uploadEndpoint = "/uploads/image",
  mediaScope,
  mentionsEnabled = true,
  mentionScope,
  mentionScopeId,
}) {
  const [mode, setMode] = useState("visual");
  const [htmlInput, setHtmlInput] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [media, setMedia] = useState([]);
  const [visualMention, setVisualMention] = useState(null);
  const [visualMentionIndex, setVisualMentionIndex] = useState(0);
  const [visualMentionPosition, setVisualMentionPosition] = useState({ left: 12, top: 44 });
  const visualEditorWrapRef = useRef(null);
  const imageInputRef = useRef(null);
  const prompt = usePrompt();
  const syncingRef = useRef(false);
  const preview = useMemo(() => renderMarkdownLite(value), [value]);
  const mentionSearch = useMentionSearch(mentionsEnabled ? visualMention?.query || "" : "", {
    scope: mentionScope,
    scopeId: mentionScopeId,
  });

  function refreshVisualMention(nextEditor = editor) {
    if (!mentionsEnabled || !nextEditor || mode !== "visual") {
      setVisualMention(null);
      return;
    }
    const { selection } = nextEditor.state;
    if (!selection.empty) {
      setVisualMention(null);
      return;
    }
    const from = selection.$from;
    const before = from.parent.textBetween(0, from.parentOffset, "\n", "\n");
    const trigger = mentionTriggerAt(before, before.length);
    if (!trigger) {
      setVisualMention(null);
      return;
    }
    try {
      const coords = nextEditor.view.coordsAtPos(from.pos);
      const wrap = visualEditorWrapRef.current?.getBoundingClientRect();
      if (wrap) {
        setVisualMentionPosition({
          left: Math.max(8, coords.left - wrap.left),
          top: Math.max(8, coords.bottom - wrap.top + 4),
        });
      }
    } catch {}
    setVisualMention({ query: trigger.query, from: from.pos - trigger.query.length - 1, to: from.pos });
    setVisualMentionIndex(0);
  }

  function insertVisualMention(user) {
    if (!editor || !visualMention) return;
    editor.chain().focus().insertContentAt(
      { from: visualMention.from, to: visualMention.to },
      [
        {
          type: "text",
          text: `@${user.username}`,
          marks: [{ type: "link", attrs: { href: `/u/${encodeURIComponent(user.username)}` } }],
        },
        { type: "text", text: " " },
      ],
    ).run();
    setVisualMention(null);
  }

  function handleVisualKeyDown(event) {
    const open = !!visualMention && (mentionSearch.loading || mentionSearch.items.length > 0);
    if (!open || !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setVisualMention(null);
      return;
    }
    if (event.key === "ArrowDown") {
      setVisualMentionIndex((index) => Math.min(index + 1, Math.max(mentionSearch.items.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      setVisualMentionIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (mentionSearch.items[visualMentionIndex]) insertVisualMention(mentionSearch.items[visualMentionIndex]);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: false,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      ImageExtension.configure({ allowBase64: false }),
      TableExtension.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: placeholder || "Text schreiben..." }),
    ],
    content: markdownToEditorHtml(value),
    editorProps: {
      attributes: {
        class: "tiptap-editor prose-cms min-h-48 px-4 py-4 focus:outline-none",
        "data-testid": testId ? `${testId}-visual` : "markdown-editor-visual",
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (syncingRef.current) return;
      onChange(htmlToMarkdownLite(nextEditor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = htmlToMarkdownLite(editor.getHTML());
    const next = normalizeMarkdown(value);
    if (current === next) return;
    syncingRef.current = true;
    editor.commands.setContent(markdownToEditorHtml(next), { emitUpdate: false });
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, [editor, value]);

  const run = (command) => {
    if (!editor) return;
    command(editor.chain().focus()).run();
  };

  const setLink = async () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href || "";
    const href = await prompt({
      title: "Link einfügen",
      description: "URL für den markierten Text.",
      defaultValue: previous,
      placeholder: "https://...",
      confirmLabel: "Link setzen",
      multiline: false,
    });
    if (href === false) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  const setImageUrl = async () => {
    if (!editor) return;
    const src = await prompt({
      title: "Bild per URL einfügen",
      description: "Direkte Bild-URL einfügen. Für eigene Bilder besser die Medienbibliothek verwenden.",
      placeholder: "https://...",
      confirmLabel: "Bild einfügen",
      multiline: false,
    });
    if (src === false) return;
    if (!src?.trim()) return;
    editor.chain().focus().setImage({ src: src.trim(), alt: "Bild" }).run();
  };

  const uploadImageFile = async (file) => {
    if (!editor || !file) return;
    setImageUploading(true);
    try {
      const uploadFile = await prepareImageForUpload(file);
      const fd = new FormData();
      fd.append("file", uploadFile);
      const scope = mediaScope || defaultMediaScope();
      const { data } = await api.post(endpointWithMediaScope(uploadEndpoint, scope), fd);
      editor.chain().focus().setImage({ src: data.url, alt: file.name || "Bild" }).run();
      toast.success("Bild hochgeladen und eingefügt.");
    } catch (error) {
      const detail = error.response?.data?.detail;
      toast.error(detail ? formatApiError(detail) : error.message || "Bild konnte nicht hochgeladen werden.");
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
      setImageUploading(false);
    }
  };

  const openMedia = async () => {
    setMediaOpen(true);
    setMediaLoading(true);
    try {
      const { data } = await api.get(libraryEndpoint || defaultLibraryEndpoint());
      setMedia(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setMediaLoading(false);
    }
  };

  const insertMedia = (item) => {
    if (!editor) return;
    editor.chain().focus().setImage({ src: item.url, alt: item.alt_text || item.filename || "Bild" }).run();
    setMediaOpen(false);
  };

  const importHtml = (append = false) => {
    if (!editor) return;
    const raw = htmlInput.trim();
    if (!raw) {
      toast.error("Kein HTML-Inhalt zum Umwandeln gefunden.");
      return;
    }
    if (append) editor.chain().focus().insertContent(raw).run();
    else editor.commands.setContent(raw);
    onChange(htmlToMarkdownLite(editor.getHTML()));
    setMode("visual");
    toast.success("HTML wurde in sicheren Inhalt umgewandelt.");
  };

  const tableActive = editor?.isActive("table");

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden" data-testid={testId} data-markdown-editor={testId || "default"}>
      <div className="border-b border-white/10 bg-[#121212]">
        <div className="flex flex-col gap-2 px-2 py-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap gap-1 min-w-0">
            <ToolButton label="Überschrift 1" icon={Heading1} active={editor?.isActive("heading", { level: 1 })} onClick={() => run((c) => c.toggleHeading({ level: 1 }))} />
            <ToolButton label="Überschrift 2" icon={Heading2} active={editor?.isActive("heading", { level: 2 })} onClick={() => run((c) => c.toggleHeading({ level: 2 }))} />
            <ToolButton label="Überschrift 3" icon={Heading3} active={editor?.isActive("heading", { level: 3 })} onClick={() => run((c) => c.toggleHeading({ level: 3 }))} />
            <ToolButton label="Fett" icon={Bold} active={editor?.isActive("bold")} onClick={() => run((c) => c.toggleBold())} />
            <ToolButton label="Kursiv" icon={Italic} active={editor?.isActive("italic")} onClick={() => run((c) => c.toggleItalic())} />
            <ToolButton label="Unterstrichen" icon={UnderlineIcon} active={editor?.isActive("underline")} onClick={() => run((c) => c.toggleUnderline())} />
            <ToolButton label="Durchgestrichen" icon={Strikethrough} active={editor?.isActive("strike")} onClick={() => run((c) => c.toggleStrike())} />
            <ToolButton label="Liste" icon={List} active={editor?.isActive("bulletList")} onClick={() => run((c) => c.toggleBulletList())} />
            <ToolButton label="Nummerierte Liste" icon={ListOrdered} active={editor?.isActive("orderedList")} onClick={() => run((c) => c.toggleOrderedList())} />
            <ToolButton label="Zitat" icon={Quote} active={editor?.isActive("blockquote")} onClick={() => run((c) => c.toggleBlockquote())} />
            <ToolButton label="Code" icon={Code} active={editor?.isActive("code")} onClick={() => run((c) => c.toggleCode())} />
            <ToolButton label="Code-Block" icon={FileCode} active={editor?.isActive("codeBlock")} onClick={() => run((c) => c.toggleCodeBlock())} />
            <ToolButton label="Trennlinie" icon={Minus} onClick={() => run((c) => c.setHorizontalRule())} />
            <ToolButton label="Link" icon={LinkIcon} active={editor?.isActive("link")} onClick={setLink} />
            <ToolButton label="Bild-URL" icon={Image} active={editor?.isActive("image")} onClick={setImageUrl} />
            <ToolButton label="Bild hochladen" icon={Upload} disabled={imageUploading} onClick={() => imageInputRef.current?.click()} />
            <ToolButton label="Bild aus Medienbibliothek" icon={Images} onClick={openMedia} />
            <ToolButton label="Tabelle einfügen" icon={Table} active={tableActive} onClick={() => run((c) => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }))} />
            <ToolButton label="Zeile hinzufügen" icon={Rows3} disabled={!tableActive} onClick={() => run((c) => c.addRowAfter())} />
            <ToolButton label="Spalte hinzufügen" icon={PanelTop} disabled={!tableActive} onClick={() => run((c) => c.addColumnAfter())} />
            <ToolButton label="Tabelle löschen" icon={Trash2} disabled={!tableActive} onClick={() => run((c) => c.deleteTable())} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 border border-white/10 rounded-sm overflow-hidden shrink-0 lg:self-start">
            {[
              ["visual", PenLine, "Editor"],
              ["markdown", Code, "Markdown"],
              ["preview", Eye, "Vorschau"],
              ["html", FileCode, "HTML"],
            ].map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold inline-flex items-center justify-center gap-1.5 ${mode === key ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => uploadImageFile(event.target.files?.[0])}
          />
        </div>
      </div>

      {mode === "visual" && (
        <div ref={visualEditorWrapRef} className="relative" onKeyDown={handleVisualKeyDown} onKeyUp={() => refreshVisualMention()} onMouseUp={() => refreshVisualMention()}>
          <EditorContent editor={editor} />
          {!!visualMention && (mentionSearch.loading || mentionSearch.items.length > 0) && (
            <MentionSuggestionList
              items={mentionSearch.items}
              loading={mentionSearch.loading}
              activeIndex={visualMentionIndex}
              onPick={insertVisualMention}
              className="absolute"
              style={visualMentionPosition}
            />
          )}
        </div>
      )}

      {mode === "markdown" && (
        <MentionTextarea
          value={value || ""}
          onValueChange={onChange}
          scope={mentionScope}
          scopeId={mentionScopeId}
          rows={rows}
          required={required}
          placeholder={placeholder}
          data-testid={testId ? `${testId}-markdown` : "markdown-editor-source"}
          textareaClassName="w-full bg-[#0A0A0A] px-3 py-3 text-sm font-mono text-white focus:outline-none resize-y min-h-40"
        />
      )}

      {mode === "preview" && (
        <div className="min-h-48 p-4 prose-cms text-sm" dangerouslySetInnerHTML={{ __html: preview || '<p class="text-white/35">Keine Vorschau</p>' }} />
      )}

      {mode === "html" && (
        <div className="p-3 space-y-3">
          <textarea
            value={htmlInput}
            onChange={(e) => setHtmlInput(e.target.value)}
            rows={Math.max(6, Math.min(rows, 12))}
            placeholder="<h2>Überschrift</h2><p>Text mit <strong>Formatierung</strong></p>"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-3 text-sm font-mono text-white focus:outline-none resize-y"
          />
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button type="button" onClick={() => importHtml(true)} className="px-3 py-2 border border-white/15 text-white/70 rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-white/5">
              In Editor einfügen
            </button>
            <button type="button" onClick={() => importHtml(false)} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-xs font-black uppercase tracking-wider hover:bg-[#6FD6FF]">
              HTML übernehmen
            </button>
          </div>
          <p className="text-[11px] text-white/40">Scripts, iFrames und fremde Layout-Attribute werden nicht übernommen. Tabellen, Links, Bilder, Listen und Basisformatierungen werden konvertiert.</p>
        </div>
      )}

      {helperText && <div className="border-t border-white/10 px-3 py-2 text-[11px] text-white/40">{helperText}</div>}

      {mediaOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setMediaOpen(false)}>
          <div className="max-w-5xl mx-auto bg-[#121212] border border-white/10 rounded-sm p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="font-heading text-xl font-black uppercase">Bild einfügen</h3>
              <button type="button" onClick={() => setMediaOpen(false)} className="w-9 h-9 inline-flex items-center justify-center text-white/50 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {mediaLoading ? (
              <div className="text-white/40 py-12 text-center">Lade Medien…</div>
            ) : media.length === 0 ? (
              <div className="text-white/40 py-12 text-center">Keine Bilder in der Medienbibliothek vorhanden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {media.map((item) => (
                  <MediaThumb key={item.filename || item.url} item={item} onSelect={insertMedia} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
