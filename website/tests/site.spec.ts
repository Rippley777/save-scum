import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const routes = [
  "/",
  "/download/",
  "/features/",
  "/how-it-works/",
  "/games/",
  "/docs/",
  "/faq/",
  "/guides/",
  "/guides/how-to-back-up-game-saves/",
  "/guides/how-to-back-up-steam-saves/",
  "/guides/how-to-restore-overwritten-game-save/",
  "/guides/how-to-recover-corrupted-game-save/",
  "/guides/game-save-version-control/",
];

test("every content route serves useful HTML with JavaScript disabled", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const route of routes) {
    const response = await page.goto("http://127.0.0.1:4388" + route);
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      process.env.SITE_ENV === "preview"
        ? "noindex, follow"
        : "index, follow, max-image-preview:large",
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      700,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://savescum.oddware.dev" + route,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4388/");
  await page.getByLabel("Open navigation").click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Guides", exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\/$/);
  await context.close();
});

test("demo controls work under the production CSP without accessing files", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(page.locator("[data-demo-result]")).toContainText(
    "Demo checkpoint 1 created",
  );
  await page
    .getByRole("button", { name: "Preview restoring the manual checkpoint" })
    .click();
  await expect(page.locator("[data-demo-result]")).toContainText(
    "close the game",
  );
  const panic = page.getByRole("button", { name: "Try the Panic Save demo" });
  await panic.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panic-result]")).toContainText(
    "DEMO PANIC SAVE CREATED",
  );
  await expect(panic).toBeFocused();
  expect(errors).toEqual([]);
});

test("mobile navigation, focus and release links are honest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  const menu = page.getByLabel("Open navigation");
  await menu.click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(page.locator(".mobile-menu")).not.toHaveAttribute("open", "");
  await page
    .getByRole("link", { name: "Get Save Scum", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Public installers are not available here yet.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Follow Rippley Labs on GitHub/ }).first(),
  ).toHaveAttribute("href", "https://github.com/Rippley777");
  expect(await page.locator("a[download]").count()).toBe(0);
});

test("layouts fit phone, tablet, desktop and ultrawide screens", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 950 });
    for (const route of [
      "/",
      "/games/",
      "/docs/",
      "/guides/how-to-restore-overwritten-game-save/",
    ]) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}`,
      ).toBe(true);
    }
  }
});

for (const route of [
  "/",
  "/download/",
  "/features/",
  "/games/",
  "/docs/",
  "/faq/",
  "/guides/how-to-restore-overwritten-game-save/",
]) {
  test(`accessibility and reduced motion: ${route}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}

test("404 remains a real 404 and clean routes survive refresh", async ({
  page,
  request,
}) => {
  const response = await page.goto("/missing-checkpoint/");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Save state not found." }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
  await page.goto("/guides/game-save-version-control/");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Game Save Version Control Explained",
  );
  const redirect = await request.get("/guides", { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers().location).toBe("/guides/");
});
