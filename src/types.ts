export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  kind?: "info" | "result" | "warning";
}

export interface Conversation {
  id: string;
  workspaceId: string;
  summary: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface SearchResult {
  path: string;
  name: string;
  snippet: string;
}

export interface FileRecord {
  path: string;
  name: string;
  content: string;
  extension: string;
  previewUrl?: string;
  mimeType?: string;
}

export interface FileAction {
  type: "read" | "write" | "rename" | "delete";
  path: string;
  timestamp: string;
}

export interface TaskLog {
  id: string;
  status: "pending" | "running" | "done";
  logs: string[];
}

export interface PendingWrite {
  path: string;
  content: string;
  reason: string;
}

export interface WorkspaceSelection {
  workspace: Workspace;
  directoryHandle?: FileSystemDirectoryHandle;
}

export interface FsAdapter {
  pickWorkspace(): Promise<WorkspaceSelection>;
  restoreWorkspace(): Promise<WorkspaceSelection | null>;
  reopenWorkspace(path: string): Promise<WorkspaceSelection>;
  listDir(path?: string): Promise<FileEntry[]>;
  readFile(path: string): Promise<FileRecord>;
  searchFiles(query: string): Promise<SearchResult[]>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  renamePath(path: string, nextPath: string): Promise<void>;
  deletePath(path: string, kind: "file" | "directory"): Promise<void>;
}

export interface AgentContext {
  currentFile: FileRecord | null;
  currentContent?: string;
  recentFiles: string[];
}

export interface AgentRunResult {
  assistantMessage: string;
  fileActions: FileAction[];
  currentFile?: FileRecord;
  previewContent?: string;
  pendingWrite?: PendingWrite;
}

export interface InstalledAgent {
  id: "claude" | "codex";
  label: string;
  available: boolean;
}

export interface AvailableAppUpdate {
  version: string;
  currentVersion: string;
}

export interface AppUpdateStatus {
  configured: boolean;
  endpoint: string;
  currentVersion: string;
  update: AvailableAppUpdate | null;
  message: string;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}
