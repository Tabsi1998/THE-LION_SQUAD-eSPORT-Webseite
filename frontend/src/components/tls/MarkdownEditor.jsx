import { useMemo, useRef, useState } from "react";
import {
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  Image,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Quote,
} from "lucide-react";
import { renderMarkdownLite } from "@/lib/markdownLite";

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

export function MarkdownEditor({
  value = "",
  onChange,
  rows = 12,
  testId,
  placeholder = "",
  helperText = "Markdown: Überschriften, Listen, Links, Bilder und Einbettungen. HTML wird aus Sicherheitsgründen als Text behandelt.",
  required = false,
}) {
  const [mode, setMode] = useState("write");
  const textareaRef = useRef(null);
  const preview = useMemo(() => renderMarkdownLite(value), [value]);

  const apply = (kind) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? String(value).length;
    const end = textarea?.selectionEnd ?? String(value).length;
    let result;
    if (kind === "h1") result = prefixLines(value, start, end, "# ");
    if (kind === "h2") result = prefixLines(value, start, end, "## ");
    if (kind === "bold") result = wrapSelection(value, start, end, "**", "**", "fetter Text");
    if (kind === "italic") result = wrapSelection(value, start, end, "*", "*", "kursiver Text");
    if (kind === "code") result = wrapSelection(value, start, end, "`", "`", "code");
    if (kind === "ul") result = prefixLines(value, start, end, "- ");
    if (kind === "ol") result = prefixLines(value, start, end, "1. ");
    if (kind === "quote") result = prefixLines(value, start, end, "> ");
    if (kind === "link") result = wrapSelection(value, start, end, "[", "](https://)", "Linktext");
    if (kind === "image") result = wrapSelection(value, start, end, "![", "](https://)", "Bildbeschreibung");
    if (kind === "hr") {
      const prefix = value.slice(0, start).endsWith("\n") || start === 0 ? "" : "\n";
      const suffix = value.slice(end).startsWith("\n") ? "" : "\n";
      result = { value: `${value.slice(0, start)}${prefix}---${suffix}${value.slice(end)}`, cursor: start + prefix.length + 3 };
    }
    if (!result) return;
    onChange(result.value);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const tools = [
    ["h1", Heading1, "Überschrift 1"],
    ["h2", Heading2, "Überschrift 2"],
    ["bold", Bold, "Fett"],
    ["italic", Italic, "Kursiv"],
    ["ul", List, "Liste"],
    ["ol", ListOrdered, "Nummerierte Liste"],
    ["quote", Quote, "Zitat"],
    ["code", Code, "Inline-Code"],
    ["link", LinkIcon, "Link"],
    ["image", Image, "Bild"],
    ["hr", Minus, "Trennlinie"],
  ];

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#121212] px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {tools.map(([kind, Icon, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => apply(kind)}
              title={label}
              className="w-8 h-8 inline-flex items-center justify-center rounded-sm border border-white/10 text-white/65 hover:text-white hover:border-[#29B6E8]/60"
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
        <div className="inline-flex border border-white/10 rounded-sm overflow-hidden shrink-0">
          <button type="button" onClick={() => setMode("write")} className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 ${mode === "write" ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}>
            <PenLine className="w-3 h-3" /> Schreiben
          </button>
          <button type="button" onClick={() => setMode("preview")} className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 ${mode === "preview" ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}>
            <Eye className="w-3 h-3" /> Vorschau
          </button>
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
          className="w-full bg-[#0A0A0A] px-3 py-3 text-sm font-mono text-white focus:outline-none resize-y"
        />
      ) : (
        <div className="min-h-48 p-4 prose-cms text-sm" dangerouslySetInnerHTML={{ __html: preview || '<p class="text-white/35">Keine Vorschau</p>' }} />
      )}
      {helperText && <div className="border-t border-white/10 px-3 py-2 text-[11px] text-white/40">{helperText}</div>}
    </div>
  );
}
