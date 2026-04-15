import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the middle panel as a read-only markdown preview with ai input below", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click((await screen.findAllByText("brief.md"))[0].closest("button")!);

    expect(await screen.findByRole("heading", { level: 1, name: "Brief" })).toBeInTheDocument();
    expect(screen.getAllByText("Ship the AI workstation MVP this week.").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("输入提示信息以处理当前文档……")).toBeInTheDocument();
  });

  it("opens the settings view for agent configuration", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click(screen.getAllByRole("button", { name: "设置" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Agent Settings")).toBeInTheDocument();
    });
    expect(screen.getByText("默认 Agent")).toBeInTheDocument();
    expect(screen.getByText("应用更新")).toBeInTheDocument();
    expect(screen.getByText("自动更新仅支持桌面端 Tauri 应用；浏览器预览下不会检查 releases。")).toBeInTheDocument();
  });

  it("supports creating a file from the explorer actions", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click(screen.getAllByRole("button", { name: "新建文件" })[0]);
    const createInput = screen.getByRole("textbox", { name: "新建文件" });

    await user.clear(createInput);
    await user.type(createInput, "draft.md{enter}");

    await waitFor(() => {
      expect(screen.getAllByText("draft.md").length).toBeGreaterThan(0);
    });
  });

  it("supports creating a folder from the explorer actions", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click(screen.getAllByRole("button", { name: "新建文件夹" })[0]);
    const createInput = screen.getByRole("textbox", { name: "新建文件夹" });

    await user.clear(createInput);
    await user.type(createInput, "assets{enter}");

    await waitFor(() => {
      expect(screen.getAllByText("assets").length).toBeGreaterThan(0);
    });
  });

  it("supports renaming the selected explorer entry", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    fireEvent.contextMenu((await screen.findAllByText("brief.md"))[0].closest("button")!);
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const renameInput = screen.getByRole("textbox", { name: "重命名 brief.md" });

    await user.clear(renameInput);
    await user.type(renameInput, "brief-renamed.md{enter}");

    await waitFor(() => {
      expect(screen.getAllByText("brief-renamed.md").length).toBeGreaterThan(0);
    });
  });

  it("shows a folder-specific confirmation before deleting a directory", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    fireEvent.contextMenu((await screen.findAllByText("notes"))[0].closest("button")!);
    await user.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("确认删除文件夹“notes”及其全部内容吗？"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("个子项目"));

    confirmSpy.mockRestore();
  });

  it("does not open the file when using the context menu gesture", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    render(<App />);

    await screen.findAllByText("Mock Workspace");
    const fileButton = (await screen.findAllByText("brief.md"))[0].closest("button")!;

    fireEvent.click(fileButton, { ctrlKey: true });

    expect(screen.queryByRole("heading", { level: 1, name: "Brief" })).not.toBeInTheDocument();

    fireEvent.contextMenu(fileButton, { ctrlKey: true });

    expect(screen.getByRole("menu", { name: "brief.md 右键菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Brief" })).not.toBeInTheDocument();

    fireEvent.click(fileButton, { ctrlKey: true });

    expect(screen.getByRole("menu", { name: "brief.md 右键菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Brief" })).not.toBeInTheDocument();

    fireEvent.pointerDown(window, { button: 2 });

    expect(screen.getByRole("menu", { name: "brief.md 右键菜单" })).toBeInTheDocument();
  });
});
