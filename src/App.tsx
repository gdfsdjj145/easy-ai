import {
  Archive,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FilePlus2,
  Folder,
  FolderPlus,
  LayoutPanelTop,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  NotebookPen,
  RefreshCw,
  Settings2,
  Search,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { LocalToolAgent } from "./lib/agent";
import { BrowserFsAdapter } from "./lib/fs/browserFsAdapter";
import { MockFsAdapter } from "./lib/fs/mockFsAdapter";
import { TauriFsAdapter } from "./lib/fs/tauriFsAdapter";
import { cn, createId, formatRelativeTime } from "./lib/utils";
import {
  loadSessionState,
  saveSessionState,
  type SessionState,
} from "./lib/persistence";
import type {
  Conversation,
  ConversationMessage,
  AppUpdateInstallResult,
  AppUpdateStatus,
  FileEntry,
  FileRecord,
  InstalledAgent,
  PendingWrite,
  Workspace,
} from "./types";

interface AgentLogItem {
  requestId: string;
  agentId: string;
  kind: string;
  text: string;
}

interface ExplorerContextMenuState {
  path: string;
  name: string;
  kind: "file" | "directory";
  x: number;
  y: number;
}

interface RenamingEntryState {
  path: string;
  kind: "file" | "directory";
  draft: string;
}

const isBrowserFsSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;
const isTauriApp = typeof window !== "undefined" && isTauri();

const navigationItems = [
  { key: "notes", label: "Notes", sublabel: "笔记", active: false, icon: <NotebookPen className="h-4 w-4" /> },
  { key: "canvas", label: "Canvas", sublabel: "帆布", active: false, icon: <LayoutPanelTop className="h-4 w-4" /> },
  { key: "archive", label: "Archive", sublabel: "档案", active: false, icon: <Archive className="h-4 w-4" /> },
  { key: "chat", label: "AI Chat", sublabel: "AI 聊天", active: true, icon: <Bot className="h-4 w-4" /> },
  { key: "settings", label: "Settings", sublabel: "设置", active: false, icon: <Settings2 className="h-4 w-4" /> },
];

function App() {
  const adapter = useMemo(
    () =>
      isTauriApp
        ? new TauriFsAdapter()
        : isBrowserFsSupported
          ? new BrowserFsAdapter()
          : new MockFsAdapter(),
    [],
  );
  const agent = useMemo(() => new LocalToolAgent(adapter), [adapter]);
  const [session, setSession] = useState<SessionState>(() => loadSessionState());
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentFile, setCurrentFile] = useState<FileRecord | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(292);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [selectedEntryKind, setSelectedEntryKind] = useState<"file" | "directory" | null>(null);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<RenamingEntryState | null>(null);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<"claude" | "codex">("claude");
  const [agentApiKey, setAgentApiKey] = useState(session.agentApiKey ?? "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false);
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false);
  const [installingAgentId, setInstallingAgentId] = useState<"claude" | "codex" | null>(null);
  const [testingAgentId, setTestingAgentId] = useState<"claude" | "codex" | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLogItem[]>([]);
  const dragWidthRef = useRef(leftWidth);
  const resizeFrameRef = useRef<number | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const currentFileRef = useRef<FileRecord | null>(null);
  const previewContentRef = useRef("");
  const installedAgentsRef = useRef<InstalledAgent[]>([]);
  const activeAgentIdRef = useRef<"claude" | "codex">("claude");
  const agentApiKeyRef = useRef(agentApiKey);
  const agentRef = useRef(agent);
  const recentFilesRef = useRef(session.recentFiles);
  const suppressExplorerClickRef = useRef(false);
  const renameCommitRef = useRef(false);
  const skipNextRenameCommitRef = useRef(false);
  useEffect(() => {
    saveSessionState(session);
  }, [session]);

  useEffect(() => {
    const restore = async () => {
      const activeWorkspace =
        session.recentWorkspaces.find((item) => item.id === session.activeWorkspaceId) ?? null;

      const restored =
        (activeWorkspace && isTauriApp
          ? await adapter.reopenWorkspace(activeWorkspace.path)
          : await adapter.restoreWorkspace()) ??
        (!isBrowserFsSupported && !isTauriApp ? await adapter.pickWorkspace() : null);

      if (!restored) {
        return;
      }

      setWorkspace(restored.workspace);
      const items = await adapter.listDir();
      setEntries(items);
      setSession((previous) => ({
        ...previous,
        activeWorkspaceId: restored.workspace.id,
        recentWorkspaces: [
          restored.workspace,
          ...previous.recentWorkspaces.filter((item) => item.name !== restored.workspace.name),
        ].slice(0, 5),
      }));

      if (session.currentFilePath) {
        try {
          const file = await adapter.readFile(session.currentFilePath);
          setCurrentFile(file);
          setPreviewContent(file.content);
        } catch {
          setPreviewContent("");
        }
      }

      if (!session.activeConversationId) {
        const conversation = createConversation(restored.workspace.id);
        setSession((previous) => ({
          ...previous,
          recentWorkspaces: [restored.workspace, ...previous.recentWorkspaces].slice(0, 5),
          activeWorkspaceId: restored.workspace.id,
          conversations: [conversation, ...previous.conversations].slice(0, 10),
          activeConversationId: conversation.id,
        }));
      }
    };

    void restore();
  }, [adapter]);

  const visibleEntries = searchQuery
    ? entries.filter((entry) => entry.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;
  const previewMeta = getPreviewMeta(currentFile, previewContent);
  const breadcrumb = buildBreadcrumb(workspace, currentFile);
  const activeView = session.activeView ?? "workspace";
  const desktopGrid = `${leftCollapsed ? "0px" : `${leftWidth}px`} minmax(0, 1fr) ${rightCollapsed ? "0px" : "344px"}`;
  const explorerTree = useMemo(() => buildExplorerTree(visibleEntries), [visibleEntries]);
  const visibleAgentLogs = useMemo(() => {
    const filtered = agentLogs.filter((item) => item.requestId === currentRequestId && item.text.trim());
    const compacted: AgentLogItem[] = [];

    for (const item of filtered) {
      const previous = compacted[compacted.length - 1];
      if (previous && previous.kind === item.kind && previous.text === item.text) {
        continue;
      }

      if (
        previous &&
        ((previous.kind === "stderr" && item.kind === "stdout") || (previous.kind === "stdout" && item.kind === "stderr")) &&
        previous.text === item.text
      ) {
        continue;
      }

      compacted.push(item);
    }

    return compacted.slice(-12);
  }, [agentLogs, currentRequestId]);
  async function refreshInstalledAgents(preferredAgentId?: "claude" | "codex") {
    if (!isTauriApp) {
      setInstalledAgents([]);
      return;
    }

    try {
      const agents = await invoke<InstalledAgent[]>("list_installed_agents");
      setInstalledAgents(agents);
      const preferred = agents.find((agent) => agent.id === (preferredAgentId ?? session.preferredAgentId ?? "claude") && agent.available)
        ?? agents.find((agent) => agent.id === "claude" && agent.available)
        ?? agents.find((agent) => agent.id === "codex" && agent.available);
      if (preferred) {
        setActiveAgentId(preferred.id);
      }
    } catch {
      setInstalledAgents([]);
    }
  }

  const chatAdapter: Parameters<typeof useLocalRuntime>[0] = useMemo(
    () => ({
      async run({ messages }) {
        setIsAgentRunning(true);
        const latestPrompt = extractLatestUserText(messages);
        const activeCliAgent = installedAgentsRef.current.find(
          (item) => item.id === activeAgentIdRef.current && item.available,
        );

        if (isTauriApp && workspaceRef.current && activeCliAgent) {
          try {
            const requestId = createId("agent");
            setCurrentRequestId(requestId);
            setAgentLogs([]);
            const assistantMessage = await invoke<string>("run_agent_chat", {
              agentId: activeCliAgent.id,
              prompt: latestPrompt,
              apiKey: agentApiKeyRef.current,
              requestId,
              context: {
                workspacePath: workspaceRef.current.path,
                currentFilePath: currentFileRef.current?.path ?? null,
                currentFileContent: previewContentRef.current || null,
                conversationHistory: messages.map((message) => {
                  const role = message.role === "assistant" ? "助手" : "用户";
                  return `${role}：${extractThreadMessageText(message.content)}`;
                }),
              },
            });

            return {
              content: [{ type: "text", text: assistantMessage }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `调用 ${activeCliAgent.label} 失败：${String(error)}` }],
            };
          } finally {
            setIsAgentRunning(false);
          }
        }

        try {
          const result = await agentRef.current.run(latestPrompt, {
            currentFile: currentFileRef.current,
            currentContent: previewContentRef.current,
            recentFiles: recentFilesRef.current,
          });

          if (result.currentFile) {
            setCurrentFile(result.currentFile);
          }
          if (result.previewContent !== undefined) {
            setPreviewContent(result.previewContent);
          }
          if (result.pendingWrite) {
            setPendingWrite(result.pendingWrite);
          }

          return {
            content: [{ type: "text", text: result.assistantMessage }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `处理请求失败：${String(error)}` }],
          };
        } finally {
          setIsAgentRunning(false);
        }
      },
    }),
    [],
  );
  const chatRuntime = useLocalRuntime(chatAdapter);

  useEffect(() => {
    const topLevelDirectories = entries
      .filter((entry) => entry.kind === "directory" && !entry.path.includes("/"))
      .map((entry) => entry.path);
    const currentAncestors = currentFile ? ancestorPaths(currentFile.path) : [];

    setExpandedFolders((previous) =>
      Array.from(new Set([...previous, ...topLevelDirectories, ...currentAncestors])),
    );
  }, [entries, currentFile]);

  useEffect(() => {
    if (currentFile) {
      setSelectedEntryPath(currentFile.path);
      setSelectedEntryKind("file");
    }
  }, [currentFile]);

  useEffect(() => {
    dragWidthRef.current = leftWidth;
  }, [leftWidth]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    recentFilesRef.current = session.recentFiles;
  }, [session.recentFiles]);

  useEffect(() => {
    workspaceRef.current = workspace;
    currentFileRef.current = currentFile;
    previewContentRef.current = previewContent;
    installedAgentsRef.current = installedAgents;
    activeAgentIdRef.current = activeAgentId;
    agentApiKeyRef.current = agentApiKey;
  }, [workspace, currentFile, previewContent, installedAgents, activeAgentId, agentApiKey]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (!(event.target instanceof Element) || !event.target.closest("[data-explorer-context-menu='true']")) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriApp) {
      setInstalledAgents([]);
      return;
    }

    void refreshInstalledAgents();
  }, [session.preferredAgentId]);

  useEffect(() => {
    if (!isTauriApp) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void listen<AgentLogItem>("agent-log", (event) => {
      setAgentLogs((previous) => [...previous, event.payload]);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriApp || session.activeView !== "settings" || appUpdateStatus || isCheckingAppUpdate) {
      return;
    }

    void handleCheckAppUpdate(true);
  }, [session.activeView, appUpdateStatus, isCheckingAppUpdate]);

  function queueLeftWidth(nextWidth: number) {
    dragWidthRef.current = Math.min(420, Math.max(240, nextWidth));

    if (resizeFrameRef.current !== null) {
      return;
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      setLeftWidth(dragWidthRef.current);
    });
  }

  function startLeftResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      queueLeftWidth(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      setLeftWidth(dragWidthRef.current);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  async function handleWorkspaceSelect() {
    setIsBusy(true);
    try {
      const selection = await adapter.pickWorkspace();
      const items = await adapter.listDir();
      const conversation = createConversation(selection.workspace.id);
      setWorkspace(selection.workspace);
      setEntries(items);
      setCurrentFile(null);
      setPreviewContent("");
      setSession((previous) => ({
        ...previous,
        recentWorkspaces: [
          selection.workspace,
          ...previous.recentWorkspaces.filter((item) => item.name !== selection.workspace.name),
        ].slice(0, 5),
        activeWorkspaceId: selection.workspace.id,
        conversations: [
          conversation,
          ...previous.conversations.filter((item) => item.workspaceId !== selection.workspace.id),
        ].slice(0, 10),
        activeConversationId: conversation.id,
        currentFilePath: null,
        recentFiles: [],
      }));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenFile(path: string) {
    const file = await adapter.readFile(path);
    setCurrentFile(file);
    setPreviewContent(file.content);
    setSelectedEntryPath(file.path);
    setSelectedEntryKind("file");
    setContextMenu(null);
    setRenamingEntry(null);
    setSession((previous) => ({
      ...previous,
      currentFilePath: file.path,
      recentFiles: [file.path, ...previous.recentFiles.filter((item) => item !== file.path)].slice(0, 8),
    }));
  }

  function handleSelectEntry(path: string, kind: "file" | "directory") {
    setSelectedEntryPath(path);
    setSelectedEntryKind(kind);
    setContextMenu(null);
  }

  function handleOpenContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    path: string,
    kind: "file" | "directory",
    name: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    suppressExplorerClickRef.current = true;
    window.setTimeout(() => {
      suppressExplorerClickRef.current = false;
    }, 0);
    setSelectedEntryPath(path);
    setSelectedEntryKind(kind);
    setContextMenu({ path, kind, name, x: event.clientX, y: event.clientY });
    setRenamingEntry(null);
  }

  function handleExplorerNodeClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    path: string,
    kind: "file" | "directory",
  ) {
    if (suppressExplorerClickRef.current || event.ctrlKey || event.button !== 0) {
      event.preventDefault();
      return;
    }

    handleSelectEntry(path, kind);
    if (kind === "directory") {
      onToggleExplorerFolder(path);
    } else {
      void handleOpenFile(path);
    }
  }

  function onToggleExplorerFolder(path: string) {
    setExpandedFolders((previous) =>
      previous.includes(path)
        ? previous.filter((item) => item !== path)
        : [...previous, path],
    );
  }

  async function refreshExplorer() {
    setEntries(await adapter.listDir());
  }

  async function handleCreateFile() {
    const baseDirectory =
      selectedEntryKind === "directory"
        ? selectedEntryPath
        : selectedEntryPath?.split("/").slice(0, -1).join("/") || "";
    const name = window.prompt("输入新文件名", "new-note.md");
    if (!name?.trim()) {
      return;
    }

    const path = baseDirectory ? `${baseDirectory}/${name.trim()}` : name.trim();
    await adapter.createFile(path, "");
    await refreshExplorer();
    setContextMenu(null);
    setRenamingEntry(null);
    await handleOpenFile(path);
  }

  async function handleCreateDirectory() {
    const baseDirectory =
      selectedEntryKind === "directory"
        ? selectedEntryPath
        : selectedEntryPath?.split("/").slice(0, -1).join("/") || "";
    const name = window.prompt("输入新文件夹名", "new-folder");
    if (!name?.trim()) {
      return;
    }

    const path = baseDirectory ? `${baseDirectory}/${name.trim()}` : name.trim();
    await adapter.createDirectory(path);
    await refreshExplorer();
    setSelectedEntryPath(path);
    setSelectedEntryKind("directory");
    setContextMenu(null);
    setRenamingEntry(null);
    setExpandedFolders((previous) => Array.from(new Set([...previous, path])));
  }

  function handleRenameEntry(targetPath = selectedEntryPath, targetKind = selectedEntryKind) {
    if (!targetPath || !targetKind) {
      return;
    }

    setContextMenu(null);
    skipNextRenameCommitRef.current = false;
    const currentName = targetPath.split("/").pop() ?? targetPath;
    setSelectedEntryPath(targetPath);
    setSelectedEntryKind(targetKind);
    setRenamingEntry({
      path: targetPath,
      kind: targetKind,
      draft: currentName,
    });
  }

  function handleRenameDraftChange(nextValue: string) {
    setRenamingEntry((previous) => (previous ? { ...previous, draft: nextValue } : previous));
  }

  function cancelRenameEntry() {
    skipNextRenameCommitRef.current = true;
    setRenamingEntry(null);
  }

  async function commitRenameEntry(
    targetPath = renamingEntry?.path,
    targetKind = renamingEntry?.kind,
    draftName = renamingEntry?.draft ?? "",
  ) {
    if (!targetPath || !targetKind || renameCommitRef.current) {
      return;
    }

    if (skipNextRenameCommitRef.current) {
      skipNextRenameCommitRef.current = false;
      return;
    }

    renameCommitRef.current = true;
    try {
      const currentName = targetPath.split("/").pop() ?? targetPath;
      const nextName = draftName.trim();

      if (!nextName || nextName === currentName) {
        setRenamingEntry(null);
        return;
      }

      setRenamingEntry(null);
      setContextMenu(null);
      const parentPath = targetPath.split("/").slice(0, -1).join("/");
      const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;

      const replacePathPrefix = (path: string) =>
        path === targetPath || path.startsWith(`${targetPath}/`)
          ? `${nextPath}${path.slice(targetPath.length)}`
          : path;

      await adapter.renamePath(targetPath, nextPath);
      await refreshExplorer();
      setSelectedEntryPath(nextPath);
      setSelectedEntryKind(targetKind);

      if (targetKind === "file") {
        await handleOpenFile(nextPath);
      } else {
        setExpandedFolders((previous) => previous.map(replacePathPrefix));
        if (currentFile?.path.startsWith(`${targetPath}/`)) {
          const remappedPath = `${nextPath}/${currentFile.path.slice(targetPath.length + 1)}`;
          await handleOpenFile(remappedPath);
        }
      }
    } finally {
      renameCommitRef.current = false;
    }
  }

  async function handleDeleteEntry(targetPath = selectedEntryPath, targetKind = selectedEntryKind) {
    if (!targetPath || !targetKind) {
      return;
    }

    setContextMenu(null);
    setRenamingEntry(null);
    const confirmed = window.confirm(buildDeleteConfirmation(targetPath, targetKind, entries));
    if (!confirmed) {
      return;
    }

    await adapter.deletePath(targetPath, targetKind);
    await refreshExplorer();

    const deletingCurrentFile =
      currentFile &&
      (currentFile.path === targetPath ||
        (targetKind === "directory" && currentFile.path.startsWith(`${targetPath}/`)));
    if (deletingCurrentFile) {
      setCurrentFile(null);
      setPreviewContent("");
      setSession((previous) => ({ ...previous, currentFilePath: null }));
    }

    setSelectedEntryPath(null);
    setSelectedEntryKind(null);
  }

  async function handleCheckAppUpdate(silent = false) {
    if (!isTauriApp) {
      setUpdateMessage("自动更新仅支持桌面端 Tauri 应用。");
      return;
    }

    setIsCheckingAppUpdate(true);
    if (!silent) {
      setUpdateMessage("");
    }

    try {
      const status = await invoke<AppUpdateStatus>("check_app_update");
      setAppUpdateStatus(status);
      setUpdateMessage(status.message);
    } catch (error) {
      setUpdateMessage(String(error));
    } finally {
      setIsCheckingAppUpdate(false);
    }
  }

  async function handleInstallAppUpdate() {
    if (!isTauriApp) {
      setUpdateMessage("自动更新仅支持桌面端 Tauri 应用。");
      return;
    }

    setIsInstallingAppUpdate(true);
    setUpdateMessage("");

    try {
      const result = await invoke<AppUpdateInstallResult>("install_app_update");
      setUpdateMessage(result.message);
      if (result.installed) {
        setAppUpdateStatus((previous) =>
          previous
            ? {
                ...previous,
                currentVersion: result.version ?? previous.currentVersion,
                update: null,
                message: result.message,
              }
            : previous,
        );
      } else {
        const status = await invoke<AppUpdateStatus>("check_app_update");
        setAppUpdateStatus(status);
      }
    } catch (error) {
      setUpdateMessage(String(error));
    } finally {
      setIsInstallingAppUpdate(false);
    }
  }

  async function confirmWrite() {
    if (!pendingWrite) {
      return;
    }

    const write = pendingWrite;
    await adapter.writeFile(write.path, write.content);
    const refreshed = await adapter.listDir();
    setEntries(refreshed);
    if (currentFile?.path === write.path) {
      setCurrentFile({ ...currentFile, content: write.content });
      setPreviewContent(write.content);
    }
    setPendingWrite(null);
    appendMessage(createMessage("assistant", `写入完成：${write.path}`, "info"));
  }

  function cancelWrite() {
    if (!pendingWrite) {
      return;
    }

    appendMessage(createMessage("assistant", `已取消写入：${pendingWrite.path}`, "info"));
    setPendingWrite(null);
  }

  function appendMessage(message: ConversationMessage) {
    setSession((previous) => {
      const targetId = previous.activeConversationId ?? createConversation(previous.activeWorkspaceId ?? "standalone").id;
      const existing = previous.conversations.find((conversation) => conversation.id === targetId);
      const nextConversation = existing
        ? {
            ...existing,
            messages: [...existing.messages, message],
            updatedAt: message.timestamp,
            summary: summarizeConversation([...existing.messages, message]),
          }
        : {
            id: targetId,
            workspaceId: previous.activeWorkspaceId ?? "standalone",
            summary: summarizeConversation([message]),
            updatedAt: message.timestamp,
            messages: [message],
          };

      return {
        ...previous,
        conversations: [
          nextConversation,
          ...previous.conversations.filter((conversation) => conversation.id !== targetId),
        ],
        activeConversationId: targetId,
      };
    });
  }

  return (
    <div className="min-h-screen bg-[#efefed] px-3 py-3 text-[#202020] md:px-4 md:py-4 lg:px-0 lg:py-0">
      <div className="w-full lg:h-screen">
        <FloatingNav />

        <main
          className="mt-4 transition-[grid-template-columns] duration-300 lg:mt-0 lg:grid lg:h-screen lg:gap-0"
          style={{
            gridTemplateColumns: desktopGrid,
          }}
        >
          <section
            className={cn(
              "relative hidden h-screen flex-col overflow-hidden border-r border-[#e7e3dc] bg-[#f6f4ef] px-4 py-6 transition-all duration-300 lg:flex",
              leftCollapsed ? "pointer-events-none overflow-hidden border-r-0 px-0 py-0 opacity-0" : "opacity-100",
            )}
          >
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#2b2a28]">
                      {workspace?.name ?? "未连接工作区"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#9a958d]">
                      {workspace ? `最近活动 ${formatRelativeTime(workspace.lastOpenedAt)}` : "选择本地文件夹开始工作"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleWorkspaceSelect}
                    disabled={isBusy}
                    className="shrink-0 rounded-full bg-[#ff8b57] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-95"
                  >
                    {workspace ? "切换" : "打开"}
                  </button>
                </div>

                <label className="mt-4 block rounded-[12px] border border-[#ece7df] bg-[#fbfaf8] px-3 py-2">
                  <div className="flex items-center gap-2 text-[#8a847c]">
                    <Search className="h-4 w-4" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索文件或文件夹"
                      className="w-full border-none bg-transparent text-sm outline-none placeholder:text-[#b6b0a7]"
                    />
                  </div>
                </label>

                <div className="mt-4 flex flex-wrap gap-2 px-1">
                  <ExplorerActionButton label="新建文件夹" onClick={() => void handleCreateDirectory()}>
                    <FolderPlus className="h-4 w-4" />
                  </ExplorerActionButton>
                  <ExplorerActionButton label="新建文件" onClick={() => void handleCreateFile()}>
                    <FilePlus2 className="h-4 w-4" />
                  </ExplorerActionButton>
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-1">
                    {explorerTree.length > 0 ? (
                      <ExplorerTree
                        nodes={explorerTree}
                        currentFilePath={currentFile?.path ?? null}
                        selectedPath={selectedEntryPath}
                        expandedFolders={expandedFolders}
                        renamingPath={renamingEntry?.path ?? null}
                        renamingValue={renamingEntry?.draft ?? ""}
                        onToggleFolder={onToggleExplorerFolder}
                        onNodeClick={handleExplorerNodeClick}
                        onOpenContextMenu={handleOpenContextMenu}
                        onRenameValueChange={handleRenameDraftChange}
                        onCommitRename={(path, kind, value) => void commitRenameEntry(path, kind, value)}
                        onCancelRename={cancelRenameEntry}
                      />
                    ) : (
                      <div className="rounded-[16px] border border-dashed border-[#e2ded8] px-4 py-10 text-center text-sm leading-6 text-[#9d978f]">
                        当前没有匹配文件。
                      </div>
                    )}
                  </div>
                </div>
            </div>
            {!leftCollapsed ? <LeftResizeHandle onResizeStart={startLeftResize} /> : null}
          </section>

          <AssistantRuntimeProvider runtime={chatRuntime}>
            <section className="min-h-[780px] rounded-[24px] border border-white/70 bg-white/92 p-3 shadow-[0_20px_60px_rgba(34,34,34,0.07)] backdrop-blur md:p-4 lg:h-screen lg:min-h-0 lg:overflow-hidden lg:rounded-none lg:border-0 lg:bg-white lg:p-0 lg:shadow-none">
              <div className="relative flex h-full min-h-[780px] flex-col rounded-[20px] border border-[#efebe4] bg-[#fdfcf9] lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-white">
                <div className="flex items-center justify-between border-b border-[#ece7df] px-5 py-4 md:px-7 md:py-5 lg:px-8 lg:pt-6">
                  <div className="flex min-w-0 items-center gap-3">
                  <HeaderToggleButton
                    icon={leftCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    label={leftCollapsed ? "显示左栏" : "隐藏左栏"}
                    onClick={() => setLeftCollapsed((value) => !value)}
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-1 text-[14px] text-[#9c968d]">
                    {breadcrumb.map((part, index) => (
                      <span key={`${part}-${index}`} className="inline-flex items-center gap-1.5">
                        {index > 0 ? <ChevronRight className="h-3.5 w-3.5 text-[#c4bfb6]" /> : null}
                        <span>{part}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-[#98938b] lg:inline">
                    {currentFile ? `${currentFile.extension.toUpperCase() || "TXT"} Preview` : workspace ? workspace.name : "当前文档"}
                  </span>
                  <HeaderToggleButton
                    icon={rightCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                    label={rightCollapsed ? "显示助手" : "隐藏助手"}
                    onClick={() => setRightCollapsed((value) => !value)}
                  />
                  <span className="rounded-full bg-[#eceae6] px-4 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8f8a83]">
                    {pendingWrite ? "PENDING" : isAgentRunning ? "RUNNING" : "READING"}
                  </span>
                  </div>
                </div>

              {activeView === "settings" ? (
                <SettingsView
                  installedAgents={installedAgents}
                  activeAgentId={activeAgentId}
                  agentApiKey={agentApiKey}
                  showApiKey={showApiKey}
                  settingsMessage={settingsMessage}
                  appUpdateStatus={appUpdateStatus}
                  updateMessage={updateMessage}
                  isCheckingAppUpdate={isCheckingAppUpdate}
                  isInstallingAppUpdate={isInstallingAppUpdate}
                  installingAgentId={installingAgentId}
                  testingAgentId={testingAgentId}
                  onSelectAgent={(agentId) => {
                    setActiveAgentId(agentId);
                    setSession((previous) => ({
                      ...previous,
                      preferredAgentId: agentId,
                    }));
                  }}
                  onChangeApiKey={(nextValue) => {
                    setAgentApiKey(nextValue);
                    setSession((previous) => ({
                      ...previous,
                      agentApiKey: nextValue,
                    }));
                  }}
                  onToggleApiKeyVisibility={() => setShowApiKey((value) => !value)}
                  onCheckAppUpdate={() => void handleCheckAppUpdate()}
                  onInstallAppUpdate={() => void handleInstallAppUpdate()}
                  onInstallAgent={async (agentId) => {
                    setInstallingAgentId(agentId);
                    setSettingsMessage("");
                    try {
                      const message = await invoke<string>("install_agent", { agentId });
                      await refreshInstalledAgents(agentId);
                      setSettingsMessage(message);
                    } catch (error) {
                      setSettingsMessage(String(error));
                    } finally {
                      setInstallingAgentId(null);
                    }
                  }}
                  onTestAgent={async (agentId) => {
                    setTestingAgentId(agentId);
                    setSettingsMessage("");
                    try {
                      const message = await invoke<string>("test_agent_connection", {
                        agentId,
                        apiKey: agentApiKey,
                      });
                      setSettingsMessage(message);
                    } catch (error) {
                      setSettingsMessage(String(error));
                    } finally {
                      setTestingAgentId(null);
                    }
                  }}
                />
              ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 pb-[168px] md:px-8 md:py-10 md:pb-[178px] lg:px-10 lg:py-14 lg:pb-[190px]">
                {currentFile ? (
                  <article className="mx-auto max-w-3xl text-[#2c2c2b]">
                    <h1 className="font-sans text-[42px] font-bold leading-[1.08] tracking-[-0.04em] text-[#222221] md:text-[54px]">
                      {previewMeta.title}
                    </h1>
                    {previewMeta.lead ? (
                      <p className="mt-6 max-w-2xl text-[16px] leading-8 text-[#4d4b47] md:text-[17px]">
                        {previewMeta.lead}
                      </p>
                    ) : null}
                    <div className="mt-8 flex flex-wrap items-center gap-3 text-[12px] font-medium uppercase tracking-[0.16em] text-[#9b9388]">
                      <span>{currentFile.path}</span>
                      <span>{previewContent ? previewContent.split(/\r?\n/).length : 0} Lines</span>
                      <span>{previewContent.trim() ? previewContent.trim().split(/\s+/).length : 0} Words</span>
                    </div>
                    <div className="mt-10 space-y-8">
                      <PreviewBody content={previewContent} />
                    </div>
                  </article>
                ) : (
                  <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#e2ddd5] bg-white/70 text-center">
                    <Sparkles className="h-10 w-10 text-[#d3a31f]" />
                    <p className="mt-5 text-[32px] font-semibold tracking-[-0.03em] text-[#2a2a29]">
                      选择左侧文档开始浏览
                    </p>
                    <p className="mt-3 max-w-lg text-[15px] leading-7 text-[#8b857e]">
                      中间区域现在只负责展示 Markdown 内容。AI 输入区域放在下方，专门用于提问、总结和生成文档。
                    </p>
                  </div>
                )}
                </div>

                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 pb-4 pt-5 transition-all duration-300 md:px-8 md:pb-5 md:pt-6 lg:px-10 lg:pb-6",
                    rightCollapsed && "translate-y-8 opacity-0",
                  )}
                >
                  <div className="relative mx-auto max-w-3xl">
                    <ComposerPrimitive.Root className="pointer-events-auto rounded-[24px] border border-[#e7dfd3] bg-[#fbfaf7] p-2.5 shadow-[0_12px_28px_rgba(28,28,28,0.06)]">
                      <ComposerPrimitive.Input
                        placeholder="输入提示信息以处理当前文档……"
                        disabled={isAgentRunning}
                        rows={2}
                        className="h-16 min-h-16 max-h-16 w-full resize-none overflow-y-auto border-none bg-transparent px-2 py-1.5 text-[15px] leading-7 text-[#3d3c3a] outline-none placeholder:text-[#bbb5ac]"
                      />
                      <div className="mt-1.5 flex items-center justify-end">
                        <ComposerPrimitive.Send
                          disabled={isAgentRunning}
                          className="inline-flex min-w-[132px] items-center justify-center rounded-[16px] bg-[#1f1f1f] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
                        >
                          {isAgentRunning ? "发送中…" : "发送"}
                        </ComposerPrimitive.Send>
                      </div>
                    </ComposerPrimitive.Root>
                  </div>
                </div>
              </div>
              )}
              </div>
            </section>

            <section
              className={cn(
                "hidden h-screen flex-col overflow-hidden border-l border-[#e7e3dc] bg-[#fbfaf7] transition-all duration-300 lg:flex",
                rightCollapsed ? "pointer-events-none border-l-0 opacity-0" : "opacity-100",
              )}
            >
              <div className="flex items-center justify-between border-b border-[#f1ece5] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#8f8a83]">Conversation</p>
                </div>
                <HeaderToggleButton
                  icon={<Settings2 className="h-4 w-4" />}
                  label="设置"
                  onClick={() =>
                    setSession((previous) => ({
                      ...previous,
                      activeView: previous.activeView === "settings" ? "workspace" : "settings",
                    }))
                  }
                />
              </div>

              <ThreadPrimitive.Root className="min-h-0 flex-1">
                <ThreadPrimitive.Viewport className="h-full overflow-y-auto px-5 py-5">
                  {visibleAgentLogs.length > 0 ? (
                    <div className="mb-3 rounded-[14px] border border-[#ece6dc] bg-[#fbfaf7] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9b9388]">Activity</p>
                        <span className="text-[10px] text-[#b2aba1]">{visibleAgentLogs.length} 条</span>
                      </div>
                      <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
                        {visibleAgentLogs.map((log, index) => (
                          <div key={`${log.requestId}-${index}`} className="text-[11px] leading-4.5 text-[#7c756d]">
                            <span
                              className={cn(
                                "mr-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]",
                                log.kind === "status" && "bg-[#f1ebe2] text-[#9a948b]",
                                log.kind === "stdout" && "bg-[#e8efe6] text-[#6d8b68]",
                                log.kind === "stderr" && "bg-[#f4e7e3] text-[#b16e5b]",
                                log.kind === "error" && "bg-[#f3dedd] text-[#b75656]",
                              )}
                            >
                              {log.kind === "status"
                                ? "状态"
                                : log.kind === "stdout"
                                  ? "输出"
                                  : log.kind === "stderr"
                                    ? "日志"
                                    : "错误"}
                            </span>
                            <span>{log.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <ThreadPrimitive.If empty>
                    <div className="px-1 py-4 text-sm leading-6 text-[#8f8a83]">
                      当前还没有对话。底部输入框会调用已安装的 Claude Code 或 Codex CLI，并把过程显示在这里。
                    </div>
                  </ThreadPrimitive.If>
                  <div className="space-y-6">
                    <ThreadPrimitive.Messages>
                      {({ message }) => {
                        const messageText = extractThreadMessageText(message.content);
                        const showInlineLoading =
                          isAgentRunning && message.role === "assistant" && !messageText;
                        const isAssistant = message.role === "assistant";

                        return (
                          <MessagePrimitive.Root
                            className={cn(
                              "px-1",
                              isAssistant ? "text-[#383736]" : "flex justify-end text-[#5e5a55]",
                            )}
                          >
                            {isAssistant ? (
                              <>
                                <div className="flex items-center gap-3">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9388]">
                                    AI
                                  </span>
                                  <span className="h-px flex-1 bg-[#ede7de]" />
                                </div>
                                <div className="mt-2.5 whitespace-pre-wrap text-[14px] leading-7">
                                  {showInlineLoading ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7afa4]" />
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7afa4] [animation-delay:120ms]" />
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7afa4] [animation-delay:240ms]" />
                                    </span>
                                  ) : (
                                    <MessagePrimitive.Parts />
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="max-w-[78%] rounded-[18px] bg-[#f3eee7] px-4 py-3 text-[14px] leading-7 text-[#4c4944] shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                <MessagePrimitive.Parts />
                              </div>
                            )}
                          </MessagePrimitive.Root>
                        );
                      }}
                    </ThreadPrimitive.Messages>
                  </div>
                </ThreadPrimitive.Viewport>
              </ThreadPrimitive.Root>
            </section>
          </AssistantRuntimeProvider>
        </main>
      </div>

      {contextMenu ? (
        <ExplorerContextMenu
          style={getContextMenuStyle(contextMenu)}
          name={contextMenu.name}
          kind={contextMenu.kind}
          onRename={() => void handleRenameEntry(contextMenu.path, contextMenu.kind)}
          onDelete={() => void handleDeleteEntry(contextMenu.path, contextMenu.kind)}
        />
      ) : null}

      {pendingWrite ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-[rgba(24,24,24,0.18)] px-4 py-6 backdrop-blur-sm md:items-center">
          <div className="w-full max-w-2xl rounded-[30px] border border-white/80 bg-[#fffdfa] p-7 shadow-[0_30px_90px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#9a948b]">Write Confirmation</p>
                <h2 className="mt-2 text-[30px] font-semibold tracking-[-0.03em] text-[#222221]">写入确认</h2>
              </div>
              <span className="rounded-full bg-[#f2efea] px-4 py-2 text-xs font-semibold text-[#8b867e]">待确认</span>
            </div>
            <p className="mt-5 text-sm leading-7 text-[#5a574f]">{pendingWrite.path}</p>
            <p className="mt-1 text-sm leading-7 text-[#8f8a83]">{pendingWrite.reason}</p>
            <pre className="mt-5 max-h-64 overflow-auto rounded-[22px] border border-[#ece7df] bg-white px-5 py-4 text-sm leading-7 text-[#3b3936]">
              {pendingWrite.content}
            </pre>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void confirmWrite()}
                className="rounded-full bg-[#151515] px-6 py-3 text-sm font-semibold text-white"
              >
                确认写入
              </button>
              <button
                type="button"
                onClick={cancelWrite}
                className="rounded-full border border-[#ddd7ce] bg-white px-6 py-3 text-sm font-semibold text-[#44423f]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FloatingNav() {
  return (
    <div className="flex justify-center pt-2 lg:hidden">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-[999px] border border-[#242424] bg-black px-2 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
        {navigationItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(
              "inline-flex items-center gap-2 rounded-[999px] px-4 py-2.5 text-sm font-semibold transition",
              item.active ? "bg-[#ffd329] text-black" : "text-white/88 hover:bg-white/10",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className={cn("text-xs", item.active ? "text-black/80" : "text-white/60")}>{item.sublabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HeaderToggleButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#e4ddd4] bg-[#fbfaf7] text-[#5f5a53] transition hover:bg-white hover:text-[#222221]"
    >
      {icon}
    </button>
  );
}

function ExplorerActionButton({
  children,
  label,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-[12px] border border-[#e4ddd4] bg-[#fbfaf7] px-3 text-[12px] font-medium text-[#5f5a53] transition hover:bg-white hover:text-[#222221] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function LeftResizeHandle({ onResizeStart }: { onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      aria-label="调整左栏宽度"
      onPointerDown={onResizeStart}
      className="absolute right-0 top-0 hidden h-full w-4 translate-x-1/2 cursor-col-resize bg-transparent lg:block"
    >
      <span className="absolute left-1/2 top-1/2 h-20 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d8d1c7] transition hover:bg-[#bfb6aa]" />
    </button>
  );
}

function SettingsView({
  installedAgents,
  activeAgentId,
  agentApiKey,
  showApiKey,
  settingsMessage,
  appUpdateStatus,
  updateMessage,
  isCheckingAppUpdate,
  isInstallingAppUpdate,
  installingAgentId,
  testingAgentId,
  onSelectAgent,
  onChangeApiKey,
  onToggleApiKeyVisibility,
  onCheckAppUpdate,
  onInstallAppUpdate,
  onInstallAgent,
  onTestAgent,
}: {
  installedAgents: InstalledAgent[];
  activeAgentId: "claude" | "codex";
  agentApiKey: string;
  showApiKey: boolean;
  settingsMessage: string;
  appUpdateStatus: AppUpdateStatus | null;
  updateMessage: string;
  isCheckingAppUpdate: boolean;
  isInstallingAppUpdate: boolean;
  installingAgentId: "claude" | "codex" | null;
  testingAgentId: "claude" | "codex" | null;
  onSelectAgent: (agentId: "claude" | "codex") => void;
  onChangeApiKey: (value: string) => void;
  onToggleApiKeyVisibility: () => void;
  onCheckAppUpdate: () => void;
  onInstallAppUpdate: () => void;
  onInstallAgent: (agentId: "claude" | "codex") => Promise<void>;
  onTestAgent: (agentId: "claude" | "codex") => Promise<void>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 md:px-8 md:py-10 lg:px-10 lg:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9a948b]">Settings</p>
        <h1 className="mt-3 text-[36px] font-semibold tracking-[-0.04em] text-[#222221] md:text-[44px]">
          Agent Settings
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#6d675f]">
          应用已经内置好默认 API 地址和 Codex 模型。用户只需要在这里填写自己的 API Key，
          不需要额外配置 `cc-switch` 或手动修改本地配置文件。
        </p>

        <div className="mt-10 rounded-[24px] border border-[#ebe4d9] bg-[#fbfaf7] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[16px] font-semibold text-[#2d2b27]">默认 Agent</p>
              <p className="mt-1 text-sm text-[#8f8a83]">建议优先使用更稳定的 Claude Code。Codex 目前保留为可选项。</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(["claude", "codex"] as const).map((agentId) => {
              const agentInfo = installedAgents.find((item) => item.id === agentId);
              const available = agentInfo?.available ?? false;
              const selected = activeAgentId === agentId;

              return (
                <div
                  key={agentId}
                  role="button"
                  tabIndex={available ? 0 : -1}
                  onClick={() => available && onSelectAgent(agentId)}
                  onKeyDown={(event) => {
                    if (!available) {
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectAgent(agentId);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[18px] border px-4 py-4 text-left transition",
                    selected
                      ? "border-[#1f1f1f] bg-white text-[#1f1f1f]"
                      : "border-[#e8e1d8] bg-[#f7f3ec] text-[#57524b]",
                    !available && "cursor-not-allowed opacity-50",
                  )}
                >
                  <div>
                    <p className="text-[15px] font-semibold">
                      {agentInfo?.label ?? (agentId === "claude" ? "Claude Code" : "Codex CLI")}
                    </p>
                    <p className="mt-1 text-[13px] text-[#8f8a83]">
                      {available ? "已检测到本机安装" : "当前机器上不可用"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {available ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onTestAgent(agentId);
                        }}
                        disabled={testingAgentId === agentId}
                        className="rounded-full border border-[#ddd6cc] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b655e] transition hover:bg-[#f8f4ef] disabled:opacity-50"
                      >
                        {testingAgentId === agentId ? "测试中..." : "测试连接"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onInstallAgent(agentId);
                        }}
                        disabled={installingAgentId === agentId}
                        className="rounded-full border border-[#ddd6cc] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b655e] transition hover:bg-[#f8f4ef] disabled:opacity-50"
                      >
                        {installingAgentId === agentId ? "安装中..." : "安装"}
                      </button>
                    )}
                    <span className="rounded-full bg-[#efe9df] px-2.5 py-1 text-[11px] font-medium text-[#8d867b]">
                      {available ? "Available" : "Missing"}
                    </span>
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-[24px] border border-[#ebe4d9] bg-[#fbfaf7] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[16px] font-semibold text-[#2d2b27]">应用更新</p>
              <p className="mt-1 text-sm text-[#8f8a83]">
                桌面端将从 GitHub Releases 获取 `latest.json`，下载更新后自动重启应用。
              </p>
            </div>
            <span className="rounded-full bg-[#efe9df] px-2.5 py-1 text-[11px] font-medium text-[#8d867b]">
              {appUpdateStatus?.currentVersion ?? "桌面端可用"}
            </span>
          </div>

          <div className="mt-4 rounded-[18px] border border-[#ece4d8] bg-white px-4 py-4">
            {isTauriApp ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#6f685f]">
                  <span className="font-medium text-[#34312c]">更新源</span>
                  <span className="truncate">{appUpdateStatus?.endpoint ?? "https://github.com/gdfsdjj145/easy-ai/releases/latest/download/latest.json"}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#6d675f]">
                  {appUpdateStatus?.update
                    ? `发现新版本 ${appUpdateStatus.update.version}，当前版本 ${appUpdateStatus.update.currentVersion}。`
                    : appUpdateStatus?.message ?? "进入设置页后会自动检查一次更新。"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onCheckAppUpdate()}
                    disabled={isCheckingAppUpdate}
                    className="inline-flex items-center gap-2 rounded-[16px] border border-[#ddd6cc] bg-white px-4 py-2.5 text-sm font-medium text-[#6b655e] transition hover:bg-[#f8f4ef] disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-4 w-4", isCheckingAppUpdate && "animate-spin")} />
                    <span>{isCheckingAppUpdate ? "检查中..." : "检查更新"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onInstallAppUpdate()}
                    disabled={!appUpdateStatus?.configured || !appUpdateStatus?.update || isInstallingAppUpdate}
                    className="inline-flex items-center gap-2 rounded-[16px] bg-[#1f1f1f] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-[#c9c3bb]"
                  >
                    <Download className="h-4 w-4" />
                    <span>{isInstallingAppUpdate ? "安装中..." : "下载并安装"}</span>
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm leading-6 text-[#6d675f]">自动更新仅支持桌面端 Tauri 应用；浏览器预览下不会检查 releases。</p>
            )}
          </div>

          {updateMessage ? (
            <p className="mt-3 text-sm leading-6 text-[#6d675f]">{updateMessage}</p>
          ) : null}
        </div>

        <div className="mt-6 rounded-[24px] border border-[#ebe4d9] bg-[#fbfaf7] p-5">
          <p className="text-[16px] font-semibold text-[#2d2b27]">API Key</p>
          <p className="mt-1 text-sm text-[#8f8a83]">
            默认 API 地址已经内置为 `https://codecli.shop`。这里填写后，Claude Code 和 Codex CLI 都会共用这把 key。
          </p>
          <div className="mt-4 flex gap-2">
            <input
              type={showApiKey ? "text" : "password"}
              value={agentApiKey}
              onChange={(event) => onChangeApiKey(event.target.value)}
              placeholder="输入你的 API Key"
              className="flex-1 rounded-[16px] border border-[#e4ddd4] bg-white px-4 py-3 text-sm text-[#2f2d29] outline-none placeholder:text-[#b5aea3]"
            />
            <button
              type="button"
              onClick={onToggleApiKeyVisibility}
              className="rounded-[16px] border border-[#ddd6cc] bg-white px-4 py-3 text-sm font-medium text-[#6b655e] transition hover:bg-[#f8f4ef]"
            >
              {showApiKey ? "隐藏" : "显示"}
            </button>
          </div>
          {settingsMessage ? (
            <p className="mt-3 text-sm leading-6 text-[#6d675f]">{settingsMessage}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ content }: { content: string }) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const blocks = buildContentBlocks(lines);

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3 key={`${block.type}-${index}`} className="text-[22px] font-semibold tracking-[-0.03em] text-[#292826]">
              {block.text}
            </h3>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              key={`${block.type}-${index}`}
              className="border-l-[3px] border-[#ddd4c6] pl-5 text-[16px] leading-8 text-[#5c5852]"
            >
              {block.text}
            </blockquote>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-2 pl-0 text-[16px] leading-8 text-[#46443f]">
              {block.items.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-[13px] h-1.5 w-1.5 rounded-full bg-[#232321]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "code") {
          return (
            <pre
              key={`${block.type}-${index}`}
              className="overflow-x-auto rounded-[20px] border border-[#ece3d6] bg-[#f8f4ee] px-5 py-4 text-sm leading-7 text-[#4d3322]"
            >
              <code>{block.text}</code>
            </pre>
          );
        }

        return (
          <p key={`${block.type}-${index}`} className="text-[16px] leading-8 text-[#46443f]">
            {block.text}
          </p>
        );
      })}
    </>
  );
}

function getPreviewMeta(file: FileRecord | null, content: string) {
  if (!file) {
    return { title: "空白文档", lead: "" };
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => line.startsWith("#"))?.replace(/^#+\s*/, "");
  const title = heading || prettifyFileName(file.name);
  const lead = lines.find((line) => !line.startsWith("#") && !line.startsWith("-") && !line.startsWith(">")) ?? "";

  return { title, lead };
}

function buildContentBlocks(lines: string[]) {
  type ContentBlock =
    | { type: "paragraph"; text: string }
    | { type: "heading"; text: string }
    | { type: "quote"; text: string }
    | { type: "list"; items: string[] }
    | { type: "code"; text: string };

  const blocks: ContentBlock[] = [];

  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];
  let quoteBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCodeBlock = false;

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphBuffer.join(" ") });
      paragraphBuffer = [];
    }
  }

  function flushList() {
    if (listBuffer.length > 0) {
      blocks.push({ type: "list", items: [...listBuffer] });
      listBuffer = [];
    }
  }

  function flushQuote() {
    if (quoteBuffer.length > 0) {
      blocks.push({ type: "quote", text: quoteBuffer.join(" ") });
      quoteBuffer = [];
    }
  }

  function flushCode() {
    if (codeBuffer.length > 0) {
      blocks.push({ type: "code", text: codeBuffer.join("\n") });
      codeBuffer = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      flushQuote();
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (trimmed.startsWith("#")) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "heading", text: trimmed.replace(/^#+\s*/, "") });
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      quoteBuffer.push(trimmed.replace(/^>\s*/, ""));
      continue;
    }

    if (trimmed.startsWith("-")) {
      flushParagraph();
      flushQuote();
      listBuffer.push(trimmed.replace(/^-\s*/, ""));
      continue;
    }

    flushList();
    flushQuote();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushCode();

  return blocks.length > 0 ? blocks : ([{ type: "paragraph", text: "当前文件暂无可展示内容。" }] as ContentBlock[]);
}

function prettifyFileName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ExplorerTree({
  nodes,
  currentFilePath,
  selectedPath,
  expandedFolders,
  renamingPath,
  renamingValue,
  onToggleFolder,
  onNodeClick,
  onOpenContextMenu,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  depth = 0,
}: {
  nodes: ExplorerNode[];
  currentFilePath: string | null;
  selectedPath: string | null;
  expandedFolders: string[];
  renamingPath: string | null;
  renamingValue: string;
  onToggleFolder: (path: string) => void;
  onNodeClick: (event: ReactMouseEvent<HTMLButtonElement>, path: string, kind: "file" | "directory") => void;
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    path: string,
    kind: "file" | "directory",
    name: string,
  ) => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: (path: string, kind: "file" | "directory", value: string) => void;
  onCancelRename: () => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.kind === "directory";
        const expanded = expandedFolders.includes(node.path);
        const active = currentFilePath === node.path;
        const selected = selectedPath === node.path;
        const renaming = renamingPath === node.path;
        const currentAncestor = currentFilePath ? ancestorPaths(currentFilePath).includes(node.path) : false;

        return (
          <div key={node.path}>
            {renaming ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onCommitRename(node.path, node.kind, renamingValue);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[12px] bg-[#f5f1e8] px-3 py-2 text-left ring-1 ring-[#d9c9ad]",
                  currentAncestor && !active && "text-[#2b2a28]",
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                {isDirectory ? (
                  expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[#8d877f]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#8d877f]" />
                  )
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                {isDirectory ? (
                  <Folder className="h-4 w-4 shrink-0 text-[#8f8a83]" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[#a09a91]" />
                )}
                <input
                  aria-label={`重命名 ${node.name}`}
                  value={renamingValue}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => onRenameValueChange(event.target.value)}
                  onBlur={() => onCommitRename(node.path, node.kind, renamingValue)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-[10px] border border-[#dfd2bf] bg-white px-2.5 py-1.5 text-[14px] font-medium text-[#2f2c27] outline-none placeholder:text-[#b1a899]"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={(event) => onNodeClick(event, node.path, node.kind)}
                onContextMenu={(event) => onOpenContextMenu(event, node.path, node.kind, node.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left transition",
                  active ? "bg-[#e9e7e1] text-[#1f1f1f]" : "text-[#615d56] hover:bg-[#efede8]",
                  currentAncestor && !active && "text-[#2b2a28]",
                  selected && !active && "bg-[#f1ede6] text-[#2b2a28]",
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                {isDirectory ? (
                  expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[#8d877f]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#8d877f]" />
                  )
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                {isDirectory ? (
                  <Folder className="h-4 w-4 shrink-0 text-[#8f8a83]" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[#a09a91]" />
                )}
                <span className={cn("min-w-0 truncate text-[14px]", active ? "font-semibold" : "font-medium")}>
                  {node.name}
                </span>
              </button>
            )}

            {isDirectory && expanded && node.children.length > 0 ? (
              <ExplorerTree
                nodes={node.children}
                currentFilePath={currentFilePath}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                renamingPath={renamingPath}
                renamingValue={renamingValue}
                onToggleFolder={onToggleFolder}
                onNodeClick={onNodeClick}
                onOpenContextMenu={onOpenContextMenu}
                onRenameValueChange={onRenameValueChange}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function ExplorerContextMenu({
  style,
  name,
  kind,
  onRename,
  onDelete,
}: {
  style: { left: number; top: number };
  name: string;
  kind: "file" | "directory";
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-explorer-context-menu="true"
      role="menu"
      aria-label={`${name} 右键菜单`}
      className="fixed z-40 w-44 rounded-[18px] border border-[#e7dfd3] bg-[#fffdfa] p-1.5 shadow-[0_18px_40px_rgba(28,28,28,0.12)]"
      style={style}
    >
      <div className="border-b border-[#f1ebe2] px-3 py-2">
        <p className="truncate text-[12px] font-semibold text-[#2c2a27]">{name}</p>
        <p className="mt-0.5 text-[11px] text-[#989188]">
          {kind === "directory" ? "文件夹操作" : "文件操作"}
        </p>
      </div>
      <div className="mt-1 space-y-0.5">
        <ExplorerContextMenuItem label="重命名" onClick={onRename} />
        <ExplorerContextMenuItem label="删除" onClick={onDelete} danger />
      </div>
    </div>
  );
}

function ExplorerContextMenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-[12px] px-3 py-2 text-left text-[13px] font-medium transition",
        danger ? "text-[#b25d48] hover:bg-[#fbefea]" : "text-[#4f4b45] hover:bg-[#f6f2eb]",
      )}
    >
      {label}
    </button>
  );
}

function buildBreadcrumb(workspace: Workspace | null, file: FileRecord | null) {
  if (!workspace && !file) {
    return ["Vault", "设计项目", "预览区"];
  }

  const root = workspace?.name || "Vault";
  if (!file) {
    return [root, "工作区主页"];
  }

  return [root, ...file.path.split("/")];
}

function createConversation(workspaceId: string): Conversation {
  return {
    id: createId("conversation"),
    workspaceId,
    summary: "新会话",
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

function createMessage(
  role: ConversationMessage["role"],
  content: string,
  kind: ConversationMessage["kind"] = "info",
): ConversationMessage {
  return {
    id: createId("message"),
    role,
    content,
    timestamp: new Date().toISOString(),
    kind,
  };
}

function summarizeConversation(messages: ConversationMessage[]) {
  const latest = messages[messages.length - 1];
  return latest.content.slice(0, 80);
}

function extractLatestUserText(messages: readonly { role: string; content: unknown }[]) {
  const userMessage = [...messages].reverse().find((message) => message.role === "user");
  return userMessage ? extractThreadMessageText(userMessage.content) : "";
}

function extractThreadMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : "";
  }

  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }

      const typedPart = part as { type?: string; text?: string };
      return typedPart.type === "text" ? typedPart.text ?? "" : "";
    })
    .join("\n")
    .trim();
}

interface ExplorerNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: ExplorerNode[];
}

function buildExplorerTree(entries: FileEntry[]) {
  const roots: ExplorerNode[] = [];
  const cache = new Map<string, ExplorerNode>();

  const sortedEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of sortedEntries) {
    const segments = entry.path.split("/");
    const parentPath = segments.slice(0, -1).join("/");
    const node: ExplorerNode = cache.get(entry.path) ?? {
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      children: [],
    };

    node.name = entry.name;
    node.kind = entry.kind;
    cache.set(entry.path, node);

    if (!parentPath) {
      if (!roots.some((item) => item.path === node.path)) {
        roots.push(node);
      }
      continue;
    }

    const parent = cache.get(parentPath);
    if (parent && !parent.children.some((item) => item.path === node.path)) {
      parent.children.push(node);
    }
  }

  return roots.sort(compareExplorerNode);
}

function compareExplorerNode(left: ExplorerNode, right: ExplorerNode) {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function ancestorPaths(path: string) {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function getContextMenuStyle(menu: ExplorerContextMenuState) {
  const width = 176;
  const height = 124;
  const padding = 12;

  if (typeof window === "undefined") {
    return { left: menu.x, top: menu.y };
  }

  return {
    left: Math.max(padding, Math.min(menu.x, window.innerWidth - width - padding)),
    top: Math.max(padding, Math.min(menu.y, window.innerHeight - height - padding)),
  };
}

function buildDeleteConfirmation(path: string, kind: "file" | "directory", entries: FileEntry[]) {
  const displayName = path.split("/").pop() ?? path;

  if (kind === "directory") {
    const descendantCount = entries.filter((entry) => entry.path.startsWith(`${path}/`)).length;
    const descendantMessage =
      descendantCount > 0 ? `\n\n将同时删除 ${descendantCount} 个子项目。` : "\n\n该文件夹当前为空。";
    return `确认删除文件夹“${displayName}”及其全部内容吗？${descendantMessage}\n\n此操作不可恢复。`;
  }

  return `确认删除文件“${displayName}”吗？\n\n此操作不可恢复。`;
}

export default App;
