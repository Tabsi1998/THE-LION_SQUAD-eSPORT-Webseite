import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { isImageUrl, parseContentTarget, type ContentTarget } from "../lib/contentLinks";
import { colors } from "../theme";
import { MediaImage } from "./MediaImage";
import { Body, Heading, Muted } from "./Text";

type RichTextProps = {
  text?: string | null;
  compact?: boolean;
  onOpenContent?: (target: ContentTarget) => void;
};

type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; url: string }
  | { type: "mention"; value: string };

export function RichText({ text, compact = false, onOpenContent }: RichTextProps) {
  const blocks = normalizeBlocks(text);
  if (!blocks.length) return null;
  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      {blocks.map((block, index) => renderBlock(block, index, compact, onOpenContent))}
    </View>
  );
}

function renderBlock(block: string, index: number, compact: boolean, onOpenContent?: (target: ContentTarget) => void) {
  const image = parseImageBlock(block);
  if (image) {
    return (
      <MediaImage
        key={`${index}-${image.url}`}
        uri={image.url}
        style={[styles.image, compact && styles.compactImage]}
        fallback={<Ionicons name="image-outline" color={colors.cyan} size={28} />}
      />
    );
  }

  const target = parseContentTarget(block);
  if (target) {
    const content = (
      <>
        <Ionicons name={iconForTarget(target.type)} color={colors.cyan} size={14} />
        <Muted style={styles.embedText}>{target.label || labelForTarget(target)}</Muted>
      </>
    );
    if (onOpenContent) {
      return (
        <Pressable key={`${index}-${block}`} onPress={() => onOpenContent(target)} style={({ pressed }) => [styles.embedHint, pressed && styles.pressed]}>
          {content}
        </Pressable>
      );
    }
    return (
      <View key={`${index}-${block}`} style={styles.embedHint}>
        {content}
      </View>
    );
  }

  const heading = block.match(/^(#{1,3})\s+(.+)/);
  if (heading) {
    return <Heading key={`${index}-${block}`} style={compact ? styles.compactHeading : undefined}>{stripMarkdown(heading[2])}</Heading>;
  }

  if (/^>\s+/.test(block)) {
    return (
      <View key={`${index}-${block}`} style={styles.quote}>
        <Body style={styles.quoteText}>{renderInline(block.replace(/^>\s+/, ""), index, onOpenContent)}</Body>
      </View>
    );
  }

  if (/^[-*]\s+/.test(block) || /^\d+[.)]\s+/.test(block)) {
    return (
      <View key={`${index}-${block}`} style={styles.bullet}>
        <View style={styles.dot} />
        <Body style={styles.bulletText}>
          {renderInline(block.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""), index, onOpenContent)}
        </Body>
      </View>
    );
  }

  return <Body key={`${index}-${block}`} style={compact ? styles.compactBody : undefined}>{renderInline(block, index, onOpenContent)}</Body>;
}

function renderInline(value: string, blockIndex: number, onOpenContent?: (target: ContentTarget) => void) {
  return tokenizeInline(value).map((token, index) => {
    const key = `${blockIndex}-${index}-${token.type}`;
    if (token.type === "bold") return <Text key={key} style={styles.bold}>{token.value}</Text>;
    if (token.type === "italic") return <Text key={key} style={styles.italic}>{token.value}</Text>;
    if (token.type === "code") return <Text key={key} style={styles.code}>{token.value}</Text>;
    if (token.type === "mention") {
      const username = token.value.startsWith("@") ? token.value.slice(1) : "";
      return (
        <Text
          key={key}
          style={styles.mention}
          onPress={() => {
            if (username && onOpenContent) onOpenContent({ type: "profile", id: username, label: token.value });
          }}
        >
          {token.value}
        </Text>
      );
    }
    if (token.type === "link") {
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => {
            const target = parseContentTarget(token.url);
            if (target && onOpenContent) {
              onOpenContent(target);
              return;
            }
            const url = /^https?:\/\//i.test(token.url) ? token.url : `https://${token.url}`;
            Linking.openURL(url).catch(() => {});
          }}
        >
          {token.label}
        </Text>
      );
    }
    return <Text key={key}>{token.value}</Text>;
  });
}

function tokenizeInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|(^|\s)@[a-zA-Z0-9_.-]{2,32}|(^|\s)#[\p{L}\p{N}_-]{2,40}|\*[^*\n]+\*)/gu;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index || 0;
    if (index > last) tokens.push({ type: "text", value: value.slice(last, index) });
    const leading = raw.match(/^\s/)?.[0] || "";
    const trimmed = raw.trimStart();
    if (leading) tokens.push({ type: "text", value: leading });
    if (trimmed.startsWith("**") || trimmed.startsWith("__")) {
      tokens.push({ type: "bold", value: trimmed.slice(2, -2) });
    } else if (trimmed.startsWith("*")) {
      tokens.push({ type: "italic", value: trimmed.slice(1, -1) });
    } else if (trimmed.startsWith("`")) {
      tokens.push({ type: "code", value: trimmed.slice(1, -1) });
    } else if (trimmed.startsWith("[")) {
      const link = trimmed.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      if (link) tokens.push({ type: "link", label: link[1], url: link[2] });
      else tokens.push({ type: "text", value: trimmed });
    } else if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
      tokens.push({ type: "link", label: trimmed.replace(/^https?:\/\//i, ""), url: trimmed });
    } else if (trimmed.startsWith("@") || trimmed.startsWith("#")) {
      tokens.push({ type: "mention", value: trimmed });
    } else {
      tokens.push({ type: "text", value: trimmed });
    }
    last = index + raw.length;
  }
  if (last < value.length) tokens.push({ type: "text", value: value.slice(last) });
  return tokens;
}

function normalizeBlocks(text?: string | null) {
  return decodeEntities(String(text || ""))
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, "\n{{image:$2|$1}}\n")
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "\n{{image:$1|$2}}\n")
    .replace(/<img[^>]+alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, "\n{{image:$2|$1}}\n")
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, "\n{{image:$1}}\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseImageBlock(block: string) {
  const image = block.match(/^\{\{image:([^|}]+)(?:\|([^}]+))?}}$/i);
  if (image) return { url: image[1].trim(), alt: image[2]?.trim() };
  return isImageUrl(block) ? { url: block } : null;
}

function stripMarkdown(value: string) {
  return value.replace(/[*_`]/g, "");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function labelForTarget(target: ContentTarget) {
  const prefix: Record<ContentTarget["type"], string> = {
    event: "Event",
    fastlap: "Fast Lap",
    news: "News",
    profile: "Profil",
    team: "Team",
    tournament: "Turnier",
  };
  return `${prefix[target.type]}: ${target.id}`;
}

function iconForTarget(type: ContentTarget["type"]) {
  if (type === "event") return "calendar-outline";
  if (type === "fastlap") return "speedometer-outline";
  if (type === "news") return "newspaper-outline";
  if (type === "profile") return "person-circle-outline";
  if (type === "team") return "people-outline";
  return "trophy-outline";
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  compactWrap: {
    gap: 4,
  },
  compactBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  compactHeading: {
    fontSize: 16,
  },
  bold: {
    fontWeight: "900",
  },
  italic: {
    fontStyle: "italic",
  },
  code: {
    backgroundColor: "rgba(255,255,255,0.08)",
    color: colors.gold,
    fontFamily: "monospace",
  },
  mention: {
    color: colors.cyan,
    fontWeight: "900",
  },
  link: {
    color: colors.cyan,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  image: {
    borderRadius: 8,
    height: 190,
    width: "100%",
  },
  compactImage: {
    height: 130,
  },
  quote: {
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    paddingLeft: 10,
  },
  quoteText: {
    color: "rgba(255,255,255,0.82)",
  },
  bullet: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 9,
  },
  dot: {
    backgroundColor: colors.cyan,
    borderRadius: 4,
    height: 8,
    marginTop: 7,
    width: 8,
  },
  bulletText: {
    flex: 1,
  },
  embedHint: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(41,182,232,0.1)",
    borderColor: "rgba(41,182,232,0.28)",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.72,
  },
  embedText: {
    color: colors.cyan,
    fontWeight: "900",
  },
});
