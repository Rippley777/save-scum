import { trackView } from "./lib/analytics";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  Command,
  Database,
  Disc3,
  Ellipsis,
  File,
  Folder,
  FolderOpen,
  Gamepad2,
  GitBranch,
  HardDrive,
  History,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Terminal,
  TriangleAlert,
  Unplug,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { bytes, catalog, date, desktop, relative, request } from "./api";
import type {
  FolderInspection,
  RestorePreview,
  RestoreReport,
  Discovered,
  FileChange,
  Game,
  IntegrityReport,
  Library,
  Settings,
  Snapshot,
} from "./types";

type View = "library" | "timeline" | "favorites" | "storage" | "settings";
type Modal =
  | "folder"
  | "add"
  | "checkpoint"
  | "restore"
  | "compare"
  | "edit"
  | "verify"
  | "about"
  | null;
const retentionOptions = [
  ["100", "Last 100 snapshots"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["smart", "Smart retention"],
  ["unlimited", "Unlimited"],
];
const kindLabel = (s: Snapshot) =>
  s.kind === "panic"
    ? "Panic save"
    : s.kind === "safety"
      ? "Safety checkpoint"
      : s.kind === "manual"
        ? "Manual checkpoint"
        : "Automatic snapshot";
function GameArt({
  game,
  small = false,
}: {
  game: Pick<Game, "name" | "steamAppId">;
  small?: boolean;
}) {
  const known = catalog.some((c) => c.steamAppId === game.steamAppId);
  return known ? (
    <img
      className={small ? "game-icon" : "game-cover"}
      src={`/covers/${game.steamAppId}.jpg`}
      alt={small ? "" : `${game.name} cover art`}
    />
  ) : (
    <div className={small ? "game-icon placeholder" : "game-cover placeholder"}>
      <Gamepad2 size={small ? 16 : 42} />
    </div>
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function ModalShell({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,button,select,textarea",
    );
    first?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,[tabindex="0"]',
          ) || [],
        );
        const a = els[0],
          b = els.at(-1);
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b?.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
      >
        <div className="modal-top">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [lib, setLib] = useState<Library | null>(null),
    [view, setView] = useState<View>("library"),
    [gameId, setGameId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [gameFilter, setGameFilter] = useState("all"),
    [snapFilter, setSnapFilter] = useState("all"),
    [grid, setGrid] = useState(true);
  const [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<string | null>(null),
    [compareIds, setCompareIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [steamId, setSteamId] = useState<string | null>(null),
    [label, setLabel] = useState(""),
    [notes, setNotes] = useState("");
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null),
    [changes, setChanges] = useState<FileChange[]>([]),
    [report, setReport] = useState<IntegrityReport | null>(null);
  const [checkpointGame, setCheckpointGame] = useState(""),
    [settingsTab, setSettingsTab] = useState("General");
  const [folderInfo, setFolderInfo] = useState<FolderInspection | null>(null);
  const [folderError, setFolderError] = useState("");
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [restoreResult, setRestoreResult] = useState<RestoreReport | null>(
    null,
  );
  const [restoreError, setRestoreError] = useState("");
  const [gameClosed, setGameClosed] = useState(false);
  useEffect(() => {
    trackView(view);
  }, [view]);
  useEffect(() => {
    if (modal !== "add" && modal !== "folder") return;
    setFolderInfo(null);
    setFolderError("");
    if (!path.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      request<FolderInspection>("inspectFolder", {
        path,
        gameId: modal === "folder" ? gameId : null,
      })
        .then((info) => {
          if (!cancelled) setFolderInfo(info);
        })
        .catch((e) => {
          if (!cancelled) setFolderError(String(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, modal, gameId]);
  useEffect(() => {
    if (modal !== "restore" || !selected) return;
    setRestorePreview(null);
    setRestoreResult(null);
    setRestoreError("");
    setGameClosed(false);
    let cancelled = false;
    request<RestorePreview>("previewRestore", { id: selected })
      .then((p) => {
        if (!cancelled) setRestorePreview(p);
      })
      .catch((e) => {
        if (!cancelled) setRestoreError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [modal, selected]);
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    setLib(await request<Library>("library"));
  }, []);
  const closeModal = useCallback(() => {
    setModal(null);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    if (!desktop) return;
    const listeners = [
      listen("library-changed", () => {
        refresh().catch((e) => setError(String(e)));
      }),
      listen<string>("engine-error", (e) => {
        setError(e.payload);
        refresh().catch(() => {});
      }),
    ];
    const interval = setInterval(
      () => refresh().catch((e) => setError(String(e))),
      30000,
    );
    return () => {
      clearInterval(interval);
      listeners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const act = useCallback(
    async (
      action: string,
      args: Record<string, unknown> = {},
      message = "",
    ) => {
      setBusy(true);
      setError("");
      try {
        const result = await request(action, args);
        await refresh();
        if (message) setToast(message);
        return result;
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  const run = (
    action: string,
    args: Record<string, unknown> = {},
    message = "",
  ) => {
    void act(action, args, message).catch(() => {});
  };
  const panic = useCallback(() => {
    void act(
      "capture",
      { gameId: null, kind: "panic", label: "" },
      desktop
        ? "Bad idea detected. Evidence preserved."
        : "Demo panic checkpoint created. No real files changed.",
    ).catch(() => {});
  }, [act]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setView("settings");
        setGameId(null);
        setSearch("");
      }
      if (!desktop && e.ctrlKey && e.shiftKey && e.key === "F12") {
        e.preventDefault();
        panic();
      }
      if (!desktop && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setCheckpointGame(gameId || lib?.games[0]?.id || "");
        setLabel("");
        setModal("checkpoint");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [gameId, lib, panic]);
  const navigate = (v: View, id: string | null = null) => {
    setView(v);
    setGameId(id);
    setSearch("");
    setSelected(null);
    setCompareIds([]);
    setSnapFilter("all");
  };
  const openAdd = () => {
    setName("");
    setPath("");
    setSteamId(null);
    setDiscovered(null);
    setModal("add");
  };
  const openCheckpoint = () => {
    setCheckpointGame(
      gameId ||
        lib?.games.find((g) => g.running)?.id ||
        lib?.games[0]?.id ||
        "",
    );
    setLabel("");
    setModal("checkpoint");
  };
  const chooseFolder = async () => {
    if (!desktop) {
      setPath("~/Games/MyGame/Saves");
      return;
    }
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Choose game save folder",
      });
      if (typeof result === "string") setPath(result);
    } catch (e) {
      setError(String(e));
    }
  };
  const doExport = async (snapshot?: Snapshot) => {
    if (!desktop) {
      setToast("Portable archives are available in the desktop app.");
      return;
    }
    try {
      const id = snapshot?.gameId || gameId;
      if (!id) return;
      const dest = await save({
        defaultPath: `${lib?.games.find((g) => g.id === id)?.name || "save"}-${snapshot ? "snapshot" : "history"}.savescum`,
        filters: [{ name: "Save Scum archive", extensions: ["savescum"] }],
      });
      if (dest)
        await act(
          "export",
          { gameId: id, snapshotId: snapshot?.id || null, path: dest },
          "Portable archive exported.",
        );
    } catch (e) {
      setError(String(e));
    }
  };
  const doImport = async () => {
    if (!desktop) {
      setToast("Install the desktop app to import .savescum archives.");
      return;
    }
    try {
      const source = await open({
        multiple: false,
        filters: [{ name: "Save Scum archive", extensions: ["savescum"] }],
      });
      if (typeof source !== "string") return;
      const target = await open({
        directory: true,
        multiple: false,
        title:
          "Choose a save folder for imported history (files will not change)",
      });
      if (typeof target !== "string") return;
      await act(
        "import",
        { path: source, target },
        "History imported. Monitoring is paused; choose a snapshot to restore.",
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const verify = async () => {
    setReport(null);
    setModal("verify");
    try {
      setReport((await act("verify")) as IntegrityReport);
    } catch {
      /* shown in alert */
    }
  };
  const updateSettings = (patch: Partial<Settings>) => {
    if (lib)
      run(
        "saveSettings",
        { settings: { ...lib.settings, ...patch } },
        "Settings saved.",
      );
  };
  if (!lib)
    return (
      <div className="loading-screen">
        <img src="/mark.svg" width="52" />
        <h2>Save Scum</h2>
        {error ? (
          <>
            <p className="error-text">{error}</p>
            <button
              className="button"
              onClick={() => refresh().catch((e) => setError(String(e)))}
            >
              Try again
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  const activeGame = lib.games.find((g) => g.id === gameId);
  const current = lib.snapshots.find((s) => s.id === selected);
  const watching = lib.games.filter((g) => g.watching).length,
    healthErrors = lib.games.filter((g) => g.error).length;
  const totalLogical = lib.snapshots.reduce((sum, s) => sum + s.size, 0),
    saved = Math.max(0, totalLogical - lib.storageBytes);
  const protectedCount = lib.games.filter(
    (g) =>
      g.watching &&
      !g.error &&
      lib.snapshots.some(
        (s) =>
          s.gameId === g.id &&
          s.files.length > 0 &&
          (!s.sourcePath || s.sourcePath === g.path),
      ),
  ).length;
  const activityBuckets = Array.from(
    { length: 12 },
    (_, i) =>
      lib.snapshots.filter((s) => {
        const age = (Date.now() - new Date(s.createdAt).getTime()) / 3600000;
        return age >= 11 - i && age < 12 - i;
      }).length,
  );
  const filteredGames = lib.games.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) &&
      (gameFilter === "all" ||
        (gameFilter === "watching" && g.watching) ||
        (gameFilter === "paused" && !g.watching)),
  );
  const filteredSnaps = lib.snapshots.filter(
    (s) =>
      (!gameId || s.gameId === gameId) &&
      (view !== "favorites" || s.favorite || s.protected) &&
      (snapFilter === "all" ||
        (snapFilter === "favorites" && s.favorite) ||
        s.kind === snapFilter) &&
      `${s.label} ${s.notes} ${date(s.createdAt)} ${s.createdAt} ${lib.games.find((g) => g.id === s.gameId)?.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectedGame = current
    ? lib.games.find((g) => g.id === current.gameId)
    : activeGame;
  const title =
    view === "library"
      ? "Game library"
      : view === "favorites"
        ? "Saved checkpoints"
        : view === "storage"
          ? "Storage & integrity"
          : view === "settings"
            ? "Settings"
            : activeGame?.name || "All snapshots";
  const status = (g: Game) =>
    g.error
      ? "Needs attention"
      : !g.watching
        ? "Paused"
        : g.lastActivity &&
            Date.now() - new Date(g.lastActivity).getTime() > 3 * 86400000
          ? "No recent activity"
          : "Watching";
  const snapIcon = (s: Snapshot) =>
    s.kind === "panic" ? (
      <Zap size={15} />
    ) : s.kind === "safety" ? (
      <ShieldCheck size={15} />
    ) : s.kind === "manual" ? (
      <FlagIcon />
    ) : (
      <History size={15} />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("library")}
          aria-label="Save Scum home"
        >
          <img src="/mark.svg" alt="" />
          <span>
            SAVE SCUM
            <span className="brand-caption">A second chance. On demand.</span>
          </span>
        </button>
        <div className="workspace-label">
          YOUR WORKSPACE <span>LOCAL</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => navigate("library")}
          >
            <LayoutGrid size={17} />
            Game library<span className="nav-count">{lib.games.length}</span>
          </button>
          <button
            className={view === "timeline" && !gameId ? "active" : ""}
            onClick={() => navigate("timeline")}
          >
            <History size={17} />
            All snapshots
          </button>
          <button
            className={view === "favorites" ? "active" : ""}
            onClick={() => navigate("favorites")}
          >
            <Star size={17} />
            Saved checkpoints
          </button>
          <button
            className={view === "storage" ? "active" : ""}
            onClick={() => navigate("storage")}
          >
            <HardDrive size={17} />
            Storage & integrity
          </button>
        </nav>
        <div className="sidebar-section-title">
          MONITORED GAMES
          <button
            className="icon-button"
            onClick={openAdd}
            aria-label="Add monitored game"
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="game-nav" aria-label="Monitored games">
          {lib.games.map((g) => (
            <button
              key={g.id}
              className={gameId === g.id ? "active" : ""}
              onClick={() => navigate("timeline", g.id)}
            >
              <GameArt game={g} small />
              <span>{g.name}</span>
              <i
                className={`status-dot ${g.error ? "red" : g.watching ? "" : "muted"}`}
              />
            </button>
          ))}
          {!lib.games.length && (
            <p className="sidebar-empty">Your next adventure goes here.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-storage">
            <div>
              <HardDrive size={15} />
              <span>Local storage</span>
              <b>{bytes(lib.storageBytes)}</b>
            </div>
            <div
              className="storage-meter"
              title={
                lib.settings.storageLimitGb
                  ? `${bytes(lib.storageBytes)} of ${lib.settings.storageLimitGb} GB limit`
                  : `${bytes(lib.storageBytes)} stored for ${bytes(totalLogical)} of snapshot data`
              }
            >
              <span
                style={{
                  width: `${lib.settings.storageLimitGb ? Math.min(100, (lib.storageBytes / (lib.settings.storageLimitGb * 1073741824)) * 100) : (lib.storageBytes / Math.max(totalLogical, lib.storageBytes, 1)) * 100}%`,
                }}
              />
            </div>
            <p>
              <span className="status-dot" />
              Everything stays on this device
            </p>
          </div>
          <button
            className={`sidebar-settings ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            Settings<span>⌘ ,</span>
          </button>
          <button className="version" onClick={() => setModal("about")}>
            <span className="mini-mark">S</span>Save Scum{" "}
            <span>
              v0.1.0 <ArrowUpRight />
            </span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="Search games and snapshots"
                placeholder={
                  view === "library"
                    ? "Search your games..."
                    : "Search snapshots..."
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="topbar-divider" />
            <button
              className="icon-button"
              onClick={() => setModal("about")}
              aria-label="About Save Scum"
            >
              <Info size={18} />
            </button>
          </div>
        </header>
        <main>
          {!desktop && (
            <div className="demo-notice">
              <Monitor size={12} />
              <span>INTERACTIVE DEMO</span>
              <span>Sample saves. Real second-chance energy.</span>
              <button onClick={() => setModal("about")}>
                About the desktop app <ArrowRight size={12} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {lib.warnings?.map((warning) => (
            <div className="error-banner" role="alert" key={warning}>
              <TriangleAlert size={16} />
              <span>{warning}</span>
            </div>
          ))}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "library"
                  ? "YOUR PERSONAL RESET BUTTON"
                  : view === "timeline"
                    ? "EVERY SAVE TELLS A STORY"
                    : view === "favorites"
                      ? "THE ONES WORTH KEEPING"
                      : view === "storage"
                        ? "LOCAL. EFFICIENT. YOURS."
                        : "MAKE YOURSELF AT HOME"}
              </div>
              <h1>
                {view === "library" ? (
                  <>
                    Your games.{" "}
                    <span>
                      {healthErrors ? "Needs attention." : "Protected."}
                    </span>
                  </>
                ) : (
                  title
                )}
              </h1>
              <p>
                {view === "library"
                  ? "Go on. Make the questionable decision. We’ve got your saves."
                  : view === "timeline"
                    ? "A little history. A lot of possibilities."
                    : view === "favorites"
                      ? "Favorite and protected checkpoints, always within reach."
                      : view === "storage"
                        ? "Small footprint. Long memory. No cloud required."
                        : "Quietly working in the background, just the way you like it."}
              </p>
            </div>
            <div className="heading-actions">
              {view === "library" ? (
                <button className="button primary" onClick={openAdd}>
                  <Plus size={17} />
                  Add game
                </button>
              ) : view === "timeline" || view === "favorites" ? (
                <>
                  <button
                    className="button"
                    onClick={openCheckpoint}
                    disabled={!lib.games.length}
                  >
                    <Plus size={16} />
                    Create checkpoint
                  </button>
                  {activeGame && (
                    <button
                      className="icon-button bordered"
                      onClick={() => void doExport()}
                      title="Export game history"
                      aria-label="Export game history"
                    >
                      <ArrowDownToLine size={18} />
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>

          {view === "library" && (
            <>
              <section className="stats-row" aria-label="Library statistics">
                <div className="stat">
                  <div className="stat-label">
                    <ShieldCheck size={15} />
                    Games protected
                  </div>
                  <div className="stat-number">
                    {protectedCount.toString().padStart(2, "0")}
                    <span className="stat-pill">
                      <span className="status-dot" />{" "}
                      {healthErrors ? "Needs attention" : "All systems go"}
                    </span>
                  </div>
                  <p>
                    {lib.games.length - watching
                      ? `${lib.games.length - watching} game paused`
                      : "Ready when you are"}
                  </p>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    <History size={15} />
                    Total snapshots
                  </div>
                  <div className="stat-number">
                    {lib.snapshots.length.toLocaleString()}
                    <span
                      className="sparkline"
                      title="Snapshots per hour over the last 12 hours"
                    >
                      {activityBuckets.map((count, i) => (
                        <i
                          key={i}
                          style={{
                            height: Math.max(
                              3,
                              (count / Math.max(...activityBuckets, 1)) * 24,
                            ),
                          }}
                        />
                      ))}
                    </span>
                  </div>
                  <p>Second chances, safely tucked away</p>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    <Database size={15} />
                    Storage used
                  </div>
                  <div className="stat-number">
                    {bytes(lib.storageBytes).split(" ")[0]}
                    <small>{bytes(lib.storageBytes).split(" ")[1]}</small>
                  </div>
                  <p>Compressed & stored locally</p>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    <Sparkles size={15} />
                    Space saved
                  </div>
                  <div className="stat-number accent">
                    {bytes(saved).split(" ")[0]}
                    <small>{bytes(saved).split(" ")[1]}</small>
                    <span className="saving-arrow">↗</span>
                  </div>
                  <p>Same file? We only keep it once.</p>
                </div>
              </section>
              <div className="library-toolbar">
                <div className="section-tabs">
                  <button
                    className={gameFilter === "all" ? "selected" : ""}
                    onClick={() => setGameFilter("all")}
                  >
                    All games <span>{lib.games.length}</span>
                  </button>
                  <button
                    className={gameFilter === "watching" ? "selected" : ""}
                    onClick={() => setGameFilter("watching")}
                  >
                    Watching <span>{watching}</span>
                  </button>
                  <button
                    className={gameFilter === "paused" ? "selected" : ""}
                    onClick={() => setGameFilter("paused")}
                  >
                    Paused <span>{lib.games.length - watching}</span>
                  </button>
                </div>
                <div className="view-controls">
                  <span>Recently active</span>
                  <div className="segmented">
                    <button
                      className={grid ? "selected" : ""}
                      aria-label="Grid view"
                      onClick={() => setGrid(true)}
                    >
                      <LayoutGrid size={15} />
                    </button>
                    <button
                      className={!grid ? "selected" : ""}
                      aria-label="List view"
                      onClick={() => setGrid(false)}
                    >
                      <List size={16} />
                    </button>
                  </div>
                </div>
              </div>
              {lib.games.length === 0 ? (
                <div className="onboarding">
                  <div className="empty-icon">
                    <ShieldCheck size={38} />
                  </div>
                  <div className="eyebrow">WELCOME TO SAVE SCUM</div>
                  <h2>
                    Games overwrite saves.
                    <br />
                    <span>Save Scum doesn’t.</span>
                  </h2>
                  <p>
                    Add a game before you do something regrettable.
                    <br />
                    Your first second chance is less than a minute away.
                  </p>
                  <button className="button primary" onClick={openAdd}>
                    <Plus size={16} />
                    Protect my first game
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void doImport()}
                  >
                    <Upload size={14} />
                    Import an existing library
                  </button>
                </div>
              ) : filteredGames.length === 0 ? (
                <div className="empty">
                  <Search size={30} />
                  <h3>No games found</h3>
                  <p>Try another name or change your filter.</p>
                </div>
              ) : (
                <div className={`game-grid ${!grid ? "list-view" : ""}`}>
                  {filteredGames
                    .sort((a, b) =>
                      (b.lastActivity || "").localeCompare(
                        a.lastActivity || "",
                      ),
                    )
                    .map((g) => {
                      const snaps = lib.snapshots.filter(
                          (s) => s.gameId === g.id,
                        ),
                        unique = new Map(
                          snaps.flatMap((s) =>
                            s.files.map((f) => [f.hash, f.size] as const),
                          ),
                        );
                      const gameBytes = [...unique.values()].reduce(
                        (a, b) => a + b,
                        0,
                      );
                      return (
                        <article
                          className={`game-card ${!g.watching ? "paused" : ""}`}
                          key={g.id}
                        >
                          <button
                            className="card-main"
                            onClick={() => navigate("timeline", g.id)}
                            aria-label={`Open ${g.name} history`}
                          >
                            <div className="cover-wrap">
                              <GameArt game={g} />
                              <div className="cover-shade" />
                              {g.running && (
                                <span className="running-badge">
                                  <span className="status-dot" />
                                  IN GAME
                                </span>
                              )}
                              <span className="cover-genre">
                                {catalog.find(
                                  (c) => c.steamAppId === g.steamAppId,
                                )?.genre || "YOUR NEXT ADVENTURE"}
                              </span>
                              <div className="cover-title">{g.name}</div>
                              <div className="cover-open">
                                <ArrowRight size={17} />
                              </div>
                            </div>
                            <div className="card-body">
                              <div className="last-snapshot">
                                <Clock3 size={13} />
                                <span>
                                  Last snapshot{" "}
                                  <strong>
                                    {relative(snaps[0]?.createdAt || null)}
                                  </strong>
                                </span>
                              </div>
                              <div className="card-metrics">
                                <span>
                                  <History size={14} />
                                  <b>{snaps.length}</b> snapshots
                                </span>
                                <span>
                                  <HardDrive size={13} />
                                  {bytes(gameBytes)}
                                </span>
                              </div>
                              <div className="card-path" title={g.path}>
                                <Folder size={12} />
                                <span>{g.path}</span>
                              </div>
                            </div>
                          </button>
                          <div className="card-footer">
                            <span
                              className={`watch-status ${g.error ? "error-text" : !g.watching ? "muted" : ""}`}
                            >
                              <span
                                className={`status-dot ${g.error ? "red" : !g.watching ? "muted" : ""}`}
                              />
                              {status(g)}
                            </span>
                            <button
                              className="card-pause"
                              title={
                                g.watching
                                  ? "Pause monitoring"
                                  : "Resume monitoring"
                              }
                              aria-label={`${g.watching ? "Pause" : "Resume"} ${g.name} monitoring`}
                              onClick={() =>
                                run(
                                  "monitoring",
                                  { gameId: g.id, watching: !g.watching },
                                  g.watching
                                    ? "Monitoring paused. Existing saves are safe."
                                    : "Monitoring resumed.",
                                )
                              }
                            >
                              {g.watching ? (
                                <Pause size={13} />
                              ) : (
                                <Play size={13} />
                              )}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              )}
              <div className="panic-banner">
                <div className="panic-icon">
                  <Zap size={20} />
                </div>
                <div>
                  <h3>About to do something irreversible?</h3>
                  <p>
                    Make it reversible. Capture your current save in one click.
                  </p>
                </div>
                <div className="panic-shortcut">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>F12</kbd>
                </div>
                <button
                  className="button danger"
                  disabled={busy || !lib.games.length}
                  onClick={panic}
                >
                  <Zap size={15} />
                  Panic save
                </button>
              </div>
              <section className="recent-section">
                <div className="section-heading">
                  <h2>
                    Recent activity <span className="live-dot" />
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("timeline")}
                  >
                    View all snapshots <ArrowRight size={14} />
                  </button>
                </div>
                <div className="activity-table">
                  {lib.snapshots.slice(0, 4).map((s) => {
                    const g = lib.games.find((g) => g.id === s.gameId)!;
                    return (
                      <button
                        key={s.id}
                        className="activity-row"
                        onClick={() => {
                          navigate("timeline", g.id);
                          setSelected(s.id);
                        }}
                      >
                        <span className={`snapshot-type ${s.kind}`}>
                          {snapIcon(s)}
                        </span>
                        <div className="activity-description">
                          <strong>{s.label || kindLabel(s)}</strong>
                          <span>{g?.name}</span>
                        </div>
                        <span className="activity-files">
                          {s.changed} files changed
                        </span>
                        <span className="mono">{bytes(s.size)}</span>
                        <span>{relative(s.createdAt)}</span>
                        <ChevronRight size={15} />
                      </button>
                    );
                  })}
                  {!lib.snapshots.length && (
                    <p className="muted">
                      Your first snapshot will appear here.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}

          {(view === "timeline" || view === "favorites") && (
            <>
              {activeGame?.error && (
                <div className="error-banner" role="alert">
                  <TriangleAlert size={16} />
                  <span>{activeGame.error}</span>
                  <button
                    className="button small"
                    onClick={() => {
                      setPath(activeGame.path);
                      setModal("folder");
                    }}
                  >
                    Fix save folder
                  </button>
                </div>
              )}
              {activeGame && (
                <div className="game-detail-bar">
                  <GameArt game={activeGame} small />
                  <div>
                    <span className="mono">Save files: {activeGame.path}</span>
                    <button
                      className="button small"
                      onClick={() => {
                        setPath(activeGame.path);
                        setModal("folder");
                      }}
                    >
                      Change save folder
                    </button>
                    <span className="detail-health">
                      <span
                        className={`status-dot ${!activeGame.watching ? "muted" : ""}`}
                      />
                      {status(activeGame)}
                      {activeGame.running && " · Game is running"}
                    </span>
                  </div>
                  <button
                    className="button small"
                    onClick={() =>
                      run("monitoring", {
                        gameId: activeGame.id,
                        watching: !activeGame.watching,
                      })
                    }
                  >
                    {activeGame.watching ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}{" "}
                    {activeGame.watching ? "Pause" : "Resume"}
                  </button>
                  <select
                    aria-label="Game retention policy"
                    value={activeGame.retention}
                    onChange={(e) =>
                      run(
                        "retention",
                        { gameId: activeGame.id, policy: e.target.value },
                        "Retention updated. Labeled and protected checkpoints are kept.",
                      )
                    }
                  >
                    {retentionOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="timeline-toolbar">
                <div className="filter-chips">
                  {[
                    ["all", "All snapshots"],
                    ["automatic", "Automatic"],
                    ["manual", "Manual"],
                    ["panic", "Panic saves"],
                    ["favorites", "Favorites"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={snapFilter === id ? "selected" : ""}
                      onClick={() => setSnapFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="button small"
                  disabled={compareIds.length !== 2 || busy}
                  onClick={async () => {
                    try {
                      setChanges(
                        (await act("compare", {
                          before: compareIds[1],
                          after: compareIds[0],
                        })) as FileChange[],
                      );
                      setModal("compare");
                    } catch {
                      /* global alert */
                    }
                  }}
                >
                  <GitBranch size={14} />
                  Compare {compareIds.length > 0 && `(${compareIds.length}/2)`}
                </button>
              </div>
              <div className={`history-layout ${current ? "with-detail" : ""}`}>
                <section className="timeline">
                  {filteredSnaps.map((s, i) => {
                    const prior = filteredSnaps[i - 1],
                      newDay =
                        !prior ||
                        new Date(prior.createdAt).toDateString() !==
                          new Date(s.createdAt).toDateString();
                    const sessionStart =
                      newDay ||
                      new Date(prior.createdAt).getTime() -
                        new Date(s.createdAt).getTime() >
                        90 * 60000;
                    let sessionEnd = i;
                    if (sessionStart) {
                      while (sessionEnd + 1 < filteredSnaps.length) {
                        const a = filteredSnaps[sessionEnd],
                          b = filteredSnaps[sessionEnd + 1];
                        if (
                          new Date(a.createdAt).toDateString() !==
                            new Date(b.createdAt).toDateString() ||
                          new Date(a.createdAt).getTime() -
                            new Date(b.createdAt).getTime() >
                            90 * 60000
                        )
                          break;
                        sessionEnd++;
                      }
                    }
                    const g = lib.games.find((g) => g.id === s.gameId);
                    return (
                      <div key={s.id}>
                        {newDay && (
                          <h3 className="timeline-day">
                            {new Date(s.createdAt).toDateString() ===
                            new Date().toDateString()
                              ? "Today"
                              : new Date(s.createdAt).toLocaleDateString(
                                  undefined,
                                  {
                                    weekday: "long",
                                    month: "short",
                                    day: "numeric",
                                  },
                                )}
                            <span>{new Date(s.createdAt).getFullYear()}</span>
                          </h3>
                        )}
                        {sessionStart && (
                          <div className="session-label">
                            <Gamepad2 size={13} />
                            SESSION ·{" "}
                            {new Date(
                              filteredSnaps[sessionEnd].createdAt,
                            ).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}{" "}
                            →{" "}
                            {new Date(s.createdAt).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" },
                            )}
                            {" · "}
                            {sessionEnd - i + 1} snapshots
                            <span />
                          </div>
                        )}
                        <div
                          className={`timeline-item ${selected === s.id ? "selected" : ""}`}
                        >
                          <div className="timeline-time">
                            {new Date(s.createdAt).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" },
                            )}
                            <span>{relative(s.createdAt)}</span>
                          </div>
                          <span className={`timeline-node ${s.kind}`}>
                            {snapIcon(s)}
                          </span>
                          <button
                            className="timeline-card"
                            onClick={() => setSelected(s.id)}
                          >
                            <div className="timeline-card-top">
                              <strong>{s.label || kindLabel(s)}</strong>
                              <span>
                                {s.favorite && (
                                  <Star
                                    size={13}
                                    className="accent"
                                    fill="currentColor"
                                  />
                                )}
                                {s.protected && <LockKeyhole size={13} />}
                              </span>
                            </div>
                            <div className="timeline-meta">
                              {!activeGame && <span>{g?.name} · </span>}
                              {s.label && <span>{kindLabel(s)} · </span>}
                              {s.changed} files changed <span>·</span>{" "}
                              {bytes(s.size)}
                            </div>
                            {s.notes && <p>{s.notes}</p>}
                          </button>
                          <input
                            className="compare-checkbox"
                            type="checkbox"
                            aria-label={`Select ${s.label || date(s.createdAt)} for comparison`}
                            title="Select to compare"
                            checked={compareIds.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                const first = lib.snapshots.find(
                                  (x) => x.id === compareIds[0],
                                );
                                if (first && first.gameId !== s.gameId) {
                                  setToast(
                                    "Compare two snapshots from the same game.",
                                  );
                                  return;
                                }
                                setCompareIds((ids) => [
                                  ...ids.slice(-1),
                                  s.id,
                                ]);
                              } else
                                setCompareIds((ids) =>
                                  ids.filter((id) => id !== s.id),
                                );
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {!filteredSnaps.length && (
                    <div className="empty">
                      <History size={30} />
                      <h3>No snapshots here yet</h3>
                      <p>
                        {view === "favorites"
                          ? "Favorite a snapshot or protect a checkpoint to keep it here."
                          : "Create a checkpoint, or wait for your next save."}
                      </p>
                      <button
                        className="button"
                        onClick={openCheckpoint}
                        disabled={!lib.games.length}
                      >
                        <Plus size={15} />
                        Create checkpoint
                      </button>
                    </div>
                  )}
                </section>
                {current && (
                  <aside className="snapshot-inspector">
                    <div className="inspector-top">
                      <span className="eyebrow">SNAPSHOT DETAILS</span>
                      <button
                        className="icon-button"
                        onClick={() => setSelected(null)}
                        aria-label="Close snapshot details"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <span className={`snapshot-type large ${current.kind}`}>
                      {snapIcon(current)}
                    </span>
                    <h2>{current.label || kindLabel(current)}</h2>
                    <p>{date(current.createdAt)}</p>
                    <p className="safe-hint">
                      <ShieldCheck size={14} />
                      Your current progress is backed up before every restore.
                    </p>
                    <button
                      className="button primary full"
                      disabled={busy}
                      onClick={() => setModal("restore")}
                    >
                      <RotateCcw size={15} />
                      Restore this save
                    </button>
                    <div className="inspector-actions">
                      <button
                        className={`button small ${current.favorite ? "accent" : ""}`}
                        aria-label="Toggle favorite"
                        onClick={() =>
                          run("patchSnapshot", {
                            ...current,
                            favorite: !current.favorite,
                          })
                        }
                      >
                        <Star
                          size={14}
                          fill={current.favorite ? "currentColor" : "none"}
                        />
                        {current.favorite ? "Favorited" : "Favorite"}
                      </button>
                      <button
                        className={`button small ${current.protected ? "accent" : ""}`}
                        onClick={() =>
                          run("patchSnapshot", {
                            ...current,
                            protected: !current.protected,
                          })
                        }
                      >
                        <LockKeyhole size={14} />
                        {current.protected ? "Protected" : "Protect"}
                      </button>
                    </div>
                    <div className="inspector-divider" />
                    <div className="inspector-label">
                      NOTES{" "}
                      <button
                        className="text-button"
                        onClick={() => {
                          setLabel(current.label);
                          setNotes(current.notes);
                          setModal("edit");
                        }}
                      >
                        Edit details
                      </button>
                    </div>
                    <p className="snapshot-notes">
                      {current.notes ||
                        "A little context for future you. Add a label or a note to this snapshot."}
                    </p>
                    <div className="inspector-label">
                      FILES <span>{current.files.length}</span>
                    </div>
                    <div className="file-list">
                      {current.files.map((f) => (
                        <div key={f.path}>
                          <File size={14} />
                          <span className="mono" title={`${f.path}\n${f.hash}`}>
                            {f.path}
                          </span>
                          <span>{bytes(f.size)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="inspector-total">
                      <span>Total snapshot size</span>
                      <strong>{bytes(current.size)}</strong>
                    </div>
                    <button
                      className="button full"
                      onClick={() => void doExport(current)}
                    >
                      <ArrowDownToLine size={15} />
                      Export snapshot
                    </button>
                    <div className="snapshot-hash mono">
                      ID {current.id.slice(0, 18)}
                    </div>
                  </aside>
                )}
              </div>
            </>
          )}

          {view === "storage" && (
            <div className="storage-page">
              <section className="panel storage-overview">
                <div className="section-heading">
                  <h2>
                    <HardDrive size={18} />
                    Your snapshot vault
                  </h2>
                  <span className="badge">
                    <span className="status-dot" />
                    Local only
                  </span>
                </div>
                <div className="storage-big">
                  {bytes(lib.storageBytes)}
                  <span>on disk</span>
                </div>
                <div className="storage-visual">
                  {lib.games.map((g, i) => (
                    <span
                      key={g.id}
                      title={g.name}
                      style={{
                        background: catalog[i % catalog.length].color,
                        flex:
                          lib.snapshots
                            .filter((s) => s.gameId === g.id)
                            .reduce((a, s) => a + s.size, 0) || 1,
                      }}
                    />
                  ))}
                </div>
                <div className="storage-legend">
                  {lib.games.map((g, i) => (
                    <span key={g.id}>
                      <i
                        style={{
                          background: catalog[i % catalog.length].color,
                        }}
                      />
                      {g.name}
                    </span>
                  ))}
                </div>
                <div className="storage-saving">
                  <Sparkles size={20} />
                  <div>
                    <strong>{bytes(saved)} you didn’t have to store.</strong>
                    <p>
                      Content deduplication and Zstandard compression do the
                      heavy lifting.
                    </p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>Snapshot storage directory</strong>
                    <p className="mono">{lib.storagePath}</p>
                  </div>
                  <Folder size={18} />
                </div>
                <p className="small-print">
                  Per-game storage is logical unique-file size. On-disk storage
                  includes compression. Recovery directories beside your saves
                  are kept separately after restores.
                </p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    <ShieldCheck size={18} />
                    Trust, but verify.
                  </h2>
                </div>
                <p>
                  Check every stored file against its content hash. Missing,
                  corrupt, and orphaned blobs are reported. Questionable data is
                  never automatically deleted.
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void verify()}
                >
                  <ShieldCheck size={16} />
                  Verify snapshot library
                </button>
              </section>
              <section className="panel">
                <h2>Take your second chances with you.</h2>
                <p>
                  Portable .savescum archives include game history and verified
                  file blobs. Importing never overwrites your live saves.
                </p>
                <div className="inline-actions">
                  <button className="button" onClick={() => void doImport()}>
                    <Upload size={15} />
                    Import archive
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      navigate("timeline", lib.games[0]?.id || null)
                    }
                  >
                    <Archive size={15} />
                    Choose a game to export
                  </button>
                </div>
              </section>
            </div>
          )}

          {view === "settings" && (
            <div className="settings-layout">
              <nav className="settings-nav">
                {["General", "Storage", "Snapshots", "Hotkeys", "Advanced"].map(
                  (t) => (
                    <button
                      className={settingsTab === t ? "selected" : ""}
                      key={t}
                      onClick={() => setSettingsTab(t)}
                    >
                      {t}
                      <ChevronRight size={14} />
                    </button>
                  ),
                )}
              </nav>
              <section className="panel settings-panel">
                <h2>{settingsTab}</h2>
                {settingsTab === "General" && (
                  <>
                    {[
                      [
                        "launchAtStartup",
                        "Launch at startup",
                        "A little protection, every time you log in.",
                      ],
                      [
                        "minimizeToTray",
                        "Keep running in the system tray",
                        "Closing the window keeps your saves protected.",
                      ],
                      [
                        "notifications",
                        "Snapshot notifications",
                        "A quiet heads-up when a checkpoint is created.",
                      ],
                      [
                        "panicNotifications",
                        "Panic save notifications",
                        "Know your emergency checkpoint made it safely.",
                      ],
                    ].map(([key, title, description]) => (
                      <div className="settings-row" key={key}>
                        <div>
                          <strong>{title}</strong>
                          <p>{description}</p>
                        </div>
                        <Toggle
                          label={title}
                          checked={
                            lib.settings[key as keyof Settings] as boolean
                          }
                          onChange={(v) => updateSettings({ [key]: v })}
                        />
                      </div>
                    ))}
                    <div className="settings-row">
                      <div>
                        <strong>Panic save target</strong>
                        <p>
                          Choose a game, or follow your most recent activity.
                        </p>
                      </div>
                      <select
                        aria-label="Panic save target"
                        value={lib.settings.panicGameId || ""}
                        onChange={(e) =>
                          updateSettings({
                            panicGameId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">Most recently active</option>
                        {lib.games.map((g) => (
                          <option value={g.id} key={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {settingsTab === "Storage" && (
                  <>
                    <div className="settings-row">
                      <div>
                        <strong>Storage directory</strong>
                        <p className="mono">{lib.storagePath}</p>
                        <p>
                          Set SAVE_SCUM_DATA_DIR before launch to use another
                          location.
                        </p>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Compression level</strong>
                        <p>Higher compression uses more CPU during capture.</p>
                      </div>
                      <select
                        value={lib.settings.compressionLevel}
                        aria-label="Compression level"
                        onChange={(e) =>
                          updateSettings({
                            compressionLevel: Number(e.target.value),
                          })
                        }
                      >
                        {[1, 3, 6, 9, 15, 19].map((n) => (
                          <option value={n} key={n}>
                            {n}
                            {n === 3 ? " · Recommended" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Storage limit</strong>
                        <p>Stops new snapshots when the limit is reached.</p>
                      </div>
                      <select
                        value={lib.settings.storageLimitGb}
                        aria-label="Storage limit"
                        onChange={(e) =>
                          updateSettings({
                            storageLimitGb: Number(e.target.value),
                          })
                        }
                      >
                        {[0, 5, 10, 25, 50, 100].map((n) => (
                          <option key={n} value={n}>
                            {n ? `${n} GB` : "Unlimited"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("storage")}
                    >
                      View storage & integrity <ArrowRight size={14} />
                    </button>
                  </>
                )}
                {settingsTab === "Snapshots" && (
                  <>
                    <div className="settings-row">
                      <div>
                        <strong>Default retention policy</strong>
                        <p>
                          Applies to newly added games. Labeled checkpoints are
                          kept.
                        </p>
                      </div>
                      <select
                        aria-label="Default retention"
                        value={lib.settings.defaultRetention}
                        onChange={(e) =>
                          updateSettings({ defaultRetention: e.target.value })
                        }
                      >
                        {retentionOptions.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Wait for writes to settle</strong>
                        <p>Group a burst of save changes into one snapshot.</p>
                      </div>
                      <select
                        aria-label="Debounce interval"
                        value={lib.settings.debounceMs}
                        onChange={(e) =>
                          updateSettings({ debounceMs: Number(e.target.value) })
                        }
                      >
                        {[500, 1000, 2000, 5000, 10000, 30000].map((n) => (
                          <option key={n} value={n}>
                            {n / 1000} seconds
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Ignore temporary files</strong>
                        <p>
                          Skip .tmp, .temp, .swp, .lock, .part and editor
                          backups.
                        </p>
                      </div>
                      <Toggle
                        label="Ignore temporary files"
                        checked={lib.settings.ignoreTemporary}
                        onChange={(v) => updateSettings({ ignoreTemporary: v })}
                      />
                    </div>
                    <div className="notice">
                      <Info size={16} />
                      <span>
                        Smart retention keeps every snapshot for 24 hours,
                        hourly snapshots for 7 days, and daily snapshots for 30
                        days. Manual and protected checkpoints stay.
                      </span>
                    </div>
                  </>
                )}
                {settingsTab === "Hotkeys" && (
                  <>
                    {[
                      ["Create checkpoint", "S"],
                      ["Panic save", "F12"],
                      ["Open Save Scum", "Space"],
                    ].map(([l, key]) => (
                      <div className="settings-row" key={l}>
                        <div>
                          <strong>{l}</strong>
                          <p>
                            Available globally while the desktop app is running.
                          </p>
                        </div>
                        <div className="hotkey">
                          <kbd>Ctrl</kbd>
                          <kbd>Shift</kbd>
                          <kbd>{key}</kbd>
                        </div>
                      </div>
                    ))}
                    <p className="small-print">
                      These shortcuts are fixed in this version. Your operating
                      system may reserve some combinations.
                    </p>
                  </>
                )}
                {settingsTab === "Advanced" && (
                  <>
                    <div className="settings-row">
                      <div>
                        <strong>Verify snapshot library</strong>
                        <p>
                          Check stored blob hashes against snapshot metadata.
                        </p>
                      </div>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => void verify()}
                      >
                        Verify now
                      </button>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Database location</strong>
                        <p className="mono">
                          {lib.storagePath}/library.sqlite3
                        </p>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Export diagnostics</strong>
                        <p>
                          Version, platform, storage totals and integrity
                          results. No save contents.
                        </p>
                      </div>
                      <button
                        className="button small"
                        onClick={async () => {
                          if (!desktop) {
                            setToast(
                              "Diagnostics export is available in the desktop app.",
                            );
                            return;
                          }
                          try {
                            const path = await save({
                              defaultPath: "save-scum-diagnostics.json",
                            });
                            if (path)
                              await act(
                                "diagnostics",
                                { path },
                                "Diagnostics exported.",
                              );
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        <ArrowDownToLine size={14} />
                        Export
                      </button>
                    </div>
                    <div className="settings-row">
                      <div>
                        <strong>Logging</strong>
                        <p>
                          Filesystem and notification failures are reported to
                          stderr and in the app.
                        </p>
                      </div>
                      <Terminal size={18} />
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              {healthErrors
                ? `${healthErrors} game needs attention`
                : watching
                  ? "Your bad decisions are reversible."
                  : "Your history stays safe while monitoring is paused."}
            </span>
            <span>
              100% local <i /> No account. No cloud. Just you.
            </span>
          </footer>
        </main>
        <div className="statusbar">
          <span>
            <span className={`status-dot ${watching ? "" : "muted"}`} />
            {watching ? `Watching ${watching} games` : "Monitoring paused"}
            <span className="statusbar-separator" />
            {lib.snapshots.length
              ? `Last snapshot ${relative(lib.snapshots[0].createdAt)}`
              : "Waiting for your first save"}
          </span>
          <button onClick={panic} disabled={busy || !lib.games.length}>
            <Zap size={12} />
            Panic save <kbd>Ctrl ⇧ F12</kbd>
          </button>
        </div>
      </div>
      {busy && (
        <div className="working" role="status">
          <LoaderCircle className="spin" size={15} />
          Working safely…
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {modal === "add" && (
        <ModalShell
          title="A little insurance for your next adventure."
          eyebrow="ADD A GAME"
          onClose={closeModal}
        >
          <p className="modal-description">
            Choose the existing folder where the game saves your progress. Save
            Scum stores backups separately.
          </p>
          <div className="add-options">
            <button
              onClick={async () => {
                try {
                  setDiscovered((await act("discover")) as Discovered[]);
                } catch {
                  /* alert */
                }
              }}
              disabled={busy}
            >
              <Search size={20} />
              <strong>Detect installed games</strong>
              <span>Search Steam games & save locations</span>
            </button>
            <button onClick={() => void chooseFolder()}>
              <FolderOpen size={20} />
              <strong>Choose save folder</strong>
              <span>You know where the good stuff is</span>
            </button>
          </div>
          {discovered && (
            <div className="discovered-list">
              {discovered.length ? (
                discovered.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setName(d.name);
                      setPath(d.path || "");
                      setSteamId(d.steamAppId);
                      if (!d.path)
                        setToast(
                          `${d.name} found in Steam. Choose its save folder below to start protection.`,
                        );
                    }}
                  >
                    <Gamepad2 size={16} />
                    <span>
                      {d.name}
                      <small>
                        {d.source === "steamInstall"
                          ? "Installed on Steam · Choose save folder"
                          : "Save folder detected"}
                      </small>
                      <small className="mono">{d.path || d.installPath}</small>
                    </span>
                    <Plus size={16} />
                  </button>
                ))
              ) : (
                <p>No new games found. Choose a save folder manually below.</p>
              )}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await act(
                  "addGame",
                  { name, path, steamAppId: steamId },
                  desktop
                    ? "Game added. Check its status for the initial snapshot."
                    : "Demo game added. No real folder is being monitored.",
                );
                closeModal();
              } catch {
                /* alert */
              }
            }}
          >
            <label className="field-label">
              Game name
              <input
                required
                placeholder="e.g. Baldur’s Gate 3"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSteamId(
                    catalog.find((c) => c.name === e.target.value)
                      ?.steamAppId || null,
                  );
                }}
                list="game-names"
              />
              <datalist id="game-names">
                {catalog.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </datalist>
            </label>
            <label className="field-label">
              Save folder
              <div className="path-input">
                <input
                  required
                  className="mono"
                  placeholder="Choose the folder containing your saves"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Browse save folder"
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </label>
            <div className="notice" role="status">
              <span>
                {folderError ||
                  (folderInfo
                    ? `${folderInfo.fileCount} save files found · ${bytes(folderInfo.totalBytes)}`
                    : path
                      ? "Checking save folder…"
                      : "Choose an existing save folder.")}
                {folderInfo?.fileCount === 0 &&
                  " This folder is empty. It cannot protect your progress."}
                {folderInfo?.files.map((f) => (
                  <div className="mono" key={f.path}>
                    {f.path}
                  </div>
                ))}
              </span>
            </div>
            <div className="notice">
              <ShieldCheck size={16} />
              <span>
                {desktop
                  ? "Your save files stay where they are. Snapshots are stored separately, on this device."
                  : "Browser demo: folders and snapshots are simulated. Use the desktop app to protect real saves."}
              </span>
            </div>
            <div className="modal-footer">
              <button type="button" className="button" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={
                  busy || !name.trim() || !path.trim() || !folderInfo?.fileCount
                }
              >
                <ShieldCheck size={16} />
                Protect this game
              </button>
            </div>
          </form>
        </ModalShell>
      )}
      {modal === "checkpoint" && (
        <ModalShell
          title="Future you may appreciate this."
          eyebrow="CREATE A CHECKPOINT"
          onClose={closeModal}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await act(
                  "capture",
                  { gameId: checkpointGame, kind: "manual", label },
                  desktop
                    ? "Checkpoint created. Carry on bravely."
                    : "Demo checkpoint created. No real files changed.",
                );
                closeModal();
              } catch {
                /* alert */
              }
            }}
          >
            <label className="field-label">
              Game
              <select
                value={checkpointGame}
                onChange={(e) => setCheckpointGame(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a game
                </option>
                {lib.games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Checkpoint name <span className="muted">(optional)</span>
              <input
                placeholder="Before I do something stupid"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </label>
            <p className="small-print">
              Named checkpoints are kept automatically, regardless of your
              retention policy.
            </p>
            <div className="modal-footer">
              <button type="button" className="button" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !checkpointGame}
              >
                <Plus size={16} />
                Create checkpoint
              </button>
            </div>
          </form>
        </ModalShell>
      )}
      {modal === "folder" && activeGame && (
        <ModalShell
          title="Choose the game's actual save folder"
          eyebrow="REPAIR SAVE LOCATION"
          onClose={closeModal}
        >
          <p className="modal-description">
            This is the source of your progress, not a folder for backups.
            Existing checkpoints stay in history; checkpoints from the previous
            folder cannot overwrite this folder.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              try {
                const found = await request<Discovered[]>("discover");
                const match = found.find(
                  (d) =>
                    d.path &&
                    (d.steamAppId === activeGame.steamAppId ||
                      d.name.toLowerCase() === activeGame.name.toLowerCase()),
                );
                if (match?.path) setPath(match.path);
                else
                  setFolderError(
                    "No known save folder found. Browse to the game's existing save files.",
                  );
              } catch (e) {
                setFolderError(String(e));
              }
            }}
          >
            Detect save folder
          </button>
          <label className="field-label">
            Save folder
            <div className="path-input">
              <input value={path} onChange={(e) => setPath(e.target.value)} />
              <button
                aria-label="Browse save folder"
                onClick={() => void chooseFolder()}
              >
                <FolderOpen size={17} />
              </button>
            </div>
          </label>
          <div className="notice" role="status">
            <span>
              {folderError ||
                (folderInfo
                  ? `${folderInfo.fileCount} save files found · ${bytes(folderInfo.totalBytes)}`
                  : "Checking save folder…")}
              {folderInfo?.fileCount === 0 &&
                " This folder is empty and cannot protect your progress."}
              {folderInfo?.files.map((f) => (
                <div className="mono" key={f.path}>
                  {f.path}
                </div>
              ))}
            </span>
          </div>
          <p className="small-print">
            Backup vault: {lib.storagePath}. Using this folder creates a first
            checkpoint of its current files.
          </p>
          <div className="modal-footer">
            <button className="button" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !folderInfo?.fileCount}
              onClick={async () => {
                try {
                  await act("changeSaveFolder", {
                    gameId: activeGame.id,
                    path,
                  });
                  closeModal();
                  setToast(
                    "Save folder corrected. Current save files are backed up.",
                  );
                } catch (e) {
                  setFolderError(String(e));
                }
              }}
            >
              Use this save folder
            </button>
          </div>
        </ModalShell>
      )}
      {modal === "restore" && current && (
        <ModalShell
          title={
            restoreResult
              ? restoreResult.status === "unchanged"
                ? "Your saves already match"
                : "Save files restored and verified"
              : "Restore this checkpoint?"
          }
          eyebrow="RESTORE SAVE FILES"
          onClose={() => {
            if (!busy) closeModal();
          }}
        >
          <div className="restore-summary">
            <GameArt game={selectedGame!} small />
            <div>
              <strong>{selectedGame?.name}</strong>
              <p>
                {current.label || kindLabel(current)} ·{" "}
                {date(current.createdAt)}
              </p>
            </div>
          </div>
          <label className="field-label">
            Destination save folder
            <span className="mono">{selectedGame?.path}</span>
          </label>
          {restoreError && (
            <div className="notice warning" role="alert">
              {restoreError}
            </div>
          )}
          {restoreResult ? (
            <>
              <div className="notice" role="status">
                {restoreResult.status === "unchanged"
                  ? "No files changed. This checkpoint contains the same save data as your current files. Choose an earlier checkpoint to go back."
                  : `${restoreResult.fileCount} files verified · ${restoreResult.changedFiles} files changed.`}
              </div>
              {restoreResult.recoveryPath && (
                <p className="small-print">
                  Original files preserved at{" "}
                  <span className="mono">{restoreResult.recoveryPath}</span>. A
                  protected safety checkpoint is also in your history.
                </p>
              )}
              <p>Open the game and load its save to check your progress.</p>
              {!desktop && (
                <p className="small-print">
                  Browser demo: no real files changed.
                </p>
              )}
              <div className="modal-footer">
                <button className="button primary" onClick={closeModal}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              {!restorePreview && !restoreError && (
                <p role="status">Checking checkpoint and current save files…</p>
              )}
              {restorePreview && (
                <>
                  <p>
                    {restorePreview.fileCount} files in checkpoint ·{" "}
                    {restorePreview.currentFileCount} current files ·{" "}
                    {restorePreview.changes.length} files will change.
                  </p>
                  {restorePreview.identical && (
                    <div className="notice">
                      Current files already match. This checkpoint will not
                      change your progress.
                    </div>
                  )}
                  {restorePreview.gameRunning && (
                    <div className="notice warning">
                      The game is running. Close it, then reopen this restore
                      dialog.
                    </div>
                  )}
                  <div className="discovered-list">
                    {restorePreview.changes.slice(0, 8).map((c) => (
                      <p className="mono" key={c.path}>
                        {c.status}: {c.path}
                      </p>
                    ))}
                  </div>
                  <label className="field-label">
                    <span>
                      <input
                        type="checkbox"
                        checked={gameClosed}
                        onChange={(e) => setGameClosed(e.target.checked)}
                      />{" "}
                      I have closed the game
                    </span>
                  </label>
                  <p className="small-print">
                    Your current progress is preserved as a protected safety
                    checkpoint before replacement. Restored files are verified
                    before success is reported.
                  </p>
                </>
              )}
              {busy && (
                <div className="notice" role="status">
                  <LoaderCircle size={17} /> Restoring… verifying files and
                  preserving current progress. Keep Save Scum open.
                </div>
              )}
              <div className="modal-footer">
                <button className="button" disabled={busy} onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !restorePreview ||
                    restorePreview.gameRunning ||
                    !gameClosed
                  }
                  onClick={async () => {
                    try {
                      setRestoreError("");
                      const result = await act("restore", { id: current.id });
                      setRestoreResult(result as RestoreReport);
                    } catch (e) {
                      setRestoreError(String(e));
                    }
                  }}
                >
                  <RotateCcw size={16} />
                  Restore save
                </button>
              </div>
            </>
          )}
        </ModalShell>
      )}
      {modal === "edit" && current && (
        <ModalShell
          title="Leave a note for future you."
          eyebrow="CHECKPOINT DETAILS"
          onClose={closeModal}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await act(
                  "patchSnapshot",
                  { ...current, label, notes },
                  "Snapshot details saved.",
                );
                closeModal();
              } catch {
                /* alert */
              }
            }}
          >
            <label className="field-label">
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Before the final boss"
              />
            </label>
            <label className="field-label">
              Notes
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What makes this moment worth keeping?"
              />
            </label>
            <div className="modal-footer">
              <button type="button" className="button" onClick={closeModal}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Save details
              </button>
            </div>
          </form>
        </ModalShell>
      )}
      {modal === "compare" && (
        <ModalShell
          title="What changed between saves?"
          eyebrow="SNAPSHOT COMPARISON"
          onClose={closeModal}
          wide
        >
          <div className="compare-summary">
            {date(lib.snapshots.find((s) => s.id === compareIds[1])!.createdAt)}
            <ArrowRight size={17} />
            {date(lib.snapshots.find((s) => s.id === compareIds[0])!.createdAt)}
          </div>
          <div className="compare-table">
            <div className="compare-head">
              <span>FILE / STATUS</span>
              <span>BEFORE</span>
              <span>AFTER</span>
            </div>
            {changes.map((c) => (
              <div className="compare-row" key={c.path}>
                <div>
                  <span className={`change-tag ${c.status}`}>{c.status}</span>
                  <strong className="mono">{c.path}</strong>
                </div>
                <div>
                  {c.before ? bytes(c.before.size) : "—"}
                  <small>{c.before ? date(c.before.modified) : ""}</small>
                </div>
                <div>
                  {c.after ? bytes(c.after.size) : "—"}
                  <small>{c.after ? date(c.after.modified) : ""}</small>
                </div>
              </div>
            ))}
            {!changes.length && (
              <div className="empty">
                <CircleCheck size={26} />
                <h3>Same files. Same state.</h3>
                <p>These snapshots contain identical file contents.</p>
              </div>
            )}
          </div>
          <p className="small-print">
            File-level comparison. Save Scum doesn’t interpret proprietary game
            save formats.
          </p>
        </ModalShell>
      )}
      {modal === "verify" && (
        <ModalShell
          title={
            report ? "Your library, inspected." : "Checking the time machine…"
          }
          eyebrow="INTEGRITY VERIFICATION"
          onClose={closeModal}
        >
          {report ? (
            <>
              <div className="verify-hero">
                <ShieldCheck size={38} />
                <strong>{report.healthySnapshots}</strong>
                <span>
                  {desktop ? "healthy snapshots" : "healthy demo snapshots"}
                </span>
              </div>
              <div className="verify-results">
                <div>
                  Missing blobs{" "}
                  <strong
                    className={report.missingBlobs.length ? "error-text" : ""}
                  >
                    {report.missingBlobs.length}
                  </strong>
                </div>
                <div>
                  Corrupt blobs{" "}
                  <strong
                    className={report.corruptBlobs.length ? "error-text" : ""}
                  >
                    {report.corruptBlobs.length}
                  </strong>
                </div>
                <div>
                  Orphaned blobs <strong>{report.orphanedBlobs.length}</strong>
                </div>
              </div>
              {[
                ...report.missingBlobs,
                ...report.corruptBlobs,
                ...report.orphanedBlobs,
              ].length > 0 && (
                <details>
                  <summary>View affected blob hashes</summary>
                  <pre>
                    {[
                      ...report.missingBlobs,
                      ...report.corruptBlobs,
                      ...report.orphanedBlobs,
                    ].join("\n")}
                  </pre>
                </details>
              )}
              <p className="small-print">
                {desktop
                  ? "Every referenced file was checked against its BLAKE3 content hash. No questionable data was deleted."
                  : "This is a simulated report. The desktop app verifies real stored files against their BLAKE3 content hashes."}
              </p>
            </>
          ) : (
            <div className="empty">
              {error ? (
                <p className="error-text">{error}</p>
              ) : (
                <>
                  <LoaderCircle className="spin" size={30} />
                  <p>
                    Verifying stored files. Large libraries can take a moment.
                  </p>
                </>
              )}
            </div>
          )}
          <div className="modal-footer">
            <button className="button" onClick={closeModal}>
              Done
            </button>
          </div>
        </ModalShell>
      )}
      {modal === "about" && (
        <ModalShell
          title="Because autosave is not a backup strategy."
          eyebrow="SAVE SCUM · V0.1.0"
          onClose={closeModal}
        >
          <p className="modal-description">
            Your personal undo button for game saves. Automatic snapshots,
            protected checkpoints, and a way back when things go sideways.
          </p>
          <div className="notice">
            <Monitor size={20} />
            <span>
              {desktop
                ? "You’re running the desktop app. Your snapshots stay on this device."
                : "You’re exploring the browser demo. All games and snapshots are sample data stored in this browser. The desktop app uses Rust, SQLite, and native filesystem monitoring to protect real saves."}
            </span>
          </div>
          <div className="about-stack">
            <span>
              <ShieldCheck size={17} />
              Local first. No account required.
            </span>
            <span>
              <GitBranch size={17} />
              BLAKE3 deduplication + Zstandard compression.
            </span>
            <span>
              <Monitor size={17} />
              Built for Windows, Linux, and macOS.
            </span>
          </div>
          <p className="small-print">
            Run the desktop app from this project with{" "}
            <code>npm run desktop</code>. Game artwork belongs to its respective
            publishers.
          </p>
          <div className="modal-footer">
            <button className="button primary" onClick={closeModal}>
              Back to my second chances <ArrowRight size={15} />
            </button>
          </div>
        </ModalShell>
      )}
      {modal && error && (
        <div className="modal-error" role="alert">
          <TriangleAlert size={17} />
          {error}
          <button
            className="icon-button"
            onClick={() => setError("")}
            aria-label="Dismiss dialog error"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function FlagIcon() {
  return <Save size={15} />;
}
function ArrowUpRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M3 9 9 3M3 3h6v6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
