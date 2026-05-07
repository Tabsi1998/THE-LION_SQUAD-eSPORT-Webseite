import { useMemo, useRef, useState } from "react";
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
  PenLine,
  Quote,
  Strikethrough,
  Table,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, resolveMediaUrl } from "@/lib/api";
import { renderMarkdownLite } from "@/lib/markdownLite";

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
  if (tag === "s" || tag === "del") return `~~${compactInline(joinChildren(node, context))}~~`;
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
  if (!raw) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return raw;
  const doc = new DOMParser().parseFromString(raw, "text/html");
  return normalizeMarkdown(Array.from(doc.body.childNodes).map((node) => htmlNodeToMarkdown(node)).join("\n\n"));
}

function wrapSelection(text, selectionStart, selectionEnd, before, after = before, placeholder = "Text") {
  const selected = text.slice(selectionStart, selectionEnd) || placeholder;
  return {
    value: `${text.slice(0, selectionStart)}${before}${selected}${after}${text.slice(selectionEnd)}`,
    cursor: selectionStart + before.length + selected.length + after.length,
  };
}

function prefixLines(text, selectionStart, selectionEnd, prefix) {
  const lineStart = text.lastIndexOf("\n", Math.max(selectionStart - 1, 0)) + 1;
  const lineEndCandidate = text.indexOf("\n", selectionEnd);
  const lineEnd = lineEndCandidate === -1 ? text.length : lineEndCandidate;
  const selected = text.slice(lineStart, lineEnd) || "Text";
  const next = selected
    .split("\n")
    .map((line) => `${prefix}${line.replace(/^(\s*[-*>#]+\s*|\s*\d+\.\s*)/, "")}`)
    .join("\n");
  return {
    value: `${text.slice(0, lineStart)}${next}${text.slice(lineEnd)}`,
    cursor: lineStart + next.length,
  };
}

function insertBlock(text, selectionStart, selectionEnd, block) {
  const prefix = selectionStart === 0 || text.slice(0, selectionStart).endsWith("\n") ? "" : "\n";
  const suffix = text.slice(selectionEnd).startsWith("\n") ? "" : "\n";
  return {
    value: `${text.slice(0, selectionStart)}${prefix}${block}${suffix}${text.slice(selectionEnd)}`,
    cursor: selectionStart + prefix.length + block.length,
  };
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
  helperText = "Formatierter Text: Markdown, Tabellen, Code-Bloecke, Medienbibliothek und HTML-Import. HTML wird beim Import in sicheren Inhalt umgewandelt.",
  required = false,
}) {
  const [mode, setMode] = useState("write");
  const [htmlInput, setHtmlInput] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [media, setMedia] = useState([]);
  const textareaRef = useRef(null);
  const preview = useMemo(() => renderMarkdownLite(value), [value]);

  const focusAt = (textarea, cursor) => {
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const updateFromResult = (result) => {
    if (!result) return;
    onChange(result.value);
    focusAt(textareaRef.current, result.cursor);
  };

  const apply = (kind) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? String(value).length;
    const end = textarea?.selectionEnd ?? String(value).length;
    let result;
    if (kind === "h1") result = prefixLines(value, start, end, "# ");
    if (kind === "h2") result = prefixLines(value, start, end, "## ");
    if (kind === "h3") result = prefixLines(value, start, end, "### ");
    if (kind === "bold") result = wrapSelection(value, start, end, "**", "**", "fetter Text");
    if (kind === "italic") result = wrapSelection(value, start, end, "*", "*", "kursiver Text");
    if (kind === "strike") result = wrapSelection(value, start, end, "~~", "~~", "durchgestrichen");
    if (kind === "code") result = wrapSelection(value, start, end, "`", "`", "code");
    if (kind === "codeblock") result = insertBlock(value, start, end, "```\nCode hier einfuegen\n```");
    if (kind === "ul") result = prefixLines(value, start, end, "- ");
    if (kind === "ol") result = prefixLines(value, start, end, "1. ");
    if (kind === "quote") result = prefixLines(value, start, end, "> ");
    if (kind === "link") result = wrapSelection(value, start, end, "[", "](https://)", "Linktext");
    if (kind === "image") result = wrapSelection(value, start, end, "![", "](https://)", "Bildbeschreibung");
    if (kind === "table") result = insertBlock(value, start, end, "| Titel | Info |\n| --- | --- |\n| Wert | Beschreibung |");
    if (kind === "hr") result = insertBlock(value, start, end, "---");
    updateFromResult(result);
  };

  const openMedia = async () => {
    setMediaOpen(true);
    setMediaLoading(true);
    try {
      const { data } = await api.get("/media?type=images");
      setMedia(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setMediaLoading(false);
    }
  };

  const insertMedia = (item) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? String(value).length;
    const end = textarea?.selectionEnd ?? String(value).length;
    const alt = item.alt_text || item.filename || "Bild";
    updateFromResult(insertBlock(value, start, end, `![${alt}](${item.url})`));
    setMediaOpen(false);
  };

  const importHtml = (append = false) => {
    const converted = htmlToMarkdownLite(htmlInput);
    if (!converted) {
      toast.error("Kein HTML-Inhalt zum Umwandeln gefunden.");
      return;
    }
    if (append && value) onChange(normalizeMarkdown(`${value}\n\n${converted}`));
    else onChange(converted);
    setMode("write");
    toast.success("HTML wurde in sicheren Inhalt umgewandelt.");
  };

  const tools = [
    ["h1", Heading1, "Überschrift 1"],
    ["h2", Heading2, "Überschrift 2"],
    ["h3", Heading3, "Überschrift 3"],
    ["bold", Bold, "Fett"],
    ["italic", Italic, "Kursiv"],
    ["strike", Strikethrough, "Durchgestrichen"],
    ["ul", List, "Liste"],
    ["ol", ListOrdered, "Nummerierte Liste"],
    ["quote", Quote, "Zitat"],
    ["code", Code, "Inline-Code"],
    ["codeblock", FileCode, "Code-Block"],
    ["table", Table, "Tabelle"],
    ["link", LinkIcon, "Link"],
    ["image", Image, "Bild-URL"],
    ["hr", Minus, "Trennlinie"],
  ];

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden">
      <div className="border-b border-white/10 bg-[#121212]">
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
            {tools.map(([kind, Icon, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => apply(kind)}
                title={label}
                className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-sm border border-white/10 text-white/65 hover:text-white hover:border-[#29B6E8]/60"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
            <button
              type="button"
              onClick={openMedia}
              title="Bild aus Medienbibliothek"
              className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-sm border border-[#29B6E8]/35 text-[#29B6E8] hover:bg-[#29B6E8]/10"
            >
              <Images className="w-4 h-4" />
            </button>
          </div>
          <div className="inline-flex border border-white/10 rounded-sm overflow-hidden shrink-0">
            <button type="button" onClick={() => setMode("write")} className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 ${mode === "write" ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}>
              <PenLine className="w-3 h-3" /> Schreiben
            </button>
            <button type="button" onClick={() => setMode("preview")} className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 ${mode === "preview" ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}>
              <Eye className="w-3 h-3" /> Vorschau
            </button>
            <button type="button" onClick={() => setMode("html")} className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 ${mode === "html" ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}>
              <FileCode className="w-3 h-3" /> HTML
            </button>
          </div>
        </div>
      </div>
      {mode === "write" ? (
        <textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          required={required}
          placeholder={placeholder}
          data-testid={testId}
          data-markdown-editor={testId || "default"}
          ref={textareaRef}
          className="w-full bg-[#0A0A0A] px-3 py-3 text-sm font-mono text-white focus:outline-none resize-y min-h-40"
        />
      ) : mode === "preview" ? (
        <div className="min-h-48 p-4 prose-cms text-sm" dangerouslySetInnerHTML={{ __html: preview || '<p class="text-white/35">Keine Vorschau</p>' }} />
      ) : (
        <div className="p-3 space-y-3">
          <textarea
            value={htmlInput}
            onChange={(e) => setHtmlInput(e.target.value)}
            rows={Math.max(6, Math.min(rows, 12))}
            placeholder="<h2>Ueberschrift</h2><p>Text mit <strong>Formatierung</strong></p>"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-3 text-sm font-mono text-white focus:outline-none resize-y"
          />
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button type="button" onClick={() => importHtml(true)} className="px-3 py-2 border border-white/15 text-white/70 rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-white/5">
              An Text anhängen
            </button>
            <button type="button" onClick={() => importHtml(false)} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-xs font-black uppercase tracking-wider hover:bg-[#6FD6FF]">
              HTML umwandeln
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
              <div className="text-white/40 py-12 text-center">Lade Medien...</div>
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
