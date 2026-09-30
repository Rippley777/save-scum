import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Library, Snapshot, FileChange, Settings } from "./types";
export const desktop = isTauri();
export const catalog = [
  {
    name: "Baldur's Gate 3",
    steamAppId: "1086940",
    genre: "ROLE-PLAYING",
    color: "#ba9566",
  },
  {
    name: "Elden Ring",
    steamAppId: "1245620",
    genre: "ACTION RPG",
    color: "#bbaf72",
  },
  {
    name: "Stardew Valley",
    steamAppId: "413150",
    genre: "FARMING SIM",
    color: "#89b97c",
  },
  {
    name: "Hollow Knight",
    steamAppId: "367520",
    genre: "METROIDVANIA",
    color: "#93accd",
  },
  {
    name: "Cyberpunk 2077",
    steamAppId: "1091500",
    genre: "ACTION RPG",
    color: "#d3d969",
  },
  {
    name: "Hades",
    steamAppId: "1145360",
    genre: "ROGUELIKE",
    color: "#c67c6b",
  },
];
const defaults: Settings = {
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
};
function seed(): Library {
  const now = Date.now();
  const minutes = [3, 38, 124, 360, 1440, 2880];
  const games = catalog.map((g, i) => ({
    id: `game-${i}`,
    name: g.name,
    steamAppId: g.steamAppId,
    path: `~/Games/${g.name.replaceAll(" ", "")}/Saves`,
    watching: i !== 5,
    retention: "100",
    lastActivity: new Date(now - minutes[i] * 60000).toISOString(),
    error: null,
    running: i === 0,
    executables: [],
  }));
  const snapshots: Snapshot[] = games.flatMap((g, i) =>
    Array.from({ length: [47, 36, 64, 28, 42, 19][i] }, (_, j) => {
      const createdAt = new Date(
        now - (minutes[i] + j * 37 + (j > 8 ? 800 : 0)) * 60000,
      ).toISOString();
      const label =
        j === 2
          ? [
              "Before the final boss",
              "Before Malenia",
              "Year 3 · Spring, day 1",
              "Path of Pain, here we go",
              "Point of no return",
              "One more run",
            ][i]
          : j === 7
            ? "A very good place to come back to"
            : j === 5 && i === 0
              ? "PANIC SAVE"
              : "";
      const files = ["player.sav", "world.sav", "profile.dat"].map(
        (path, k) => ({
          path,
          hash: `demo-${i}-${k}-${k === 2 ? 0 : j}`,
          size: Math.round(
            (i === 2 ? 0.8 : 9.3) * (k + 1) * 1048576 + j * 8192,
          ),
          modified: createdAt,
        }),
      );
      return {
        id: `snapshot-${i}-${j}`,
        gameId: g.id,
        createdAt,
        kind: label === "PANIC SAVE" ? "panic" : label ? "manual" : "automatic",
        label,
        notes:
          j === 2
            ? "Everything is exactly where I want it. Let’s keep it that way."
            : "",
        favorite: j === 2,
        protected: !!label,
        files,
        size: files.reduce((a, f) => a + f.size, 0),
        changed: (j % 3) + 1,
      };
    }),
  );
  return {
    games,
    snapshots: snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    settings: defaults,
    storageBytes: 1_627_389_952,
    storagePath: "~/Library/Application Support/app.savescum.desktop",
  };
}
function readDemo(): Library {
  try {
    const raw = localStorage.getItem("save-scum-demo-v1");
    if (raw) return JSON.parse(raw);
  } catch {
    /* recover demo data only */
  }
  return seed();
}
let demo = readDemo();
export async function request<T = unknown>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (desktop) return invoke<T>("dispatch", { request: { action, ...args } });
  let result: unknown = null;
  switch (action) {
    case "library":
      return structuredClone(demo) as T;
    case "inspectFolder":
      result = {
        path: String(args.path),
        fileCount: String(args.path).includes("empty") ? 0 : 1,
        totalBytes: 1024,
        files: [{ path: "player.sav", size: 1024 }],
      };
      break;
    case "changeSaveFolder": {
      const game = demo.games.find((g) => g.id === args.gameId);
      if (!game) throw new Error("Game not found");
      for (const snapshot of demo.snapshots.filter((s) => s.gameId === game.id))
        snapshot.sourcePath ||= game.path;
      game.path = String(args.path);
      game.error = null;
      result = game;
      await request("capture", {
        gameId: game.id,
        kind: "manual",
        label: "First checkpoint in corrected save folder",
      });
      break;
    }
    case "previewRestore": {
      const snapshot = demo.snapshots.find((s) => s.id === args.id);
      if (!snapshot?.files.length)
        throw new Error(
          "This checkpoint contains no save files and cannot restore progress.",
        );
      const game = demo.games.find((g) => g.id === snapshot.gameId)!;
      result = {
        snapshotId: snapshot.id,
        savePath: game.path,
        fileCount: snapshot.files.length,
        currentFileCount: snapshot.files.length,
        changes: snapshot.files.map((f) => ({
          path: f.path,
          status: "modified",
          before: f,
          after: f,
        })),
        identical: false,
        gameRunning: false,
      };
      break;
    }
    case "capture": {
      const game =
        demo.games.find(
          (g) => g.id === (args.gameId || demo.settings.panicGameId),
        ) ||
        demo.games
          .filter((g) => g.watching)
          .sort((a, b) =>
            (b.lastActivity || "").localeCompare(a.lastActivity || ""),
          )[0];
      if (!game) throw new Error("Add a monitored game first.");
      const last = demo.snapshots.find((s) => s.gameId === game.id);
      const s: Snapshot = {
        id: crypto.randomUUID(),
        gameId: game.id,
        sourcePath: game.path,
        createdAt: new Date().toISOString(),
        kind: args.kind as Snapshot["kind"],
        label: args.kind === "panic" ? "PANIC SAVE" : String(args.label || ""),
        notes: "",
        favorite: false,
        protected: args.kind === "panic" || args.kind === "safety",
        files: structuredClone(
          last?.files.length
            ? last.files
            : [
                {
                  path: "player.sav",
                  hash: "demo",
                  size: 1024,
                  modified: new Date().toISOString(),
                },
              ],
        ),
        size: last?.size || 0,
        changed: 0,
      };
      demo.snapshots.unshift(s);
      game.lastActivity = s.createdAt;
      result = s;
      break;
    }
    case "patchSnapshot": {
      const s = demo.snapshots.find((s) => s.id === args.id);
      if (s) Object.assign(s, args);
      break;
    }
    case "monitoring":
      demo.games
        .filter((g) => !args.gameId || g.id === args.gameId)
        .forEach((g) => (g.watching = Boolean(args.watching)));
      break;
    case "saveSettings":
      demo.settings = args.settings as Settings;
      break;
    case "retention": {
      const g = demo.games.find((g) => g.id === args.gameId);
      if (g) g.retention = String(args.policy);
      break;
    }
    case "restore": {
      const s = demo.snapshots.find((s) => s.id === args.id);
      if (!s) throw new Error("Snapshot not found");
      await request("capture", {
        gameId: s.gameId,
        kind: "safety",
        label: "Before restore — automatic safety copy",
      });
      result = {
        status: "restored",
        savePath: demo.games.find((g) => g.id === s.gameId)?.path,
        fileCount: s.files.length,
        changedFiles: s.files.length,
        safetySnapshotId: demo.snapshots[0]?.id,
        recoveryPath: null,
      };
      break;
    }
    case "compare": {
      const a = demo.snapshots.find((s) => s.id === args.before),
        b = demo.snapshots.find((s) => s.id === args.after);
      if (!a || !b) throw new Error("Select two snapshots");
      const changes: FileChange[] = [];
      for (const f of b.files) {
        const old = a.files.find((o) => o.path === f.path);
        if (old?.hash !== f.hash)
          changes.push({
            path: f.path,
            status: old ? "modified" : "added",
            before: old || null,
            after: f,
          });
      }
      for (const f of a.files)
        if (!b.files.some((n) => n.path === f.path))
          changes.push({
            path: f.path,
            status: "removed",
            before: f,
            after: null,
          });
      result = changes;
      break;
    }
    case "verify":
      result = {
        healthySnapshots: demo.snapshots.length,
        missingBlobs: [],
        corruptBlobs: [],
        orphanedBlobs: [],
      };
      break;
    case "discover":
      result = catalog
        .filter((c) => !demo.games.some((g) => g.steamAppId === c.steamAppId))
        .map((c) => ({
          ...c,
          path: `~/Games/${c.name}/Saves`,
          source: "saveFolder",
          installPath: null,
        }));
      break;
    case "addGame": {
      const game = {
        id: crypto.randomUUID(),
        name: String(args.name),
        path: String(args.path),
        steamAppId: (args.steamAppId as string) || null,
        watching: true,
        retention: demo.settings.defaultRetention,
        lastActivity: null,
        error: null,
        running: false,
        executables: [],
      };
      demo.games.push(game);
      result = game;
      break;
    }
    default:
      throw new Error(
        "This action requires the desktop app. The browser demo does not access your files.",
      );
  }
  localStorage.setItem("save-scum-demo-v1", JSON.stringify(demo));
  return result as T;
}
export function bytes(value: number): string {
  if (value === 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][i]}`;
}
export function relative(value: string | null): string {
  if (!value) return "No snapshots yet";
  const min = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
export function date(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
