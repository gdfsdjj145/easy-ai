export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatRelativeTime(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(delta / 60000));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function fileExtension(path: string) {
  const segment = path.split("/").pop() ?? path;
  const index = segment.lastIndexOf(".");
  return index >= 0 ? segment.slice(index + 1).toLowerCase() : "";
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  apng: "image/apng",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function isImageExtension(extension: string) {
  return extension in IMAGE_MIME_BY_EXTENSION;
}

export function isPdfExtension(extension: string) {
  return extension === "pdf";
}

export function isDocxExtension(extension: string) {
  return extension === "docx";
}

export function isSpreadsheetExtension(extension: string) {
  return extension === "xlsx" || extension === "xls" || extension === "csv";
}

export function isBinaryPreviewExtension(extension: string) {
  return isImageExtension(extension) || isPdfExtension(extension) || isDocxExtension(extension) || isSpreadsheetExtension(extension);
}

export function mimeTypeForExtension(extension: string) {
  return IMAGE_MIME_BY_EXTENSION[extension] ?? DOCUMENT_MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}
