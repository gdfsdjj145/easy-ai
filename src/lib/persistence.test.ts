import { beforeEach, describe, expect, it } from "vitest";
import { defaultSessionState, loadSessionState, saveSessionState } from "./persistence";

describe("session persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads defaults when no session is present", () => {
    expect(loadSessionState()).toEqual(defaultSessionState);
  });

  it("round-trips session state through localStorage", () => {
    const state = {
      ...defaultSessionState,
      activeWorkspaceId: "workspace-1",
      recentFiles: ["notes/brief.md"],
    };

    saveSessionState(state);

    expect(loadSessionState()).toEqual(state);
  });
});
