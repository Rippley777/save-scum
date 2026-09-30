function httpsUrl(value: string | undefined, fallback = "") {
  if (!value) return fallback;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Public URLs must use HTTPS without credentials.");
  return url.href;
}
const canonical = new URL(
  httpsUrl(import.meta.env.PUBLIC_SITE_URL, "https://savescum.oddware.dev"),
);
if (
  canonical.pathname !== "/" ||
  canonical.search ||
  canonical.hash ||
  canonical.hostname.endsWith(".azurestaticapps.net") ||
  canonical.hostname === "localhost"
) {
  throw new Error(
    "PUBLIC_SITE_URL must be the root of the branded production domain.",
  );
}
const githubUrl = httpsUrl(import.meta.env.PUBLIC_GITHUB_URL);
const downloadUrl = httpsUrl(import.meta.env.PUBLIC_DOWNLOAD_URL);
const downloadPlatform = import.meta.env.PUBLIC_DOWNLOAD_PLATFORM?.trim() || "";
if (downloadUrl && !downloadPlatform)
  throw new Error(
    "Set PUBLIC_DOWNLOAD_PLATFORM to the verified release platform when adding a download.",
  );
export const site = {
  name: "Save Scum",
  description:
    "Automatic local game save backup and version history. Preserve snapshots of your save files and restore a previous captured state.",
  canonicalUrl: canonical.origin,
  publisher: "Rippley Labs",
  publisherUrl: "https://rippleylabs.com",
  developmentUrl: "https://github.com/Rippley777",
  githubUrl,
  downloadUrl,
  downloadPlatform,
  licenseUrl: httpsUrl(import.meta.env.PUBLIC_LICENSE_URL),
  version: "0.1.0",
  verifiedOS: "macOS",
  price: "0",
  image: "/social/save-scum-game-save-history.png",
  googleVerification: import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION || "",
  bingVerification: import.meta.env.PUBLIC_BING_SITE_VERIFICATION || "",
  noindex:
    import.meta.env.SITE_ENV === "preview" ||
    process.env.SITE_ENV === "preview",
};
export const absoluteUrl = (path: string) =>
  new URL(path, `${site.canonicalUrl}/`).href;
export const nav = [
  { name: "Features", href: "/features/" },
  { name: "How it works", href: "/how-it-works/" },
  { name: "Guides", href: "/guides/" },
  { name: "Docs", href: "/docs/" },
];
