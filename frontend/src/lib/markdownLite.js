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

function linkMentions(html) {
  return html.replace(/(^|[^A-Za-z0-9_.-])@([A-Za-z0-9_.-]{2,32})/g, (match, prefix, username) => (
    `${prefix}<a href="/u/${encodeURIComponent(username)}" class="mention-link">@${username}</a>`
  ));
}

function formatInlineText(rawText, options = {}) {
  const html = escapeHtml(rawText)
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\+\+(.+?)\+\+/g, "<u>$1</u>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  return options.linkMentions === false ? html : linkMentions(html);
}

function renderInline(rawText) {
  const linkPattern = /(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(rawText)) !== null) {
    html += formatInlineText(rawText.slice(lastIndex, match.index));
    const isImage = match[1] === "!";
    const label = formatInlineText(match[2], { linkMentions: false });
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
  let inCodeBlock = false;
  let codeLines = [];
  const close = () => {
    if (!inList) return;
    html += inList === "ul" ? "</ul>" : "</ol>";
    inList = null;
  };
  const closeCodeBlock = () => {
    html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
    codeLines = [];
    inCodeBlock = false;
  };
  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const isTableRow = (line) => line.includes("|") && !isTableDivider(line);
  const parseTableCells = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^```/.test(raw.trim())) {
      close();
      if (inCodeBlock) closeCodeBlock();
      else {
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(raw);
      continue;
    }
    if (isTableRow(raw) && lines[i + 1] && isTableDivider(lines[i + 1])) {
      close();
      const headers = parseTableCells(raw);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i += 1;
      }
      i -= 1;
      html += "<div class=\"prose-cms-table\"><table><thead><tr>";
      html += headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      html += "</tr></thead><tbody>";
      rows.forEach((row) => {
        html += "<tr>";
        headers.forEach((_, index) => {
          html += `<td>${renderInline(row[index] || "")}</td>`;
        });
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      continue;
    }
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

  if (inCodeBlock) closeCodeBlock();
  close();
  return html;
}
