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

export interface TaskThread {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "error";
}

export interface AgentRun {
  id: string;
  taskId: string;
  agentId: "claude" | "codex" | "local";
  prompt: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: string;
  finishedAt?: string;
}

export interface TimelineMessage {
  id: string;
  taskId: string;
  runId?: string;
  role: "user" | "assistant" | "system";
  kind: "prompt" | "final" | "error" | "info";
  content: string;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  taskId: string;
  runId: string;
  seq: number;
  type: "status" | "stdout" | "stderr" | "final" | "pending_write" | "error" | "done";
  text?: string;
  path?: string;
  reason?: string;
  content?: string;
  createdAt: string;
}

export interface TaskStoreSnapshot {
  tasks: TaskThread[];
  runs: AgentRun[];
  messages: TimelineMessage[];
  runEvents: RunEvent[];
}

export interface AgentRunEventPayload {
  type:
    | "run.started"
    | "run.log"
    | "run.final"
    | "run.pending_write"
    | "run.error"
    | "run.done";
  taskId: string;
  runId: string;
  agentId?: "claude" | "codex" | "local";
  prompt?: string;
  seq?: number;
  level?: "status" | "stdout" | "stderr";
  text?: string;
  content?: string;
  path?: string;
  reason?: string;
  at: number;
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
