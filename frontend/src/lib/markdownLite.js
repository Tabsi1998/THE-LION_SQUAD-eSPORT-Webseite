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
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point here
  if (!href || /[\u0000-\u001F\u007F\s]/.test(href)) return null;
  // Erst die protokoll-relativen Adressen („//evil.example“, auch „/\evil.example“ - Browser lesen den Backslash als
  // Schrägstrich): die führen auf eine fremde Seite. Danach erst die eigenen Pfade „/…“ und Anker.
  if (href.startsWith("//") || href.startsWith("/\\")) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;

  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    return href;
  }
}

function validProfileSet(options = {}) {
  if (!Array.isArray(options.validProfileUsernames)) return null;
  return new Set(options.validProfileUsernames.map((username) => String(username || "").toLowerCase()).filter(Boolean));
}

function allowedProfileLink(href, options = {}) {
  const validProfiles = validProfileSet(options);
  if (validProfiles == null) return true;
  const match = String(href || "").match(/^\/u\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!match) return true;
  try {
    return validProfiles.has(decodeURIComponent(match[1]).toLowerCase());
  } catch {
    return false;
  }
}

function linkMentions(html, options = {}) {
  const validProfiles = validProfileSet(options);
  return html.replace(/(^|[^A-Za-z0-9_.-])@([A-Za-z0-9_.-]{2,32})/g, (match, prefix, username) => {
    if (validProfiles != null && !validProfiles.has(username.toLowerCase())) return `${prefix}@${username}`;
    return `${prefix}<a href="/u/${encodeURIComponent(username)}" class="mention-link">@${username}</a>`;
  });
}

function formatInlineText(rawText, options = {}) {
  const html = escapeHtml(rawText)
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\+\+(.+?)\+\+/g, "<u>$1</u>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  return options.linkMentions === false ? html : linkMentions(html, options);
}

// `escapes` (Regelwerk, #2218): Die API liefert Werte aus Bausteinen (Namen aus Bibliothek und Modus) mit Markdown-Backslash-Escapes und den
// frei geschriebenen Text mit verdoppeltem Backslash (services/markdown_text.served). Ein Escape wird hier zuerst ein Zeichen aus dem
// privaten Bereich von Unicode - keine Regel trifft es -, erst am Schluss das echte Zeichen. So wird ein Name nie Link oder fett, und der
// freie Text erscheint, wie er geschrieben ist, auch ein Backslash darin. Dasselbe Zeichen-Set wie auf dem Server und im PDF.
const BLOCK_TEXT_CHARS = "\\`*_[]()!~+";
const PROTECT_BASE = 0xe000;
// Der Bereich gehört dem Zwischenformat: Was so ankommt, fällt weg (wie services/markdown_text.RESERVED).
const RESERVED = /[-]/g;
const ESCAPE = /\\([\\`*_[\]()!~+])/g;

/** Ein Name so, wie die API ihn als Bausteinwert ausliefert (für Tests und Vorschauen). */
export function escapeBlockText(text) {
  return [...String(text ?? "")].map((char) => (BLOCK_TEXT_CHARS.includes(char) ? `\\${char}` : char)).join("");
}

function protectEscapes(markdown) {
  return markdown.replace(RESERVED, "").replace(ESCAPE, (_, char) => String.fromCharCode(PROTECT_BASE + BLOCK_TEXT_CHARS.indexOf(char)));
}

function realChar(char) {
  const index = char.charCodeAt(0) - PROTECT_BASE;
  return index >= 0 && index < BLOCK_TEXT_CHARS.length ? BLOCK_TEXT_CHARS[index] : char;
}

/** Die geschützten Zeichen als echte Zeichen - im Text (für Adressen), ohne HTML-Maskierung. */
function restorePlain(text) {
  return [...text].map(realChar).join("");
}

function restoreBlockText(html) {
  return [...html].map((char) => {
    const real = realChar(char);
    return real === char ? char : escapeHtml(real);
  }).join("");
}

function renderInline(rawText, options = {}) {
  if (options.escapes) return restoreBlockText(renderInlinePlain(rawText, options));
  return renderInlinePlain(rawText, options);
}

function renderInlinePlain(rawText, options = {}) {
  const linkPattern = /(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(rawText)) !== null) {
    html += formatInlineText(rawText.slice(lastIndex, match.index), options);
    const isImage = match[1] === "!";
    const label = formatInlineText(match[2], { ...options, linkMentions: false });
    // Mit `escapes` erst die echten Zeichen, dann prüfen: „/\fremd“ bleibt so auch hier kein Link auf eine fremde Seite.
    const href = sanitizeHref(options.escapes ? restorePlain(match[3]) : match[3]);
    // `imageAllowed` (Regelwerk, #1646): Was es verneint, wird nicht geladen und bleibt ein Link. Ohne Option wie bisher.
    if (href && isImage && (!options.imageAllowed || options.imageAllowed(href))) {
      html += `<img src="${escapeHtml(href)}" alt="${escapeHtml(match[2])}" loading="lazy"/>`;
    } else if (href && allowedProfileLink(href, options)) {
      // Regelwerk (#1646): Ein Sprung auf einen Paragrafen bleibt in der Seite.
      const external = options.anchorLinksInPage && href.startsWith("#") ? "" : ' target="_blank" rel="noopener noreferrer"';
      html += `<a href="${escapeHtml(href)}"${external}>${label}</a>`;
    } else {
      html += label;
    }
    lastIndex = match.index + match[0].length;
  }

  html += formatInlineText(rawText.slice(lastIndex), options);
  return html;
}

export function renderMarkdownLite(md, options = {}) {
  if (!md) return "";

  const lines = (options.escapes ? protectEscapes(String(md)) : String(md)).split(/\r?\n/);
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
    const code = escapeHtml(codeLines.join("\n"));
    // Bausteinwerte und Backslashes (#2218) auch im Codeblock als echte Zeichen.
    html += `<pre><code>${options.escapes ? restoreBlockText(code) : code}</code></pre>`;
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
      html += headers.map((cell) => `<th>${renderInline(cell, options)}</th>`).join("");
      html += "</tr></thead><tbody>";
      rows.forEach((row) => {
        html += "<tr>";
        headers.forEach((_, index) => {
          html += `<td>${renderInline(row[index] || "", options)}</td>`;
        });
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      continue;
    }
    if (/^###\s+/.test(raw)) {
      close();
      html += `<h3>${renderInline(raw.replace(/^###\s+/, ""), options)}</h3>`;
      continue;
    }
    if (/^##\s+/.test(raw)) {
      close();
      html += `<h2>${renderInline(raw.replace(/^##\s+/, ""), options)}</h2>`;
      continue;
    }
    if (/^#\s+/.test(raw)) {
      close();
      html += `<h1>${renderInline(raw.replace(/^#\s+/, ""), options)}</h1>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (inList !== "ul") {
        close();
        html += "<ul>";
        inList = "ul";
      }
      html += `<li>${renderInline(raw.replace(/^\s*[-*]\s+/, ""), options)}</li>`;
      continue;
    }
    if (/^>\s?/.test(raw)) {
      close();
      html += `<blockquote>${renderInline(raw.replace(/^>\s?/, ""), options)}</blockquote>`;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(raw)) {
      if (inList !== "ol") {
        close();
        html += "<ol>";
        inList = "ol";
      }
      html += `<li>${renderInline(raw.replace(/^\s*\d+\.\s+/, ""), options)}</li>`;
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
    html += `<p>${renderInline(raw, options)}</p>`;
  }

  if (inCodeBlock) closeCodeBlock();
  close();
  return html;
}
