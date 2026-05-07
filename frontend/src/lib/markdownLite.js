const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(rawHref) {
  const href = String(rawHref ?? "").trim();
  if (!href || /[\u0000-\u001F\u007F\s]/.test(href)) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  if (href.startsWith("//")) return null;

  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    return href;
  }
}

function formatInlineText(rawText) {
  return escapeHtml(rawText)
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function renderInline(rawText) {
  const linkPattern = /(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(rawText)) !== null) {
    html += formatInlineText(rawText.slice(lastIndex, match.index));
    const isImage = match[1] === "!";
    const label = formatInlineText(match[2]);
    const href = sanitizeHref(match[3]);
    if (href && isImage) {
      html += `<img src="${escapeHtml(href)}" alt="${escapeHtml(match[2])}" loading="lazy"/>`;
    } else if (href) {
      html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    } else {
      html += label;
    }
    lastIndex = match.index + match[0].length;
  }

  html += formatInlineText(rawText.slice(lastIndex));
  return html;
}

export function renderMarkdownLite(md) {
  if (!md) return "";

  const lines = String(md).split(/\r?\n/);
  let html = "";
  let inList = null;
  const close = () => {
    if (!inList) return;
    html += inList === "ul" ? "</ul>" : "</ol>";
    inList = null;
  };

  for (const raw of lines) {
    if (/^###\s+/.test(raw)) {
      close();
      html += `<h3>${renderInline(raw.replace(/^###\s+/, ""))}</h3>`;
      continue;
    }
    if (/^##\s+/.test(raw)) {
      close();
      html += `<h2>${renderInline(raw.replace(/^##\s+/, ""))}</h2>`;
      continue;
    }
    if (/^#\s+/.test(raw)) {
      close();
      html += `<h1>${renderInline(raw.replace(/^#\s+/, ""))}</h1>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (inList !== "ul") {
        close();
        html += "<ul>";
        inList = "ul";
      }
      html += `<li>${renderInline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`;
      continue;
    }
    if (/^>\s?/.test(raw)) {
      close();
      html += `<blockquote>${renderInline(raw.replace(/^>\s?/, ""))}</blockquote>`;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(raw)) {
      if (inList !== "ol") {
        close();
        html += "<ol>";
        inList = "ol";
      }
      html += `<li>${renderInline(raw.replace(/^\s*\d+\.\s+/, ""))}</li>`;
      continue;
    }
    if (/^---+$/.test(raw)) {
      close();
      html += "<hr/>";
      continue;
    }
    if (raw.trim() === "") {
      close();
      continue;
    }
    close();
    html += `<p>${renderInline(raw)}</p>`;
  }

  close();
  return html;
}
