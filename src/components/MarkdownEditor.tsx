import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  scrollPastEnd,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

interface MarkdownEditorProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}

function addMark(builder: RangeSetBuilder<Decoration>, from: number, to: number, className: string) {
  if (from >= to) {
    return;
  }

  builder.add(from, to, Decoration.mark({ class: className }));
}

function addLineClass(builder: RangeSetBuilder<Decoration>, from: number, className: string) {
  builder.add(from, from, Decoration.line({ attributes: { class: className } }));
}

function decorateInlineMarkdown(builder: RangeSetBuilder<Decoration>, lineFrom: number, text: string) {
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    addMark(builder, lineFrom + index, lineFrom + index + 1, "cm-md-syntax cm-md-code-syntax");
    addMark(builder, lineFrom + index + 1, lineFrom + index + match[0].length - 1, "cm-md-inline-code");
    addMark(
      builder,
      lineFrom + index + match[0].length - 1,
      lineFrom + index + match[0].length,
      "cm-md-syntax cm-md-code-syntax",
    );
  }

  for (const match of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    addMark(builder, lineFrom + index, lineFrom + index + 2, "cm-md-syntax");
    addMark(builder, lineFrom + index + 2, lineFrom + index + match[0].length - 2, "cm-md-strong");
    addMark(builder, lineFrom + index + match[0].length - 2, lineFrom + index + match[0].length, "cm-md-syntax");
  }

  for (const match of text.matchAll(/~~([^~]+)~~/g)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    addMark(builder, lineFrom + index, lineFrom + index + 2, "cm-md-syntax");
    addMark(builder, lineFrom + index + 2, lineFrom + index + match[0].length - 2, "cm-md-strike");
    addMark(builder, lineFrom + index + match[0].length - 2, lineFrom + index + match[0].length, "cm-md-syntax");
  }

  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }

    const label = match[1];
    const url = match[2];
    addMark(builder, lineFrom + index, lineFrom + index + 1, "cm-md-syntax");
    addMark(builder, lineFrom + index + 1, lineFrom + index + 1 + label.length, "cm-md-link");
    addMark(builder, lineFrom + index + 1 + label.length, lineFrom + index + 3 + label.length, "cm-md-syntax");
    addMark(builder, lineFrom + index + 3 + label.length, lineFrom + index + 3 + label.length + url.length, "cm-md-url");
    addMark(builder, lineFrom + index + 3 + label.length + url.length, lineFrom + index + match[0].length, "cm-md-syntax");
  }
}

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    let position = from;

    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const distance = Math.abs(line.number - activeLine);

      addLineClass(builder, line.from, distance === 0 ? "cm-md-active" : distance <= 1 ? "cm-md-near" : "cm-md-far");

      const headingMatch = text.match(/^(#{1,6})\s+/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        addLineClass(builder, line.from, `cm-md-heading cm-md-heading-${level}`);
        addMark(builder, line.from, line.from + headingMatch[0].length, "cm-md-syntax cm-md-heading-syntax");
      }

      const quoteMatch = text.match(/^>\s?/);
      if (quoteMatch) {
        addLineClass(builder, line.from, "cm-md-quote");
        addMark(builder, line.from, line.from + quoteMatch[0].length, "cm-md-syntax cm-md-quote-syntax");
      }

      const listMatch = text.match(/^(\s*)([-*+])\s+/);
      if (listMatch) {
        const markerFrom = line.from + listMatch[1].length;
        const markerTo = markerFrom + listMatch[2].length;
        addLineClass(builder, line.from, "cm-md-list");
        addMark(builder, markerFrom, markerTo, "cm-md-syntax cm-md-list-syntax");
      }

      if (text.length > 0) {
        decorateInlineMarkdown(builder, line.from, text);
      }

      if (line.to >= to) {
        break;
      }

      position = line.to + 1;
    }
  }

  return builder.finish();
}

const markdownPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

const markdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "#2c2c2b",
    fontSize: "16px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"Space Grotesk Variable", "Avenir Next", sans-serif',
    lineHeight: "2",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "0 0 38vh",
    caretColor: "#222221",
  },
  ".cm-line": {
    maxWidth: "920px",
    margin: "0 auto",
    padding: "0",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#1f1f1f",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(255, 211, 41, 0.28)",
  },
  ".cm-placeholder": {
    color: "#b8b1a6",
    fontStyle: "italic",
  },
  ".cm-md-syntax": {
    opacity: "0.16",
    fontWeight: "500",
    transition: "opacity 120ms ease, color 120ms ease",
  },
  ".cm-line.cm-md-near .cm-md-syntax": {
    opacity: "0.3",
  },
  ".cm-line.cm-md-active .cm-md-syntax": {
    opacity: "0.56",
  },
  ".cm-md-heading": {
    color: "#222221",
    fontFamily: '"Fraunces", serif',
    letterSpacing: "-0.03em",
  },
  ".cm-line.cm-md-heading-1": {
    fontSize: "3.4rem",
    fontWeight: "600",
    lineHeight: "1.08",
    marginTop: "0.1em",
    marginBottom: "0.35em",
  },
  ".cm-line.cm-md-heading-2": {
    fontSize: "2.55rem",
    fontWeight: "600",
    lineHeight: "1.16",
    marginTop: "0.35em",
    marginBottom: "0.25em",
  },
  ".cm-line.cm-md-heading-3": {
    fontSize: "1.85rem",
    fontWeight: "600",
    lineHeight: "1.22",
    marginTop: "0.3em",
  },
  ".cm-line.cm-md-heading-4": {
    fontSize: "1.4rem",
    fontWeight: "600",
  },
  ".cm-line.cm-md-heading-5, .cm-line.cm-md-heading-6": {
    fontSize: "1.12rem",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  ".cm-md-strong": {
    fontWeight: "700",
  },
  ".cm-md-strike": {
    textDecoration: "line-through",
    textDecorationThickness: "1.5px",
    textDecorationColor: "rgba(107, 98, 88, 0.38)",
  },
  ".cm-md-inline-code": {
    borderRadius: "0.42rem",
    backgroundColor: "rgba(232, 224, 212, 0.65)",
    color: "#4d3322",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.92em",
    padding: "0.08em 0.28em",
  },
  ".cm-md-code-syntax": {
    color: "#9d8875",
  },
  ".cm-line.cm-md-quote": {
    borderLeft: "3px solid #ddd4c6",
    paddingLeft: "18px",
    color: "#5c5852",
  },
  ".cm-md-quote-syntax": {
    opacity: "0.35",
  },
  ".cm-line.cm-md-list": {
    color: "#34312d",
  },
  ".cm-md-list-syntax": {
    color: "#b97c2e",
    opacity: "0.75",
  },
  ".cm-md-link": {
    color: "#2f4d88",
    textDecoration: "underline",
    textDecorationColor: "rgba(47, 77, 136, 0.28)",
    textUnderlineOffset: "0.14em",
  },
  ".cm-md-url": {
    color: "#8c877f",
  },
}, { dark: false });

export function MarkdownEditor({
  value,
  placeholder: placeholderValue = "在这里直接编辑 Markdown 内容…",
  onChange,
  onSave,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          scrollPastEnd(),
          EditorView.lineWrapping,
          placeholder(placeholderValue),
          markdownPreviewPlugin,
          markdownEditorTheme,
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.contentAttributes.of({
            "aria-label": "Markdown 编辑器",
            "aria-multiline": "true",
            "data-testid": "markdown-editor",
            spellcheck: "false",
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholderValue]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }, [value]);

  return <div ref={containerRef} className="h-full min-h-0 flex-1" />;
}
