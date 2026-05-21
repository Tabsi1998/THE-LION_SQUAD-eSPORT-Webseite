import { Link } from "react-router-dom";
import { Calendar, Flag, Trophy } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { renderMarkdownLite } from "@/lib/markdownLite";

const EMBED_RE = /\[\[\s*(event|events|turnier|turniere|tournament|tournaments|fastlap|fast-lap|f1)\s*:\s*([^\]\s]+)\s*\]\]/gi;
const EMBED_PARSE_RE = /^\[\[\s*(event|events|turnier|turniere|tournament|tournaments|fastlap|fast-lap|f1)\s*:\s*([^\]\s]+)\s*\]\]$/i;

function normalizeKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (["event", "events"].includes(k)) return "event";
  if (["turnier", "turniere", "tournament", "tournaments"].includes(k)) return "tournament";
  if (["fastlap", "fast-lap", "f1"].includes(k)) return "fastlap";
  return k;
}

function embedKey(kind, ref) {
  return `${normalizeKind(kind)}:${String(ref || "").trim().toLowerCase()}`;
}

function normalizeToken(token) {
  const match = String(token || "").match(EMBED_PARSE_RE);
  if (!match) return String(token || "").trim().toLowerCase();
  return embedKey(match[1], match[2]);
}

function buildEmbedIndex(embeds = []) {
  const byToken = new Map();
  for (const embed of embeds || []) {
    if (!embed) continue;
    if (embed.token) byToken.set(normalizeToken(embed.token), embed);
    if (embed.kind && embed.ref) byToken.set(embedKey(embed.kind, embed.ref), embed);
    const itemId = embed.item?.slug || embed.item?.id;
    if (embed.kind && itemId) byToken.set(embedKey(embed.kind, itemId), embed);
  }
  return byToken;
}

function embedMeta(kind, item) {
  if (kind === "event") {
    return { icon: Calendar, accent: "text-[#9F7AEA]", border: "hover:border-[#9F7AEA]/60", to: `/events/${item.slug || item.id}`, title: item.name, label: "Event" };
  }
  if (kind === "tournament") {
    return { icon: Trophy, accent: "text-[#FFD700]", border: "hover:border-[#FFD700]/60", to: `/tournaments/${item.slug || item.id}`, title: item.title, label: "Turnier" };
  }
  return { icon: Flag, accent: "text-[#29B6E8]", border: "hover:border-[#29B6E8]/60", to: `/fastlap/${item.slug || item.id}`, title: item.title, label: "Fast Lap" };
}

function TextChunk({ text }) {
  if (!text) return null;
  return <div className="prose-cms max-w-none" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(text) }} />;
}

function EmbedCard({ embed }) {
  const item = embed?.item;
  if (!item) return <TextChunk text={embed?.token || ""} />;
  const kind = normalizeKind(embed.kind);
  const meta = embedMeta(kind, item);
  const Icon = meta.icon;
  return (
    <Link to={meta.to} className={`my-5 grid sm:grid-cols-[140px_1fr] gap-0 border border-white/10 ${meta.border} bg-[#121212] rounded-sm overflow-hidden transition group`}>
      <div className="min-h-28 bg-[#080808] flex items-center justify-center">
        {item.banner_url ? (
          <img src={resolveMediaUrl(item.banner_url)} alt="" className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition" />
        ) : (
          <Icon className={`w-8 h-8 ${meta.accent}`} />
        )}
      </div>
      <div className="p-4">
        <div className={`text-[10px] uppercase tracking-widest font-bold inline-flex items-center gap-1.5 ${meta.accent}`}>
          <Icon className="w-3 h-3" /> {meta.label}
        </div>
        <div className="mt-1 font-heading font-black uppercase text-lg leading-tight group-hover:text-[#29B6E8] transition">{meta.title}</div>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          {(item.public_phase || item.status) && <PhaseBadge phase={item.public_phase} status={item.status} />}
          {item.start_date && <span className="text-xs text-white/50">{new Date(item.start_date).toLocaleDateString("de-DE")}</span>}
          {item.location && <span className="text-xs text-white/50">{item.location}</span>}
        </div>
        {(item.description) && <p className="mt-2 text-sm text-white/60 line-clamp-2">{item.description}</p>}
      </div>
    </Link>
  );
}

export function RichContent({ text = "", embeds = [], className = "" }) {
  const byToken = buildEmbedIndex(embeds);
  const parts = [];
  let lastIndex = 0;
  for (const match of String(text || "").matchAll(EMBED_RE)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > lastIndex) parts.push({ type: "text", value: text.slice(lastIndex, index) });
    const embed = byToken.get(normalizeToken(token));
    parts.push(embed ? { type: "embed", value: embed } : { type: "text", value: token });
    lastIndex = index + token.length;
  }
  if (lastIndex < String(text || "").length) parts.push({ type: "text", value: text.slice(lastIndex) });

  return (
    <div className={className}>
      {parts.map((part, idx) => (
        part.type === "embed"
          ? <EmbedCard key={`${part.value.kind}-${part.value.ref}-${idx}`} embed={part.value} />
          : <TextChunk key={`text-${idx}`} text={part.value} />
      ))}
    </div>
  );
}

export function embedToken(kind, item) {
  return `[[${kind}:${item?.slug || item?.id || ""}]]`;
}

export function appendEmbedToken(text, kind, item) {
  const token = embedToken(kind, item);
  const prefix = String(text || "").trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${token}\n`;
}
