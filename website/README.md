# Save Scum website

A static Astro, TypeScript, and Tailwind CSS product site for Save Scum. The homepage keeps the desktop app’s charcoal and green identity, with an HTML/CSS timeline, a simulated Panic Save interaction, and content that works without JavaScript. The site has 13 indexable pages, including five substantial backup/recovery guides, plus a real 404 page.

The desktop app is one directory above this package. Its React/Tauri build is unchanged. Run the commands below **from `save-scum/website`**.

## Run and build

Use Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4387`. To produce the deployable artifact:

```sh
npm run build
```

This checks Astro/TypeScript, generates static HTML, generates `sitemap.xml` and `robots.txt`, adds hashes for inline scripts to the static hosting CSP, and audits the generated output. Everything to deploy is in **`dist/`**. There is no server runtime, database, authentication, API, or function. `scripts/serve.mjs` is only a local test server and is not in `dist`.

```sh
npm run preview
npm run format:check
npm run check
npm run audit:seo
npx playwright install chromium
npm test
npm run test:performance
```

Lighthouse writes desktop/mobile homepage and mobile recovery-guide reports to `reports/`. Scores are local lab measurements, not a guarantee of production field performance. It uses the installed Playwright Chromium, serves the generated artifact with the hosting headers, and cleans up its own server. Reports and test artifacts are ignored by version control.

## Content and configuration

- `src/config/site.ts`: canonical domain, publisher, app version, verified platform, optional release/source/license links, verification tokens, preview indexing mode.
- `src/config/content.ts`: reusable feature copy, FAQ, and use cases.
- `src/config/games.ts`: location hints copied from the desktop app’s `data/games.json`, reviewed September 30, 2026. Keep them in sync deliberately; discovery hints are not compatibility certifications.
- `src/content/guides/*.md`: substantive guides with validated, unique metadata. `src/pages/guides/[slug].astro` renders every guide into real static HTML. The build discovers the generated routes for the sitemap automatically.
- `src/components/seo/`: shared head, safe JSON-LD serialization, organization, application, and breadcrumbs.
- `src/layouts/`: page-specific title, description, canonical, image, noindex, and article-type APIs.

Copy `.env.example` to `.env` only if you need build-time overrides. No environment file is needed for normal functionality. Rebuild after changing configuration. These values are public website metadata; never put secrets in them.

| Variable                          | Purpose                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`                 | HTTPS production origin; defaults to `https://savescum.oddware.dev`, the existing project-catalog destination. Root origin only. Preview/Azure hostnames are rejected. |
| `PUBLIC_GITHUB_URL`               | Verified public Save Scum repository. Empty by default; source/issues/release links are omitted.                                                                       |
| `PUBLIC_DOWNLOAD_URL`             | Real release asset or installer URL. Empty by default.                                                                                                                 |
| `PUBLIC_DOWNLOAD_PLATFORM`        | Required together with a download URL; visible platform label. Update verified platform data after actual release validation.                                          |
| `PUBLIC_LICENSE_URL`              | Verified license document. Omitted until supplied.                                                                                                                     |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | Real Search Console URL-prefix verification token, if using this method.                                                                                               |
| `PUBLIC_BING_SITE_VERIFICATION`   | Real Bing verification token.                                                                                                                                          |
| `SITE_ENV`                        | Set to `preview` for a non-production build; otherwise production.                                                                                                     |

The current application documentation confirms a **local macOS development build**, not signed public installers. Windows and Linux remain targets pending verification. Public downloads and a project-specific source repository were not established in the workspace. The local code is covered by the MIT NON-AI license linked below; a public license URL is not configured. The release page states this. “Follow Rippley Labs on GitHub” goes to the known developer profile, not a fabricated repository. Only add a download after verifying the real artifact, platform, version, and signing status.

The product is described as free, without an account or subscription, as requested. A free Offer is emitted only when an actual download is configured. Update visible copy and metadata together if product policy changes.

## SEO architecture and audit

The homepage targets automatic local game-save backups and version history. Features, workflow, docs, games, release status, FAQ, and guides each answer a distinct question. Guides cover PC backups, Steam backups, overwritten saves, corrupted saves, and version control. Recovery copy explicitly requires an earlier captured state and does not imply arbitrary recovery or format repair. Guide author/review dates are real editorial metadata; update review dates only after an actual review.

Every indexable route has one H1, unique titles and descriptions, an absolute canonical, Open Graph/Twitter metadata, and readable content in the initial HTML. Secondary pages have visible breadcrumbs and matching JSON-LD. FAQ answers remain fully visible, without a JavaScript accordion. Internal links are contextual. Sitemap generation scans generated pages, includes all indexable canonicals, and omits 404/noindex pages. It does not invent `lastmod` timestamps.

`npm run build` fails on missing internal pages/fragments/assets, duplicate metadata, invalid JSON-LD, inconsistent hosts, heading skips, accidental production noindex, a mismatched sitemap, missing image dimensions/alt text, broken 404 configuration, or excessive client JavaScript. The JavaScript budget is 20 KB uncompressed for external scripts plus the largest page’s executable inline scripts. JSON-LD is not counted as executable JavaScript.

### Schema honesty and rich-result eligibility

The homepage emits `SoftwareApplication` with name, description, URL, image, version, category, publisher, and the locally verified operating system. Every page uses one consistent Rippley Labs organization entity. No ratings, reviews, user counts, awards, or download totals are fabricated.

**Google software rich results are not currently claimed.** [Google requires a genuine rating/review and an offer](https://developers.google.com/search/docs/appearance/structured-data/software-app) for that enhancement. This development-stage app has neither a verified public offer nor a genuine supplied review. Valid Schema.org markup and technical SEO do not imply rich-result eligibility. When real releases and reviews exist, add their visible evidence and matching schema together, and run Google’s Rich Results Test. Do not add invented data just to remove a validator warning. The local audit checks JSON/schema consistency; it is not an official Google eligibility test.

We intentionally do not add FAQ rich-result claims or hidden rating signals. Search Console and rich-result services must be checked against the deployed public URL after launch.

### Images, fonts, and JavaScript

App and library illustrations are HTML/CSS with abstract icons, not publisher artwork. Sample counts are labeled illustrative. The hero needs no downloaded screenshot, React runtime, or animation framework. Only the mobile menu enhancement and two simulated demo controls run client JavaScript. No real game files are read by the site.

`public/social/save-scum-game-save-history.png` is a 1200 × 630 social card with a snapshot timeline. Its editable vector source lives in `scripts/social-image.mjs`; regenerate with `npm run generate:social`. The sharing image is metadata, not a render-blocking hero resource. If you add page screenshots, use descriptive filenames, AVIF/WebP where appropriate, `srcset`/`sizes`, explicit dimensions, useful alt text, and lazy loading below the fold. Do not lazy-load the LCP image.

The site bundles one Latin-subset Manrope variable WOFF2, with `font-display: swap`, a preload, system body-font fallbacks, and its SIL license in `public/fonts/`. No remote font or analytics dependency is required.

## Azure Static Web Apps Free

The production resource is `save-scum` in resource group `rg-save-scum`, on the **Free** plan in Central US. Its public HTTPS address is <https://kind-field-075301510.5.azurestaticapps.net/>. Deployment uses the local static artifact; GitHub continuous deployment is not connected yet.

To redeploy from this directory after signing in with `az login`, follow the [Azure CLI deployment procedure](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli-deploy):

```sh
npm run build
SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --name save-scum --resource-group rg-save-scum --query properties.apiKey -o tsv)" \
  npx --yes @azure/static-web-apps-cli@2.0.10 deploy ./dist --swa-config-location ./dist --env production --no-use-keychain
```

Explicitly select `dist` for the hosting configuration: it contains the generated CSP script hashes. The `public` directory contains the source template only. The command passes the deployment token through the process environment without writing it into the project.

The branded canonical remains `https://savescum.oddware.dev`. Its DNS is not managed in this Azure subscription and the hostname does not currently resolve. To connect it, create a CNAME named `savescum` at the existing `oddware.dev` DNS provider pointing to `kind-field-075301510.5.azurestaticapps.net`, then add the hostname under this resource's Custom domains and verify the managed HTTPS certificate. Until that is complete, use the Azure URL above; branded canonical and social-image URLs depend on that DNS setup.

Live verification on September 30, 2026: Azure reports the production environment `Ready` with SKU `Free`. All 13 content pages return HTTP 200 and match the local build exactly. Styles, font, and social image load; the custom missing-page response returns HTTP 404; slash redirects, CSP hashes, robots, and sitemap are present. Chromium checks passed for the checkpoint/Panic Save demos and mobile navigation with no browser errors.

Deploy **only `website/dist`**, never the desktop app’s `dist`. All routes are static directory indexes. The root `staticwebapp.config.json` in the artifact uses slash normalization and a 404 rewrite with status 404. There is no SPA fallback that turns unknown pages into a 200 homepage. Security headers and script hashes are generated at build time; do not manually edit built HTML afterward.

For an Azure-managed build from the application repository:

- App location: `website`
- API location: empty
- Output location: `dist`
- App build command: `npm run build`
- Build Node version: 22.12+ (use the included workflow to control it explicitly)

The application-root workflow `../.github/workflows/website.yml` builds and tests changes to this site on Node 22. It uploads a ready static artifact. Deployment is opt-in: set repository variable `DEPLOY_SAVE_SCUM_WEBSITE=true` and secret `AZURE_STATIC_WEB_APPS_API_TOKEN` from your Free-tier resource. The deploy action uses `app_location: website/dist` and skips Oryx app/API builds. No paid edge gateway, serverless function, database, or Node server is required. If extracting `website` as its own repository, move the workflow to that repository’s `.github/workflows/` and remove the `website/` path prefixes.

Pull-request builds set `SITE_ENV=preview`. Their HTML has `noindex`, their hosting headers set `X-Robots-Tag: noindex, nofollow`, and their sitemap contains no indexable pages. Canonicals still point to the branded production domain. The robots file allows crawling so crawlers can actually see the noindex directive. Never submit a preview URL or preview sitemap. Production builds omit the noindex header and advertise the production sitemap.

### Preferred hostname and HTTPS

The existing catalog’s `https://savescum.oddware.dev` is the default canonical. Change `PUBLIC_SITE_URL` before launch if a different branded domain is intended. Internal links are root-relative, and canonical, schema, social, and sitemap URLs all derive from the one HTTPS origin. The build does not derive canonicals from request hosts, Azure URLs, or pull-request domains.

Connect the chosen custom domain and confirm its HTTPS certificate in Azure. Do not add a `www` alias unless you intend to manage it. DNS records alone do not issue redirects. Azure Free’s static configuration does not offer a general host-conditional redirect rule; do not add an unconditional catch-all redirect that would loop on the preferred host. Where your existing domain/hosting service supports it, permanently redirect alternate hostnames to the preferred origin while preserving paths. Otherwise the common canonical URLs are the consolidation signal. No paid Front Door/forwarding gateway is required or configured. See [Azure’s configuration reference](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration).

## Search Console and Bing launch checklist

1. Deploy the production artifact and connect the intended HTTPS custom domain.
2. Verify a Search Console **Domain property** using the DNS record Google supplies. Alternatively, set the real HTML verification token and rebuild for a URL-prefix property. Never add a sample token.
3. Submit `https://YOUR-ACTUAL-PRODUCTION-HOST/sitemap.xml` using the canonical configured in `src/config/site.ts`; the placeholder in this README is not emitted in site files.
4. Inspect the homepage and each guide URL. Confirm fetched HTML contains the content, the chosen canonical is correct, and indexing is allowed.
5. Test the deployed homepage with [Google’s Rich Results Test](https://search.google.com/test/rich-results) and [Schema.org’s validator](https://validator.schema.org/). Expect software enhancement requirements to remain unmet until real offer/review evidence exists.
6. Verify Bing Webmaster Tools via its supplied DNS/meta instructions, or an available Search Console import. Set only the genuine Bing token if using HTML verification.
7. Monitor indexing, crawl errors, selected canonicals, guide queries, and actual Core Web Vitals. Do not treat a local Lighthouse score as real-user field data. INP requires actual interaction/field observation; the lab run reports TBT as a diagnostic.
8. Check the Azure hostname, custom-domain routes, refreshes, redirects, and a nonexistent URL returning 404 after deployment. The Free Azure resource has been created; custom-domain DNS, Search Console, and external verification remain to be configured.

## Verified locally — September 30, 2026

- Production build: 14 static HTML pages, 13 indexable routes, five guides, no runtime server.
- Astro/TypeScript check: zero errors, warnings, or hints. Prettier check passes.
- Build audit: unique metadata, canonical consistency, JSON-LD, headings, local links/fragments/assets, sitemap, robots, real 404, and script budget pass.
- Browser suite: 12 tests pass for both production and preview builds. Coverage includes all routes without JavaScript, production CSP, keyboard demos, mobile navigation, responsive layouts from 320px through 2560px, accessibility, and reduced motion.
- Client JavaScript: 1,234 uncompressed bytes on the homepage, with no React runtime.
- Local Lighthouse: homepage mobile **100 / 100 / 100 / 100**, homepage desktop **100 / 100 / 100 / 100**, recovery guide mobile **100 / 100 / 100 / 100** for Performance / Accessibility / Best Practices / SEO. LCP was 1.4s, 0.3s, and 1.2s respectively; all three measured CLS 0 and TBT 0ms. The desktop run uses Lighthouse’s desktop configuration, not only a changed viewport.
- These are local simulated measurements with Chromium. Production DNS, HTTPS, redirect behavior, field Core Web Vitals, Search Console, and Google rich-result eligibility require post-deployment checks.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.

## House Edge analytics

House Edge tracks page views, navigation, anonymous sessions, errors, and Web Vitals. The browser SDK is installed from `vendor/house-edge-analytics-0.1.1.tgz`, so this project can build independently of the House Edge repository or an npm registry publication. Commit the tarball with the dependency and lockfile.

To activate it:

1. Create a project in your House Edge dashboard with project key `save-scum-website` (or override `PUBLIC_HOUSE_EDGE_PROJECT`). Add this site's exact origin to its allowed origins, including the port for local testing.
2. Set `PUBLIC_HOUSE_EDGE_KEY` to that project's **browser ingestion key** and `PUBLIC_HOUSE_EDGE_ENDPOINT` to your collector's full URL, such as `https://analytics.example.com/api/collect`. See `.env.example`. Use `.env.local` locally; configure your build environment when deploying.
3. Rebuild and redeploy. These public values are embedded at build time. Visit the site and check House Edge's Live Activity for `page_view` and `session_start` after about five seconds.

Tracking stays off when the key or endpoint is missing. Development tracking is off unless `PUBLIC_HOUSE_EDGE_TRACK_DEVELOPMENT=true`; use a separate development project to avoid mixing test traffic into production. Do Not Track is respected. Only browser ingestion keys belong in these public variables.

The build adds the configured collector origin to `connect-src` in the generated Static Web Apps policy. This integration applies to the website; the desktop app has no added telemetry.
