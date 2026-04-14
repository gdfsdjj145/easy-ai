import type { AgentContext, AgentRunResult, FileAction, FileRecord, FsAdapter, PendingWrite } from "../types";
import { generateDocumentFromPrompt, rewriteAsCleanDraft, summarizeContent } from "./contentTools";

export class LocalToolAgent {
  constructor(private fsAdapter: FsAdapter) {}

  async run(prompt: string, context: AgentContext): Promise<AgentRunResult> {
    const normalized = prompt.trim().toLowerCase();
    const fileActions: FileAction[] = [];

    if (hasKeyword(normalized, prompt, ["search", "搜索", "查找"])) {
      const query = prompt.replace(/search/gi, "").replace(/搜索|查找/g, "").trim() || prompt.trim();
      const results = await this.fsAdapter.searchFiles(query);
      return {
        assistantMessage:
          results.length > 0
            ? `已找到 ${results.length} 个与“${query}”相关的文件。`
            : `没有找到与“${query}”相关的文件。`,
        fileActions,
      };
    }

    const currentFile = this.applyWorkingCopy(
      await this.resolveCurrentFile(context.currentFile, fileActions),
      context.currentContent,
    );

    if (hasKeyword(normalized, prompt, ["summarize", "summary", "总结", "摘要", "概括"])) {
      if (!currentFile) {
        return {
          assistantMessage: "请先选择一个文件，再执行总结。",
          fileActions,
        };
      }

      return {
        assistantMessage: summarizeContent(currentFile.content),
        fileActions,
        previewContent: currentFile.content,
      };
    }

    if (hasKeyword(normalized, prompt, ["rewrite", "改写", "重写", "润色"])) {
      if (!currentFile) {
        return {
          assistantMessage: "请先选择一个文件，再执行改写。",
          fileActions,
        };
      }

      const rewritten = rewriteAsCleanDraft(currentFile.content);
      const targetPath = withSuffix(currentFile.path, "-rewrite");

      return {
        assistantMessage: `已经为 ${currentFile.name} 生成改写稿。确认后将写入 ${targetPath}。`,
        fileActions,
        pendingWrite: {
          path: targetPath,
          content: rewritten,
          reason: "将当前文件改写为更清晰的草稿",
        },
      };
    }

    if (hasKeyword(normalized, prompt, ["generate", "create", "生成", "新建", "创建"])) {
      const targetPath = extractTargetPath(prompt) ?? "generated/generated-doc.md";
      const content = generateDocumentFromPrompt(prompt, currentFile?.content);
      const pendingWrite: PendingWrite = {
        path: targetPath,
        content,
        reason: "根据当前需求生成新文档",
      };

      return {
        assistantMessage: `已经生成新文档草稿。确认后将写入 ${targetPath}。`,
        fileActions,
        pendingWrite,
      };
    }

    if (hasKeyword(normalized, prompt, ["read", "读取", "打开"]) && context.recentFiles[0]) {
      const file = await this.fsAdapter.readFile(context.recentFiles[0]);
      fileActions.push({
        type: "read",
        path: file.path,
        timestamp: new Date().toISOString(),
      });
      return {
        assistantMessage: `已打开 ${file.name}。`,
        fileActions,
        currentFile: file,
        previewContent: file.content,
      };
    }

    return {
      assistantMessage:
        "请直接使用工具式指令，例如“总结当前文件”“改写当前文件”“生成文档”或“搜索 文件名”。这个工作台默认不是自由聊天模式。",
      fileActions,
    };
  }

  private async resolveCurrentFile(currentFile: FileRecord | null, fileActions: FileAction[]) {
    if (!currentFile) {
      return null;
    }

    fileActions.push({
      type: "read",
      path: currentFile.path,
      timestamp: new Date().toISOString(),
    });
    return currentFile;
  }

  private applyWorkingCopy(currentFile: FileRecord | null, currentContent?: string) {
    if (!currentFile || currentContent === undefined || currentContent === currentFile.content) {
      return currentFile;
    }

    return {
      ...currentFile,
      content: currentContent,
    };
  }
}

function withSuffix(path: string, suffix: string) {
  const index = path.lastIndexOf(".");
  if (index < 0) {
    return `${path}${suffix}`;
  }

  return `${path.slice(0, index)}${suffix}${path.slice(index)}`;
}

function extractTargetPath(prompt: string) {
  const match = prompt.match(/(?:named|to|到)\s+([A-Za-z0-9/_-]+\.[A-Za-z0-9]+)/i);
  return match?.[1];
}

function hasKeyword(normalized: string, original: string, keywords: string[]) {
  return keywords.some((keyword) =>
    /[a-z]/i.test(keyword) ? normalized.includes(keyword.toLowerCase()) : original.includes(keyword),
  );
}
