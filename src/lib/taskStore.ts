import type { TaskStoreSnapshot } from "../types";

const TASK_STORE_KEY = "easy-ai.tasks";

export const defaultTaskStoreSnapshot: TaskStoreSnapshot = {
  tasks: [],
  runs: [],
  messages: [],
  runEvents: [],
};

export function loadTaskStore(): TaskStoreSnapshot {
  const raw = localStorage.getItem(TASK_STORE_KEY);
  if (!raw) {
    return defaultTaskStoreSnapshot;
  }

  try {
    return {
      ...defaultTaskStoreSnapshot,
      ...JSON.parse(raw),
    } as TaskStoreSnapshot;
  } catch {
    return defaultTaskStoreSnapshot;
  }
}

export function saveTaskStore(snapshot: TaskStoreSnapshot) {
  localStorage.setItem(TASK_STORE_KEY, JSON.stringify(snapshot));
}
