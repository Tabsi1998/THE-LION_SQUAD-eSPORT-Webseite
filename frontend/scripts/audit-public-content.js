const { chromium } = require("@playwright/test");

const baseUrl = (process.env.PUBLIC_AUDIT_BASE_URL || "https://lionsquad.at").replace(/\/+$/, "");
const limit = Math.max(1, Number(process.env.PUBLIC_AUDIT_LIMIT || 120));
const concurrency = Math.max(1, Math.min(8, Number(process.env.PUBLIC_AUDIT_CONCURRENCY || 5)));
const staticPaths = [
  "/", "/about", "/board", "/values", "/contact", "/news", "/events", "/galerie",
  "/references", "/esports", "/tournaments", "/fastlap", "/teams", "/servers", "/members",
  "/membership/join", "/membership/apply", "/sponsors", "/partners", "/privacy", "/imprint", "/players",
];
const placeholderPattern = /Image:\s*null|Lorem ipsum|demo(?:daten|text|inhalt| player)?|sample content|coming soon|noch im adminbereich zu hinterlegen|\bTBD\b/gi;

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
    const content = await page.evaluate((placeholderSource) => {
      const text = document.body?.innerText || "";
      const pattern = new RegExp(placeholderSource, "gi");
      const placeholders = [...text.matchAll(pattern)].map((match) => match[0]);
      const reservedLinks = [...document.querySelectorAll("a[href]")]
        .map((anchor) => anchor.href)
        .filter((href) => /example\.(com|org|net|test)|@demo\./i.test(href));
      const brokenImages = [...document.images]
        .filter((image) => image.currentSrc && image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc);
      return {
        title: document.title,
        placeholders: [...new Set(placeholders)],
        reservedLinks: [...new Set(reservedLinks)],
        brokenImages: [...new Set(brokenImages)],
      };
    }, placeholderPattern.source);
    const uniqueErrors = [...new Set(errors)];
    const status = response?.status() || 0;
    if (status >= 400 || content.placeholders.length || content.reservedLinks.length || content.brokenImages.length || uniqueErrors.length) {
      return { path, status, ...content, errors: uniqueErrors };
    }
    return null;
  } catch (error) {
    return { path, navigationError: error.message, errors: [...new Set(errors)] };
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const findings = [];
  let cursor = 0;

  async function worker() {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      const finding = await auditPage(context, path);
      if (finding) findings.push(finding);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await browser.close();
  const result = { baseUrl, audited: paths.length, passed: paths.length - findings.length, findings };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (findings.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
