export function summarizeContent(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "文件内容为空，当前没有可总结的信息。";
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const primary = sentences.slice(0, 2).join(" ");
  const words = normalized.split(" ").length;

  return `摘要：${primary || normalized.slice(0, 180)}\n\n关键信号：约 ${words} 个词，${Math.max(sentences.length, 1)} 个句段。`;
}

export function rewriteAsCleanDraft(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "未命名草稿\n\n原文件没有可直接复写的内容，建议先写一句目标说明，再逐步展开。";
  }

  const intro = lines.slice(0, 3).join(" ");
  const bullets = lines.slice(0, 5).map((line) => `- ${line.replace(/^[-*]\s*/, "")}`);

  return [`改写草稿`, ``, intro, ``, `要点`, ...bullets].join("\n");
}

export function generateDocumentFromPrompt(prompt: string, basis?: string) {
  const cleaned = prompt.trim() || "new document";
  const context = basis?.trim();

  return [
    `# ${cleaned.replace(/^[a-z]/, (char) => char.toUpperCase())}`,
    ``,
    `## 目标`,
    `围绕这个需求生成一份可直接继续编辑的初稿：${cleaned}。`,
    ``,
    `## 结构`,
    `- 核心信息`,
    `- 支撑细节`,
    `- 下一步行动`,
    context ? `` : undefined,
    context ? `## 参考上下文` : undefined,
    context ? context.slice(0, 240) : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
