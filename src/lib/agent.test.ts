import { describe, expect, it } from "vitest";
import { LocalToolAgent } from "./agent";
import { MockFsAdapter } from "./fs/mockFsAdapter";

describe("LocalToolAgent", () => {
  it("summarizes the current file through the read tool", async () => {
    const adapter = new MockFsAdapter();
    const agent = new LocalToolAgent(adapter);
    const currentFile = await adapter.readFile("notes/brief.md");

    const result = await agent.run("总结当前文件", {
      currentFile,
      recentFiles: [currentFile.path],
    });

    expect(result.assistantMessage).toContain("摘要：");
    expect(result.fileActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "read",
          path: "notes/brief.md",
        }),
      ]),
    );
  });

  it("prepares a pending write for rewrites instead of writing immediately", async () => {
    const adapter = new MockFsAdapter();
    const agent = new LocalToolAgent(adapter);
    const currentFile = await adapter.readFile("notes/todo.txt");

    const result = await agent.run("改写当前文件", {
      currentFile,
      recentFiles: [currentFile.path],
    });

    expect(result.pendingWrite).toEqual(
      expect.objectContaining({
        path: "notes/todo-rewrite.txt",
      }),
    );
    expect(result.assistantMessage).toContain("确认后将写入");
  });
});
