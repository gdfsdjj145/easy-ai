import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileEntry, FileRecord, FsAdapter, SearchResult, WorkspaceSelection } from "../../types";
import { createId, fileExtension } from "../utils";

interface TauriWorkspaceEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
}

interface TauriSearchResult {
  path: string;
  name: string;
  snippet: string;
}

function ensureTauri() {
  if (!isTauri()) {
    throw new Error("当前不在 Tauri 桌面环境中。");
  }
}

function toWorkspaceSelection(rootPath: string): WorkspaceSelection {
  const normalized = rootPath.replace(/[\\/]+$/, "");
  const name = normalized.split(/[/\\]/).pop() || normalized;
  return {
    workspace: {
      id: createId("workspace"),
      path: normalized,
      name,
      lastOpenedAt: new Date().toISOString(),
    },
  };
}

export class TauriFsAdapter implements FsAdapter {
  private rootPath: string | null = null;

  async pickWorkspace(): Promise<WorkspaceSelection> {
    ensureTauri();
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择工作区文件夹",
    });

    if (!selected || Array.isArray(selected)) {
      throw new Error("你还没有选择工作区。");
    }

    this.rootPath = selected;
    return toWorkspaceSelection(selected);
  }

  async restoreWorkspace() {
    return null;
  }

  async reopenWorkspace(path: string): Promise<WorkspaceSelection> {
    ensureTauri();
    this.rootPath = path;
    await invoke("validate_workspace", { workspacePath: path });
    return toWorkspaceSelection(path);
  }

  async listDir() {
    const workspacePath = this.requireRootPath();
    const entries = await invoke<TauriWorkspaceEntry[]>("list_workspace", { workspacePath });
    return entries.map<FileEntry>((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
    }));
  }

  async readFile(path: string) {
    const workspacePath = this.requireRootPath();
    const content = await invoke<string>("read_workspace_file", {
      workspacePath,
      relativePath: path,
    });

    return {
      path,
      name: path.split("/").pop() ?? path,
      content,
      extension: fileExtension(path),
    } satisfies FileRecord;
  }

  async searchFiles(query: string) {
    const workspacePath = this.requireRootPath();
    const results = await invoke<TauriSearchResult[]>("search_workspace_files", {
      workspacePath,
      query,
    });

    return results.map<SearchResult>((result) => ({
      path: result.path,
      name: result.name,
      snippet: result.snippet,
    }));
  }

  async writeFile(path: string, content: string) {
    const workspacePath = this.requireRootPath();
    await invoke("write_workspace_file", {
      workspacePath,
      relativePath: path,
      content,
    });
  }

  async createFile(path: string, content = "") {
    return this.writeFile(path, content);
  }

  async createDirectory(path: string) {
    const workspacePath = this.requireRootPath();
    await invoke("create_workspace_directory", {
      workspacePath,
      relativePath: path,
    });
  }

  async renamePath(path: string, nextPath: string) {
    const workspacePath = this.requireRootPath();
    await invoke("rename_workspace_path", {
      workspacePath,
      relativePath: path,
      nextRelativePath: nextPath,
    });
  }

  async deletePath(path: string, kind: "file" | "directory") {
    const workspacePath = this.requireRootPath();
    await invoke("delete_workspace_path", {
      workspacePath,
      relativePath: path,
      kind,
    });
  }

  private requireRootPath() {
    if (!this.rootPath) {
      throw new Error("当前还没有选择工作区。");
    }

    return this.rootPath;
  }
}
