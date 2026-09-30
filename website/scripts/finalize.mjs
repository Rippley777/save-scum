import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { load } from "cheerio";
const root = new URL("../dist/", import.meta.url).pathname;
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : join(dir, entry.name),
      ),
    )
  ).flat();
}
const pages = (await files(root)).filter((path) => path.endsWith(".html"));
const hashes = new Set();
const analyticsOrigins = new Set();
const urls = [];
let origin,
  preview = false;
for (const file of pages) {
  const $ = load(await readFile(file, "utf8"));
  const endpoint = $('meta[name="house-edge-endpoint"]').attr("content");
  if (endpoint) analyticsOrigins.add(new URL(endpoint).origin);
  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) throw new Error(`Missing canonical: ${file}`);
  origin ??= new URL(canonical).origin;
  const noindex = $('meta[name="robots"]').attr("content")?.includes("noindex");
  if (relative(root, file) === "index.html") preview = !!noindex;
  if (!noindex) urls.push(canonical);
  $("script:not([src])").each((_, script) => {
    hashes.add(
      `'sha256-${createHash("sha256")
        .update($(script).html() || "")
        .digest("base64")}'`,
    );
  });
}
const configPath = join(root, "staticwebapp.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
config.globalHeaders["Content-Security-Policy"] = config.globalHeaders[
  "Content-Security-Policy"
].replace("script-src 'self'", `script-src 'self' ${[...hashes].join(" ")}`);
if (analyticsOrigins.size) {
  config.globalHeaders["Content-Security-Policy"] = config.globalHeaders[
    "Content-Security-Policy"
  ].replace(
    "connect-src 'self'",
    `connect-src 'self' ${[...analyticsOrigins].join(" ")}`,
  );
}
if (preview) config.globalHeaders["X-Robots-Tag"] = "noindex, nofollow";
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
const xmlEscape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
await writeFile(
  join(root, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    ...new Set(urls),
  ]
    .sort()
    .map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
// Preview pages remain crawlable so crawlers can see noindex. Do not submit preview URLs.
await writeFile(
  join(root, "robots.txt"),
  `User-agent: *\nAllow: /\n\n${preview ? "# Preview build: HTML and HTTP headers exclude indexing.\n" : `Sitemap: ${origin}/sitemap.xml\n`}`,
);
console.log(
  `Generated sitemap for ${urls.length} indexable pages; ${preview ? "preview noindex headers" : "production crawling"}; hashed inline JSON-LD for CSP.`,
);
