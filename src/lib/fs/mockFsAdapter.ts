import type { FileEntry, FileRecord, FsAdapter, SearchResult, WorkspaceSelection } from "../../types";
import { createId, fileExtension } from "../utils";

type MockFiles = Record<string, string>;

export class MockFsAdapter implements FsAdapter {
  private directories = new Set<string>();

  constructor(
    private files: MockFiles = {
      "notes/brief.md": "# Brief\n\nShip the AI workstation MVP this week.",
      "notes/todo.txt": "Validate write confirmation flow.\nCheck session recovery.",
      "research/market.md": "Users want a local-first workspace with fewer abstractions.",
    },
  ) {
    this.rebuildDirectories();
  }

  async pickWorkspace(): Promise<WorkspaceSelection> {
    return {
      workspace: {
        id: createId("workspace"),
        path: "/mock/workspace",
        name: "Mock Workspace",
        lastOpenedAt: new Date().toISOString(),
      },
    };
  }

  async restoreWorkspace() {
    return null;
  }

  async reopenWorkspace(): Promise<WorkspaceSelection> {
    return this.pickWorkspace();
  }

  async listDir(path = "") {
    const seen = new Map<string, FileEntry>();

    for (const directoryPath of this.directories) {
      const name = directoryPath.split("/").pop() ?? directoryPath;
      seen.set(directoryPath, {
        path: directoryPath,
        name,
        kind: "directory",
      });
    }

    Object.keys(this.files).forEach((filePath) => {
      const segments = filePath.split("/");
      let current = "";

      segments.forEach((segment, index) => {
        current = current ? `${current}/${segment}` : segment;
        const kind = index === segments.length - 1 ? "file" : "directory";

        if (!path || current.startsWith(path)) {
          seen.set(current, {
            path: current,
            name: segment,
            kind,
          });
        }
      });
    });

    const entries = [...seen.values()];
    if (!path) {
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    }

    return entries.filter((entry) => {
      const parent = entry.path.split("/").slice(0, -1).join("/");
      return parent === path;
    });
  }

  async readFile(path: string): Promise<FileRecord> {
    const content = this.files[path];
    if (content === undefined) {
      throw new Error(`Missing file: ${path}`);
    }

    return {
      path,
      name: path.split("/").pop() ?? path,
      content,
      extension: fileExtension(path),
    };
  }

  async searchFiles(query: string): Promise<SearchResult[]> {
    const needle = query.toLowerCase();
    return Object.entries(this.files)
      .filter(([path, content]) => path.toLowerCase().includes(needle) || content.toLowerCase().includes(needle))
      .map(([path, content]) => ({
        path,
        name: path.split("/").pop() ?? path,
        snippet: content.slice(0, 80),
      }));
  }

  async writeFile(path: string, content: string) {
    this.files[path] = content;
    this.ensureParentDirectories(path);
  }

  async createFile(path: string, content = "") {
    this.files[path] = content;
    this.ensureParentDirectories(path);
  }

  async createDirectory(path: string) {
    this.directories.add(path);
    this.ensureParentDirectories(path);
  }

  async renamePath(path: string, nextPath: string) {
    const value = this.files[path];

    if (value !== undefined) {
      this.files[nextPath] = value;
      delete this.files[path];
      this.ensureParentDirectories(nextPath);
      return;
    }

    const directoryPrefix = `${path}/`;
    const nextPrefix = `${nextPath}/`;
    if (this.directories.has(path)) {
      this.directories.delete(path);
      this.directories.add(nextPath);
    }
    const entries = Object.entries(this.files).filter(([filePath]) => filePath.startsWith(directoryPrefix));
    for (const [filePath, content] of entries) {
      const rewrittenPath = `${nextPrefix}${filePath.slice(directoryPrefix.length)}`;
      this.files[rewrittenPath] = content;
      delete this.files[filePath];
    }
    for (const directoryPath of [...this.directories]) {
      if (directoryPath.startsWith(directoryPrefix)) {
        this.directories.delete(directoryPath);
        this.directories.add(`${nextPrefix}${directoryPath.slice(directoryPrefix.length)}`);
      }
    }
  }

  async deletePath(path: string, kind: "file" | "directory") {
    if (kind === "file") {
      delete this.files[path];
      return;
    }

    const directoryPrefix = `${path}/`;
    for (const filePath of Object.keys(this.files)) {
      if (filePath.startsWith(directoryPrefix)) {
        delete this.files[filePath];
      }
    }
    for (const directoryPath of [...this.directories]) {
      if (directoryPath === path || directoryPath.startsWith(directoryPrefix)) {
        this.directories.delete(directoryPath);
      }
    }
  }

  private ensureParentDirectories(path: string) {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    segments.slice(0, -1).forEach((segment) => {
      current = current ? `${current}/${segment}` : segment;
      this.directories.add(current);
    });
  }

  private rebuildDirectories() {
    this.directories.clear();
    for (const path of Object.keys(this.files)) {
      this.ensureParentDirectories(path);
    }
  }
}
