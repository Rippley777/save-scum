export interface Game {
  id: string;
  name: string;
  path: string;
  steamAppId: string | null;
  watching: boolean;
  retention: string;
  lastActivity: string | null;
  error: string | null;
  running: boolean;
  executables: string[];
}
export interface SaveFile {
  path: string;
  hash: string;
  size: number;
  modified: string;
}
export interface Snapshot {
  sourcePath?: string | null;
  id: string;
  gameId: string;
  createdAt: string;
  kind: "automatic" | "manual" | "panic" | "safety";
  label: string;
  notes: string;
  favorite: boolean;
  protected: boolean;
  files: SaveFile[];
  size: number;
  changed: number;
}
export interface Settings {
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  notifications: boolean;
  panicNotifications: boolean;
  compressionLevel: number;
  debounceMs: number;
  ignoreTemporary: boolean;
  defaultRetention: string;
  storageLimitGb: number;
  panicGameId: string | null;
}
export interface Library {
  warnings?: string[];
  games: Game[];
  snapshots: Snapshot[];
  settings: Settings;
  storageBytes: number;
  storagePath: string;
}
export interface IntegrityReport {
  healthySnapshots: number;
  missingBlobs: string[];
  corruptBlobs: string[];
  orphanedBlobs: string[];
}
export interface FileChange {
  path: string;
  status: string;
  before: SaveFile | null;
  after: SaveFile | null;
}
export interface Discovered {
  name: string;
  steamAppId: string | null;
  path: string | null;
  installPath?: string | null;
  source: "saveFolder" | "steamInstall";
}

export interface FolderInspection {
  path: string;
  fileCount: number;
  totalBytes: number;
  files: { path: string; size: number }[];
}
export interface RestorePreview {
  snapshotId: string;
  savePath: string;
  fileCount: number;
  currentFileCount: number;
  changes: FileChange[];
  identical: boolean;
  gameRunning: boolean;
}
export interface RestoreReport {
  status: string;
  savePath: string;
  fileCount: number;
  changedFiles: number;
  safetySnapshotId: string | null;
  recoveryPath: string | null;
}
