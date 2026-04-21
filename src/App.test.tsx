import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders the middle panel as a conversation-first workspace", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");

    expect(screen.getByText("从这里开始对话")).toBeInTheDocument();
    expect(screen.getByText("输入提示开始对话；点击左栏文件可在右侧查看内容。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入提示开始对话，或处理当前工作区……")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Brief" })).not.toBeInTheDocument();
  });

  it("renders image files in the preview panel", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click((await screen.findAllByText("cover.svg"))[0].closest("button")!);

    expect(await screen.findByRole("img", { name: "cover.svg" })).toBeInTheDocument();
    expect(screen.getByText("图片预览")).toBeInTheDocument();
  });

  it("renders spreadsheet files in the preview panel", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Mock Workspace");
    await user.click((await screen.findAllByText("metrics.csv"))[0].closest("button")!);

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getAllByText("表格预览").length).toBeGreaterThan(0);
    expect(screen.getByText("Score")).toBeInTheDocument();
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

  it("opens the file preview on demand and supports resizing it", async () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const { container } = render(<App />);

    await screen.findAllByText("Mock Workspace");

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.style.gridTemplateColumns).toBe("292px minmax(0, 1fr) 0px");

    expect(container.querySelector('[aria-label="调整右栏宽度"]')).toBeNull();

    const user = userEvent.setup();
    await user.click((await screen.findAllByText("brief.md"))[0].closest("button")!);

    await waitFor(() => {
      expect(main?.style.gridTemplateColumns).toBe("292px minmax(0, 1fr) 420px");
    });

    const rightResizeHandle = container.querySelector('[aria-label="调整右栏宽度"]');
    expect(rightResizeHandle).not.toBeNull();

    fireEvent.pointerDown(rightResizeHandle!, { clientX: 1020 });
    const pointerMoveEvent = createEvent.pointerMove(window);
    Object.defineProperty(pointerMoveEvent, "clientX", {
      configurable: true,
      value: 960,
    });
    fireEvent(window, pointerMoveEvent);

    await waitFor(() => {
      expect(main?.style.gridTemplateColumns).toBe("292px minmax(0, 1fr) 480px");
    });

    fireEvent.pointerUp(window);
    rafSpy.mockRestore();
  });

  it("keeps the current file after manually closing preview and reopens on next file click", async () => {
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

    await user.click(screen.getAllByRole("button", { name: "关闭文件预览" })[0]);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 1, name: "Brief" })).not.toBeInTheDocument();
    });

    await user.click((await screen.findAllByText("brief.md"))[0].closest("button")!);

    expect(await screen.findByRole("heading", { level: 1, name: "Brief" })).toBeInTheDocument();
  });

  it("submits the composer on enter without crashing", async () => {
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

    const composerInput = screen.getByPlaceholderText("输入提示开始对话，或处理当前工作区……");
    await user.type(composerInput, "总结当前文件{enter}");

    expect(await screen.findByText(/摘要：/)).toBeInTheDocument();
    expect(screen.getByText("Local Agent")).toBeInTheDocument();
    expect(screen.getByText(/执行过程/)).toBeInTheDocument();
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
