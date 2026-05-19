import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { Body, Heading, Muted } from "./Text";

type RichTextProps = {
  text?: string | null;
  compact?: boolean;
};

type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; url: string }
  | { type: "mention"; value: string };

export function RichText({ text, compact = false }: RichTextProps) {
  const blocks = normalizeBlocks(text);
  if (!blocks.length) return null;
  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      {blocks.map((block, index) => renderBlock(block, index, compact))}
    </View>
  );
}

function renderBlock(block: string, index: number, compact: boolean) {
  if (/^\[\[\s*(event|events|turnier|turniere|tournament|tournaments|fastlap|fast-lap|f1)\s*:/i.test(block)) {
    return (
      <View key={`${index}-${block}`} style={styles.embedHint}>
        <Ionicons name="link-outline" color={colors.cyan} size={14} />
        <Muted style={styles.embedText}>{block.replace(/\[\[|\]\]/g, "")}</Muted>
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
        <Body style={styles.quoteText}>{renderInline(block.replace(/^>\s+/, ""), index)}</Body>
      </View>
    );
  }

  if (/^[-*]\s+/.test(block)) {
    return (
      <View key={`${index}-${block}`} style={styles.bullet}>
        <View style={styles.dot} />
        <Body style={styles.bulletText}>{renderInline(block.replace(/^[-*]\s+/, ""), index)}</Body>
      </View>
    );
  }

  return <Body key={`${index}-${block}`} style={compact ? styles.compactBody : undefined}>{renderInline(block, index)}</Body>;
}

function renderInline(value: string, blockIndex: number) {
  return tokenizeInline(value).map((token, index) => {
    const key = `${blockIndex}-${index}-${token.type}`;
    if (token.type === "bold") return <Text key={key} style={styles.bold}>{token.value}</Text>;
    if (token.type === "italic") return <Text key={key} style={styles.italic}>{token.value}</Text>;
    if (token.type === "code") return <Text key={key} style={styles.code}>{token.value}</Text>;
    if (token.type === "mention") return <Text key={key} style={styles.mention}>{token.value}</Text>;
    if (token.type === "link") {
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => {
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
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|(^|\s)@[a-zA-Z0-9_.-]{2,32}|(^|\s)#[\p{L}\p{N}_-]{2,40}|\*[^*\n]+\*)/gu;
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
  return String(text || "")
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

function stripMarkdown(value: string) {
  return value.replace(/[*_`]/g, "");
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
  embedText: {
    color: colors.cyan,
    fontWeight: "900",
  },
});
