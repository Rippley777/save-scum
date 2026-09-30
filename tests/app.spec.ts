import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your games. Protected." }),
  ).toBeVisible();
});

test("library search, filters, list view, and monitoring stay in sync", async ({
  page,
}) => {
  await expect(page.locator(".game-card")).toHaveCount(6);
  await page
    .getByRole("textbox", { name: "Search games and snapshots" })
    .fill("elden");
  await expect(page.locator(".game-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Search games and snapshots" })
    .clear();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".game-grid")).toHaveClass(/list-view/);
  await page
    .getByRole("button", { name: "Pause Elden Ring monitoring" })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume Elden Ring monitoring" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Paused \d/ }).click();
  await expect(page.locator(".game-card")).toHaveCount(2);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume Elden Ring monitoring" }),
  ).toBeVisible();
});

test("manual checkpoint, notes, favorites and reversible restore", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Open Baldur's Gate 3 history" })
    .click();
  await page
    .getByRole("button", { name: "Create checkpoint", exact: true })
    .click();
  await page
    .getByPlaceholder("Before I do something stupid")
    .fill("Before the dragon");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create checkpoint" })
    .click();
  await page.getByRole("button", { name: /Before the dragon/ }).click();
  await page.getByRole("button", { name: "Toggle favorite" }).click();
  await expect(
    page.getByRole("button", { name: "Toggle favorite" }),
  ).toHaveText("Favorited");
  await page.getByRole("button", { name: "Edit details" }).click();
  await page
    .getByPlaceholder("What makes this moment worth keeping?")
    .fill("Full health, all potions.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.locator(".snapshot-notes")).toHaveText(
    "Full health, all potions.",
  );
  await page.getByRole("button", { name: "Restore this save" }).click();
  await page.getByRole("checkbox", { name: "I have closed the game" }).check();
  await page.getByRole("button", { name: "Restore save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save files restored and verified" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Before restore — automatic safety copy/,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Saved checkpoints" })
    .click();
  await expect(
    page.getByRole("button", { name: /Before the dragon/ }),
  ).toBeVisible();
});

test("panic save targets active game and is protected", async ({ page }) => {
  await page
    .locator(".panic-banner")
    .getByRole("button", { name: "Panic save" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Demo panic checkpoint created",
  );
  await page
    .getByRole("button", { name: "Open Baldur's Gate 3 history" })
    .click();
  await page.getByRole("button", { name: "Panic saves", exact: true }).click();
  await page.locator(".timeline-card").first().click();
  await expect(page.locator(".snapshot-inspector h2")).toHaveText("PANIC SAVE");
  await expect(
    page
      .locator(".snapshot-inspector")
      .getByRole("button", { name: "Protected", exact: true }),
  ).toBeVisible();
});

test("compare displays changed file sizes and timestamps", async ({ page }) => {
  await page.getByRole("button", { name: "Open Elden Ring history" }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Compare (2/2)" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "What changed between saves?",
  );
  await expect(page.locator(".compare-row")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toContainText("player.sav");
});

test("add game and verify library", async ({ page }) => {
  await page.getByRole("button", { name: "Add game", exact: true }).click();
  await page.getByRole("button", { name: /Detect installed games/ }).click();
  await expect(
    page.getByText("No new games found. Choose a save folder manually below."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Game name" })
    .fill("A tiny adventure");
  await page
    .getByRole("textbox", { name: "Save folder" })
    .fill("~/Games/Adventure/Saves");
  await page.getByRole("button", { name: "Protect this game" }).click();
  await expect(page.locator(".game-card")).toHaveCount(7);
  await page
    .getByRole("button", { name: "Storage & integrity", exact: true })
    .click();
  await page.getByRole("button", { name: "Verify snapshot library" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "healthy demo snapshots",
  );
  await expect(page.locator(".verify-results")).toContainText(
    "Missing blobs 0",
  );
});

test("settings persist and modal keyboard escape restores focus", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^Settings/ }).click();
  const toggle = page.getByRole("switch", { name: "Panic save notifications" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Default retention", exact: true })
    .selectOption("smart");
  await page.reload();
  await page.getByRole("button", { name: "Add game", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add game", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: /^Settings/ }).click();
  await expect(
    page.getByRole("switch", { name: "Panic save notifications" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Default retention", exact: true }),
  ).toHaveValue("smart");
});

test("mobile layout stays within viewport and opens game history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page
    .getByRole("button", { name: "Open Stardew Valley history" })
    .click();
  await page.locator(".timeline-card").first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await expect(
    page.getByRole("button", { name: "Restore this save" }),
  ).toBeVisible();
});

test("empty library offers onboarding and errors never become successful actions", async ({
  page,
}) => {
  await page.evaluate(() => {
    const data = {
      games: [],
      snapshots: [],
      settings: {
        launchAtStartup: false,
        minimizeToTray: true,
        notifications: false,
        panicNotifications: true,
        compressionLevel: 3,
        debounceMs: 2000,
        ignoreTemporary: true,
        defaultRetention: "100",
        storageLimitGb: 0,
        panicGameId: null,
      },
      storageBytes: 0,
      storagePath: "~/Demo",
    };
    localStorage.setItem("save-scum-demo-v1", JSON.stringify(data));
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Protect my first game" }),
  ).toBeVisible();
  await expect(
    page.locator(".panic-banner").getByRole("button", { name: "Panic save" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Protect my first game" }).click();
  await expect(
    page.getByRole("button", { name: "Protect this game" }),
  ).toBeDisabled();
});

test("Steam installs require a save folder while detected saves are ready to protect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const root = globalThis as typeof globalThis & {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
    };
    root.isTauri = true;
    root.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (
        command: string,
        args: { request?: { action: string } },
      ) => {
        if (command !== "dispatch") return 1;
        if (args.request?.action === "library")
          return {
            games: [],
            snapshots: [],
            storageBytes: 0,
            storagePath: "~/Test library",
            settings: {
              launchAtStartup: false,
              minimizeToTray: true,
              notifications: false,
              panicNotifications: true,
              compressionLevel: 3,
              debounceMs: 2000,
              ignoreTemporary: true,
              defaultRetention: "100",
              storageLimitGb: 0,
              panicGameId: null,
            },
          };
        if (args.request?.action === "inspectFolder")
          return { path: "test", fileCount: 3, totalBytes: 123, files: [] };
        if (args.request?.action === "discover")
          return [
            {
              name: "The Jackbox Party Pack 3",
              steamAppId: "434170",
              path: null,
              installPath:
                "/Users/test/Library/Application Support/Steam/steamapps/common/The Jackbox Party Pack 3",
              source: "steamInstall",
            },
            {
              name: "Stardew Valley",
              steamAppId: "413150",
              path: "/Users/test/.config/StardewValley/Saves",
              installPath: null,
              source: "saveFolder",
            },
          ];
        return null;
      },
    };
    root.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.reload();
  await page.getByRole("button", { name: "Add game", exact: true }).click();
  await page.getByRole("button", { name: /Detect installed games/ }).click();
  await page
    .getByRole("button", {
      name: /The Jackbox Party Pack 3 Installed on Steam/,
    })
    .click();
  await expect(page.getByRole("combobox", { name: "Game name" })).toHaveValue(
    "The Jackbox Party Pack 3",
  );
  await expect(page.getByRole("textbox", { name: "Save folder" })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "Protect this game" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /Stardew Valley Save folder detected/ })
    .click();
  await expect(page.getByRole("textbox", { name: "Save folder" })).toHaveValue(
    "/Users/test/.config/StardewValley/Saves",
  );
  await expect(
    page.getByRole("button", { name: "Protect this game" }),
  ).toBeEnabled();
});

test("empty checkpoint blocks restore and save folder repair requires files", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const modulePath = "/src/api.ts";
    const api = await import(modulePath);
    const library = await api.request("library");
    const game = library.games[0];
    game.path = "/Users/test/empty";
    game.error =
      "No save files backed up. Choose the game's existing save folder.";
    for (const snapshot of library.snapshots.filter(
      (s: { gameId: string }) => s.gameId === game.id,
    )) {
      snapshot.files = [];
      snapshot.size = 0;
    }
    localStorage.setItem("save-scum-demo-v1", JSON.stringify(library));
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your games. Needs attention." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Baldur's Gate 3 history" })
    .click();
  await page.getByRole("button", { name: /Before the final boss/ }).click();
  await page.getByRole("button", { name: "Restore this save" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "no save files",
  );
  await expect(
    page.getByRole("button", { name: "Restore save", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Fix save folder" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "This folder is empty" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this save folder" }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("/Users/test/actual-saves");
  await expect(
    page.getByRole("status").filter({ hasText: "1 save files found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use this save folder" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /First checkpoint in corrected save folder/,
    }),
  ).toBeVisible();
});
