import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { load } from "cheerio";
const root = new URL("../dist/", import.meta.url).pathname;
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : join(dir, entry.name),
      ),
    )
  ).flat();
}
const all = await files(root);
const htmlFiles = all.filter((file) => file.endsWith(".html"));
const titles = new Set(),
  descriptions = new Set(),
  canonicals = new Set(),
  targets = new Map();
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
const home = load(await readFile(join(root, "index.html"), "utf8"));
const origin = new URL(home('link[rel="canonical"]').attr("href")).origin;
const preview = home('meta[name="robots"]').attr("content").includes("noindex");
for (const file of htmlFiles) {
  const $ = load(await readFile(file, "utf8"));
  targets.set(file, $);
  const path = relative(root, file);
  const title = $("title").text(),
    description = $('meta[name="description"]').attr("content");
  const canonical = $('link[rel="canonical"]').attr("href");
  check(
    $("title").length === 1 && title.length > 15 && !titles.has(title),
    `${path}: unique descriptive title`,
  );
  titles.add(title);
  check(
    !!description && description.length > 60 && !descriptions.has(description),
    `${path}: unique description`,
  );
  descriptions.add(description);
  check(
    $("h1").length === 1 && $("h1").text().trim().length > 8,
    `${path}: exactly one meaningful h1`,
  );
  check(
    $("main").length === 1 &&
      $("header").length > 0 &&
      $("footer").length === 1 &&
      $("nav").length > 0,
    `${path}: landmarks`,
  );
  check(
    $("main").text().trim().length > 100,
    `${path}: content exists in static HTML`,
  );
  check(
    !!canonical &&
      canonical.startsWith(origin + "/") &&
      !canonicals.has(canonical),
    `${path}: consistent unique canonical`,
  );
  canonicals.add(canonical);
  check(
    origin.startsWith("https://") && !origin.includes("azurestaticapps.net"),
    `${path}: branded HTTPS hostname`,
  );
  check(
    path === "404.html" ||
      preview ||
      !$('meta[name="robots"]').attr("content")?.includes("noindex"),
    `${path}: accidental noindex`,
  );
  for (const name of [
    "og:title",
    "og:description",
    "og:type",
    "og:url",
    "og:image",
  ])
    check(
      !!$(`meta[property="${name}"]`).attr("content"),
      `${path}: missing ${name}`,
    );
  check(
    $('meta[property="og:url"]').attr("content") === canonical,
    `${path}: og:url matches canonical`,
  );
  check(
    $('meta[name="twitter:card"]').attr("content") === "summary_large_image",
    `${path}: social card`,
  );
  let previous = 0;
  $("main h1,main h2,main h3,main h4").each((_, el) => {
    const level = Number(el.tagName.slice(1));
    check(
      level <= previous + 1,
      `${path}: heading skips ${previous} to ${level}`,
    );
    previous = level;
  });
  $("img").each((_, el) => {
    check(
      $(el).attr("alt") !== undefined &&
        !!$(el).attr("width") &&
        !!$(el).attr("height"),
      `${path}: image alt and explicit dimensions`,
    );
  });
  const entities = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const item = JSON.parse($(el).text());
      entities.push(...(Array.isArray(item) ? item : [item]));
    } catch {
      failures.push(`${path}: invalid JSON-LD`);
    }
  });
  const ids = entities.map((e) => e["@id"]).filter(Boolean);
  check(new Set(ids).size === ids.length, `${path}: duplicate schema entities`);
  check(
    entities.some((e) => e["@type"] === "Organization"),
    `${path}: publisher schema`,
  );
  for (const entity of entities) {
    check(
      entity["@context"] === "https://schema.org",
      `${path}: schema context`,
    );
    check(
      !entity.aggregateRating && !entity.review,
      `${path}: unsupported review/rating`,
    );
    if (entity["@type"] === "SoftwareApplication") {
      check(
        entity.name === "Save Scum" &&
          !!entity.description &&
          entity.softwareVersion === "0.1.0" &&
          !!entity.applicationCategory,
        `${path}: software properties`,
      );
      check(entity.operatingSystem === "macOS", `${path}: verified OS only`);
      check(
        !entity.offers || (entity.offers.price === "0" && entity.downloadUrl),
        `${path}: offers require a configured release`,
      );
      check(entity.url === origin + "/", `${path}: software URL`);
    }
    if (entity["@type"] === "BreadcrumbList")
      check(
        entity.itemListElement.every(
          (item, i) =>
            item.position === i + 1 && item.item.startsWith(origin + "/"),
        ),
        `${path}: breadcrumb order/URLs`,
      );
  }
  if (path !== "index.html" && path !== "404.html")
    check(
      entities.some((e) => e["@type"] === "BreadcrumbList"),
      `${path}: breadcrumb schema`,
    );
}
for (const [file, $] of targets) {
  for (const el of $("a[href],link[href],script[src],img[src]").toArray()) {
    const value = $(el).attr("href") || $(el).attr("src");
    if (!value || /^(mailto:|tel:|data:)/.test(value)) continue;
    const current = $('link[rel="canonical"]').attr("href");
    const url = new URL(value, current);
    check(
      url.protocol === "https:",
      `${relative(root, file)}: non-HTTPS URL ${value}`,
    );
    if (url.origin !== origin) continue;
    let target = join(root, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) target = join(target, "index.html");
    check(
      all.includes(target),
      `${relative(root, file)}: missing link/asset ${value}`,
    );
    if (url.hash && targets.has(target)) {
      const id = decodeURIComponent(url.hash.slice(1));
      check(
        targets
          .get(target)("[id]")
          .toArray()
          .some((el) => targets.get(target)(el).attr("id") === id),
        `${relative(root, file)}: missing fragment ${value}`,
      );
    }
  }
}
const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(
  (match) => match[1],
);
const expected = [...targets]
  .filter(
    ([, $]) => !$('meta[name="robots"]').attr("content").includes("noindex"),
  )
  .map(([, $]) => $('link[rel="canonical"]').attr("href"))
  .sort();
check(
  JSON.stringify(locations.sort()) === JSON.stringify(expected),
  "Sitemap matches every indexable route",
);
const robots = await readFile(join(root, "robots.txt"), "utf8");
check(
  robots.includes("Allow: /") && !robots.includes("Disallow: /"),
  "Crawling allowed",
);
check(
  preview || robots.includes(`Sitemap: ${origin}/sitemap.xml`),
  "Production robots sitemap",
);
const config = JSON.parse(
  await readFile(join(root, "staticwebapp.config.json"), "utf8"),
);
check(
  config.responseOverrides["404"].statusCode === 404 &&
    config.responseOverrides["404"].rewrite === "/404.html" &&
    !config.navigationFallback,
  "Real 404 without SPA fallback",
);
check(config.trailingSlash === "always", "Consistent slash normalization");
check(
  !preview || config.globalHeaders["X-Robots-Tag"] === "noindex, nofollow",
  "Preview noindex HTTP header",
);
const scripts = all.filter((file) => file.endsWith(".js"));
const externalBytes = (
  await Promise.all(scripts.map(async (file) => (await stat(file)).size))
).reduce((a, b) => a + b, 0);
const maxInlineBytes = Math.max(
  ...[...targets.values()].map(($) =>
    $('script:not([src]):not([type="application/ld+json"])')
      .toArray()
      .reduce((total, el) => total + Buffer.byteLength($(el).text()), 0),
  ),
);
const jsBytes = externalBytes + maxInlineBytes;
check(jsBytes < 20000, `Client JavaScript budget exceeded: ${jsBytes} bytes`);
const social = await stat(join(root, "social/save-scum-game-save-history.png"));
check(social.size > 1000 && social.size < 350000, "Social image size");
if (failures.length) {
  console.error(failures.join("\n"));
  throw new Error(`${failures.length} static SEO checks failed`);
}
console.log(
  `SEO audit passed: ${htmlFiles.length} HTML pages, ${expected.length} indexable routes, valid JSON-LD, internal links, metadata, sitemap, robots, 404, ${jsBytes} bytes client JS.`,
);
console.log(
  "Software rich results are not claimed: a genuine rating/review and public offer are not available.",
);
