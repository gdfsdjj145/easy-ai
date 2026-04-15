import { clearWorkspaceHandle, loadWorkspaceHandle, persistWorkspaceHandle } from "../persistence";
import type { FileEntry, FileRecord, FsAdapter, SearchResult, WorkspaceSelection } from "../../types";
import { createId, fileExtension, isBinaryPreviewExtension } from "../utils";

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  file?: File;
  handle?: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: TreeNode[];
}

async function ensurePermission(handle: FileSystemHandle, mode: "read" | "readwrite") {
  if ((await handle.queryPermission({ mode })) === "granted") {
    return true;
  }

  return (await handle.requestPermission({ mode })) === "granted";
}

async function readDirectoryTree(
  handle: FileSystemDirectoryHandle,
  currentPath = "",
): Promise<TreeNode[]> {
  const entries: TreeNode[] = [];

  for await (const [name, childHandle] of handle.entries()) {
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (childHandle.kind === "directory") {
      entries.push({
        name,
        path,
        kind: "directory",
        handle: childHandle,
        children: await readDirectoryTree(childHandle, path),
      });
    } else {
      entries.push({
        name,
        path,
        kind: "file",
        handle: childHandle,
        file: await childHandle.getFile(),
      });
    }
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenTree(node.children) : [])]);
}

async function resolveDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
  create = false,
) {
  let directory = rootHandle;
  for (const segment of path.split("/").filter(Boolean)) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory;
}

async function removeEntry(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
  recursive = false,
) {
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name) {
    throw new Error("Invalid path.");
  }

  const parent = await resolveDirectoryHandle(rootHandle, segments.join("/"));
  await parent.removeEntry(name, { recursive });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file as data URL."));
    reader.readAsDataURL(file);
  });
}

async function copyPath(
  rootHandle: FileSystemDirectoryHandle,
  sourcePath: string,
  destinationPath: string,
  kind: "file" | "directory",
  tree: TreeNode[],
) {
  const flatTree = flattenTree(tree);
  if (kind === "file") {
    const source = flatTree.find((node) => node.path === sourcePath && node.kind === "file");
    const content = source?.file ? await source.file.text() : "";
    const targetSegments = destinationPath.split("/").filter(Boolean);
    const fileName = targetSegments.pop();
    if (!fileName) {
      throw new Error("Invalid destination path.");
    }

    const parent = await resolveDirectoryHandle(rootHandle, targetSegments.join("/"), true);
    const handle = await parent.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }

  await resolveDirectoryHandle(rootHandle, destinationPath, true);
  const prefix = `${sourcePath}/`;
  const children = flatTree.filter((node) => node.kind === "file" && node.path.startsWith(prefix));
  for (const child of children) {
    const nextPath = `${destinationPath}/${child.path.slice(prefix.length)}`;
    await copyPath(rootHandle, child.path, nextPath, "file", tree);
  }
}

function toWorkspaceSelection(handle: FileSystemDirectoryHandle): WorkspaceSelection {
  return {
    workspace: {
      id: createId("workspace"),
      path: handle.name,
      name: handle.name,
      lastOpenedAt: new Date().toISOString(),
    },
    directoryHandle: handle,
  };
}

export class BrowserFsAdapter implements FsAdapter {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private tree: TreeNode[] = [];

  async pickWorkspace() {
    const handle = await window.showDirectoryPicker();
    if (!(await ensurePermission(handle, "readwrite"))) {
      throw new Error("Workspace permission was not granted.");
    }

    this.rootHandle = handle;
    this.tree = await readDirectoryTree(handle);
    await persistWorkspaceHandle(handle);
    return toWorkspaceSelection(handle);
  }

  async restoreWorkspace() {
    const handle = await loadWorkspaceHandle();
    if (!handle) {
      return null;
    }

    const granted = await ensurePermission(handle, "read");
    if (!granted) {
      await clearWorkspaceHandle();
      return null;
    }

    this.rootHandle = handle;
    this.tree = await readDirectoryTree(handle);
    return toWorkspaceSelection(handle);
  }

  async reopenWorkspace(_path: string): Promise<WorkspaceSelection> {
    throw new Error("当前环境不支持按路径直接恢复工作区，请重新选择文件夹。");
  }

  async listDir(path = "") {
    if (!path) {
      return flattenTree(this.tree).map<FileEntry>((node) => ({
        path: node.path,
        name: node.name,
        kind: node.kind,
      }));
    }

    const root = path ? flattenTree(this.tree).find((node) => node.path === path) : undefined;
    const children = root?.children ?? this.tree;
    return children.map<FileEntry>((node) => ({
      path: node.path,
      name: node.name,
      kind: node.kind,
    }));
  }

  async readFile(path: string) {
    const entry = flattenTree(this.tree).find((node) => node.path === path && node.kind === "file");
    if (!entry?.file) {
      throw new Error(`File not found: ${path}`);
    }

    const extension = fileExtension(entry.path);
    if (isBinaryPreviewExtension(extension)) {
      return {
        path: entry.path,
        name: entry.name,
        content: "",
        extension,
        previewUrl: await readFileAsDataUrl(entry.file),
        mimeType: entry.file.type || undefined,
      } satisfies FileRecord;
    }

    return {
      path: entry.path,
      name: entry.name,
      content: await entry.file.text(),
      extension,
    } satisfies FileRecord;
  }

  async searchFiles(query: string) {
    const needle = query.toLowerCase();

    const matches = await Promise.all(
      flattenTree(this.tree)
      .filter((node) => node.kind === "file")
      .map(async (node) => {
        const content = (node.file ? await node.file.text() : "").toLowerCase();
        const byName = node.name.toLowerCase().includes(needle);
        if (!byName && !content.includes(needle)) {
          return null;
        }

        return {
          path: node.path,
          name: node.name,
          snippet: byName ? "Matched file name." : "Matched file content.",
        } satisfies SearchResult;
      }),
    );

    return matches.filter((item): item is SearchResult => item !== null);
  }

  async writeFile(path: string, content: string) {
    if (!this.rootHandle) {
      throw new Error("No workspace selected.");
    }

    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) {
      throw new Error("Invalid path.");
    }

    let directory = this.rootHandle;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }

    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    this.tree = await readDirectoryTree(this.rootHandle);
  }

  async createFile(path: string, content = "") {
    await this.writeFile(path, content);
  }

  async createDirectory(path: string) {
    if (!this.rootHandle) {
      throw new Error("No workspace selected.");
    }

    await resolveDirectoryHandle(this.rootHandle, path, true);
    this.tree = await readDirectoryTree(this.rootHandle);
  }

  async renamePath(path: string, nextPath: string) {
    if (!this.rootHandle) {
      throw new Error("No workspace selected.");
    }

    const entry = flattenTree(this.tree).find((node) => node.path === path);
    if (!entry) {
      throw new Error(`Path not found: ${path}`);
    }

    await copyPath(this.rootHandle, path, nextPath, entry.kind, this.tree);
    await removeEntry(this.rootHandle, path, entry.kind === "directory");
    this.tree = await readDirectoryTree(this.rootHandle);
  }

  async deletePath(path: string, kind: "file" | "directory") {
    if (!this.rootHandle) {
      throw new Error("No workspace selected.");
    }

    await removeEntry(this.rootHandle, path, kind === "directory");
    this.tree = await readDirectoryTree(this.rootHandle);
  }
}
