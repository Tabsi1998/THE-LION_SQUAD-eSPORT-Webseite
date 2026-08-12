const { chromium } = require("@playwright/test");

const baseUrl = (process.env.PUBLIC_AUDIT_BASE_URL || "https://lionsquad.at").replace(/\/+$/, "");
const limit = Math.max(1, Number(process.env.PUBLIC_AUDIT_LIMIT || 250));
const concurrency = Math.max(1, Math.min(8, Number(process.env.PUBLIC_AUDIT_CONCURRENCY || 5)));
const resourceConcurrency = Math.max(1, Math.min(2, Number(process.env.PUBLIC_AUDIT_RESOURCE_CONCURRENCY || 1)));
const resourceTimeout = Math.max(5_000, Number(process.env.PUBLIC_AUDIT_RESOURCE_TIMEOUT_MS || 60_000));
const staticPaths = [
  "/", "/about", "/board", "/values", "/contact", "/news", "/events", "/galerie",
  "/references", "/esports", "/tournaments", "/fastlap", "/teams", "/servers", "/members",
  "/membership/join", "/membership/apply", "/sponsors", "/partners", "/privacy", "/imprint", "/players",
];
const placeholderPattern = /Image:\s*null|Lorem ipsum|demo(?:daten|text|inhalt| player)?|sample content|coming soon|noch im adminbereich zu hinterlegen|\bTBD\b/gi;

function normalizedHostname(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function isInternalUrl(value) {
  try {
    const candidate = new URL(value, baseUrl);
    const root = new URL(baseUrl);
    return ["http:", "https:"].includes(candidate.protocol)
      && normalizedHostname(candidate.hostname) === normalizedHostname(root.hostname);
  } catch {
    return false;
  }
}

function urlPath(value) {
  const url = new URL(value, baseUrl);
  return `${url.pathname}${url.search}`;
}

function isBrowserPageLink(link) {
  const path = new URL(link.url).pathname;
  if (link.download || path.startsWith("/api/")) return false;
  return !/\.(?:aab|apk|avif|bmp|csv|docx?|gif|ico|ics|jpe?g|json|mp4|pdf|png|svg|webm|webp|xlsx?|xml|zip)$/i.test(path);
}

async function checkResourceLink(link) {
  const visited = new Set();
  let current = link.url;

  for (let hop = 0; hop <= 10; hop += 1) {
    if (visited.has(current)) return { error: "Redirect-Schleife", finalUrl: current };
    visited.add(current);

    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": "Lionsquad-Public-Audit/1.0" },
        signal: AbortSignal.timeout(resourceTimeout),
      });
    } catch (error) {
      return { error: error.message, finalUrl: current };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return { status: response.status, error: "Redirect ohne Location-Header", finalUrl: current };
      const next = new URL(location, current).toString();
      if (!isInternalUrl(next)) return { status: response.status, finalUrl: next };
      current = next;
      continue;
    }

    await response.body?.cancel();
    if (response.status >= 400) return { status: response.status, finalUrl: current };
    return { status: response.status, finalUrl: current };
  }

  return { error: "Mehr als 10 Redirects", finalUrl: current };
}

async function runPool(items, worker, size = concurrency) {
  const results = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return results;
}

async function auditPage(context, path) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown";
    if (failure === "net::ERR_ABORTED" && request.resourceType() === "media") return;
    errors.push(`requestfailed: ${request.url()} (${failure})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
      errors.push(`response: ${response.status()} ${response.url()}`);
    }
  });

  try {
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(900);
    const content = await page.evaluate(({ placeholderSource, auditBaseUrl }) => {
      const text = document.body?.innerText || "";
      const pattern = new RegExp(placeholderSource, "gi");
      const placeholders = [...text.matchAll(pattern)].map((match) => match[0]);
      const anchors = [...document.querySelectorAll("a")];
      const reservedLinks = anchors
        .map((anchor) => anchor.href)
        .filter((href) => /example\.(com|org|net|test)|@demo\./i.test(href));
      const invalidLinks = anchors.flatMap((anchor) => {
        const href = anchor.getAttribute("href");
        if (href != null && href.trim() && href.trim() !== "#" && !/^javascript:/i.test(href.trim())) return [];
        return [{ href: href || "", text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().slice(0, 120) }];
      });
      const rootHost = new URL(auditBaseUrl).hostname.replace(/^www\./i, "").toLowerCase();
      const internalLinks = anchors.flatMap((anchor) => {
        const raw = anchor.getAttribute("href");
        if (!raw || /^(?:mailto:|tel:|sms:|javascript:)/i.test(raw)) return [];
        try {
          const url = new URL(raw, window.location.href);
          if (!["http:", "https:"].includes(url.protocol)) return [];
          if (url.hostname.replace(/^www\./i, "").toLowerCase() !== rootHost) return [];
          url.hash = "";
          return [{ url: url.toString(), download: anchor.hasAttribute("download") }];
        } catch {
          return [];
        }
      });
      const brokenImages = [...document.images]
        .filter((image) => image.currentSrc && image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc);
      const imagesWithoutAlt = [...document.images]
        .filter((image) => !image.hasAttribute("alt"))
        .map((image) => (image.currentSrc || image.getAttribute("src") || image.outerHTML).slice(0, 240));
      const imageOnlyLinksWithoutText = anchors.flatMap((anchor) => {
        const images = [...anchor.querySelectorAll("img")].filter((image) => image.getAttribute("alt") === "");
        if (!images.length || anchor.getAttribute("aria-label") || anchor.getAttribute("title")) return [];
        const textWithoutImages = [...anchor.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE || node.nodeName !== "IMG")
          .map((node) => node.textContent || "")
          .join("")
          .trim();
        if (textWithoutImages) return [];
        return images.map((image) => (image.currentSrc || image.getAttribute("src") || "unbekannt").slice(0, 240));
      });
      const errorView = document.querySelector('[data-testid^="error-title-"]')?.getAttribute("data-testid") || "";
      return {
        title: document.title,
        placeholders: [...new Set(placeholders)],
        reservedLinks: [...new Set(reservedLinks)],
        invalidLinks,
        internalLinks,
        brokenImages: [...new Set(brokenImages)],
        imagesWithoutAlt: [...new Set(imagesWithoutAlt)],
        imageOnlyLinksWithoutText: [...new Set(imageOnlyLinksWithoutText)],
        errorView,
      };
    }, { placeholderSource: placeholderPattern.source, auditBaseUrl: baseUrl });
    const uniqueErrors = [...new Set(errors)];
    const status = response?.status() || 0;
    const { internalLinks, ...publicContent } = content;
    const hasFinding = status >= 400
      || publicContent.placeholders.length
      || publicContent.reservedLinks.length
      || publicContent.invalidLinks.length
      || publicContent.brokenImages.length
      || publicContent.imagesWithoutAlt.length
      || publicContent.imageOnlyLinksWithoutText.length
      || publicContent.errorView
      || uniqueErrors.length;
    return {
      internalLinks,
      finding: hasFinding ? { kind: "page", path, status, finalUrl: page.url(), ...publicContent, errors: uniqueErrors } : null,
    };
  } catch (error) {
    return {
      internalLinks: [],
      finding: { kind: "page", path, navigationError: error.message, errors: [...new Set(errors)] },
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`).then((response) => {
    if (!response.ok) throw new Error(`Sitemap returned ${response.status}`);
    return response.text();
  });
  const dynamicPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap((match) => {
    try {
      const url = new URL(match[1]);
      return url.origin === baseUrl ? [`${url.pathname}${url.search}`] : [];
    } catch {
      return [];
    }
  });
  const paths = [...new Set([...staticPaths, ...dynamicPaths])].slice(0, limit);
  const scheduledPaths = new Set(paths);
  const linkSources = new Map();
  const resourceLinks = new Map();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const findings = [];
  let cursor = 0;

  while (cursor < paths.length) {
    const batch = paths.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    const results = await Promise.all(batch.map((path) => auditPage(context, path)));
    results.forEach((result, index) => {
      const sourcePath = batch[index];
      if (result.finding) findings.push(result.finding);
      result.internalLinks.forEach((link) => {
        if (!isInternalUrl(link.url)) return;
        if (!linkSources.has(link.url)) linkSources.set(link.url, new Set());
        linkSources.get(link.url).add(sourcePath);
        if (isBrowserPageLink(link)) {
          const path = urlPath(link.url);
          if (!scheduledPaths.has(path) && paths.length < limit) {
            scheduledPaths.add(path);
            paths.push(path);
          }
        } else {
          resourceLinks.set(link.url, link);
        }
      });
    });
  }

  const uncrawledPageLinks = [...linkSources.keys()]
    .filter((url) => !resourceLinks.has(url) && !scheduledPaths.has(urlPath(url)));
  if (uncrawledPageLinks.length) {
    findings.push({
      kind: "audit-limit",
      error: `Audit-Limit ${limit} reicht nicht für alle entdeckten internen Seitenlinks`,
      urls: uncrawledPageLinks,
    });
  }

  const resourceResults = await runPool([...resourceLinks.values()], checkResourceLink, resourceConcurrency);
  [...resourceLinks.values()].forEach((link, index) => {
    const result = resourceResults[index];
    if (result?.error || Number(result?.status || 0) >= 400) {
      findings.push({
        kind: "resource-link",
        url: link.url,
        linkedFrom: [...(linkSources.get(link.url) || [])],
        ...result,
      });
    }
  });

  await browser.close();
  findings.forEach((finding) => {
    if (finding.kind !== "page" || finding.linkedFrom) return;
    const target = `${baseUrl}${finding.path}`;
    finding.linkedFrom = [...(linkSources.get(target) || [])];
  });
  const failedPages = findings.filter((finding) => finding.kind === "page").length;
  const result = {
    baseUrl,
    audited: paths.length,
    passed: paths.length - failedPages,
    internalLinksChecked: linkSources.size,
    resourceLinksChecked: resourceLinks.size,
    findings,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (findings.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
