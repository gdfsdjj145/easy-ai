import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class ResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

if (!("ResizeObserver" in window)) {
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserver,
  });
}

if (!("scrollIntoView" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    writable: true,
    configurable: true,
    value: () => {},
  });
}

if (!("scrollTo" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    writable: true,
    configurable: true,
    value: () => {},
  });
}

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
  },
  Document: ({ children }: { children?: unknown }) => children,
  Page: ({ pageNumber }: { pageNumber?: number }) => `PDF page ${pageNumber ?? 1}`,
}));

const defaultRect = new DOMRect(0, 0, 12, 18);

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  writable: true,
  configurable: true,
  value: () => defaultRect,
});

Object.defineProperty(HTMLElement.prototype, "getClientRects", {
  writable: true,
  configurable: true,
  value: () => ({
    0: defaultRect,
    item: () => defaultRect,
    length: 1,
    [Symbol.iterator]: function* iterator() {
      yield defaultRect;
    },
  }),
});

const originalCreateRange = document.createRange.bind(document);

document.createRange = () => {
  const range = originalCreateRange();

  if (!("getBoundingClientRect" in range)) {
    Object.defineProperty(range, "getBoundingClientRect", {
      writable: true,
      configurable: true,
      value: () => defaultRect,
    });
  }

  if (!("getClientRects" in range)) {
    Object.defineProperty(range, "getClientRects", {
      writable: true,
      configurable: true,
      value: () => ({
        0: defaultRect,
        item: () => defaultRect,
        length: 1,
        [Symbol.iterator]: function* iterator() {
          yield defaultRect;
        },
      }),
    });
  }

  return range;
};
