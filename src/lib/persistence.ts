import { del, get, set } from "idb-keyval";
import type { Conversation, Workspace } from "../types";

const STORAGE_KEY = "easy-ai.session";
const HANDLE_KEY = "easy-ai.workspace-handle";

export interface SessionState {
  recentWorkspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeTaskId: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  currentFilePath: string | null;
  recentFiles: string[];
  activeView?: "workspace" | "settings";
  preferredAgentId?: "claude" | "codex";
  agentApiKey?: string;
}

export const defaultSessionState: SessionState = {
  recentWorkspaces: [],
  activeWorkspaceId: null,
  activeTaskId: null,
  conversations: [],
  activeConversationId: null,
  currentFilePath: null,
  recentFiles: [],
  activeView: "workspace",
  preferredAgentId: "claude",
  agentApiKey: "",
};

export function loadSessionState(): SessionState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultSessionState;
  }

  try {
    return {
      ...defaultSessionState,
      ...JSON.parse(raw),
    } as SessionState;
  } catch {
    return defaultSessionState;
  }
}

export function saveSessionState(state: SessionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function persistWorkspaceHandle(handle: FileSystemDirectoryHandle) {
  await set(HANDLE_KEY, handle);
}

export async function loadWorkspaceHandle() {
  return (await get<FileSystemDirectoryHandle>(HANDLE_KEY)) ?? null;
}

export async function clearWorkspaceHandle() {
  await del(HANDLE_KEY);
}
