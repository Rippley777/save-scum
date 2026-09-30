import lighthouse, { desktopConfig } from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const port = 4390;
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: "pipe",
});
await new Promise((resolve, reject) => {
  server.stdout.once("data", resolve);
  server.once("error", reject);
  server.once("exit", (code) => {
    if (code) reject(new Error("Static test server failed"));
  });
});
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
});
const summaries = [];
try {
  await mkdir("reports", { recursive: true });
  for (const [name, path, preset] of [
    ["home-mobile", "/", undefined],
    ["home-desktop", "/", "desktop"],
    [
      "recovery-mobile",
      "/guides/how-to-restore-overwritten-game-save/",
      undefined,
    ],
  ]) {
    const result = await lighthouse(
      `http://127.0.0.1:${port}${path}`,
      {
        port: chrome.port,
        output: "html",
        logLevel: "error",
        onlyCategories: [
          "performance",
          "accessibility",
          "best-practices",
          "seo",
        ],
        disableStorageReset: false,
      },
      preset === "desktop" ? desktopConfig : undefined,
    );
    if (!result) throw new Error("Lighthouse did not return a report");
    await writeFile(`reports/lighthouse-${name}.html`, result.report);
    await writeFile(
      `reports/lighthouse-${name}.json`,
      JSON.stringify(result.lhr, null, 2),
    );
    const summary = {
      name,
      ...Object.fromEntries(
        Object.entries(result.lhr.categories).map(([key, value]) => [
          key,
          Math.round(value.score * 100),
        ]),
      ),
      LCP: result.lhr.audits["largest-contentful-paint"].displayValue,
      CLS: result.lhr.audits["cumulative-layout-shift"].displayValue,
      TBT: result.lhr.audits["total-blocking-time"].displayValue,
    };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }
  await writeFile(
    "reports/lighthouse-summary.json",
    JSON.stringify(summaries, null, 2),
  );
} finally {
  chrome.kill();
  server.kill();
}
