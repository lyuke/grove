import { useCallback, useEffect, useRef } from "react";
import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { GitDiff } from "../../shared/types";

self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "json"
      ? new JsonWorker()
      : ["css", "scss", "less"].includes(label)
        ? new CssWorker()
        : ["html", "handlebars", "razor"].includes(label)
          ? new HtmlWorker()
          : ["typescript", "javascript"].includes(label)
            ? new TsWorker()
            : new EditorWorker(),
};
loader.config({ monaco });
monaco.editor.defineTheme("grove-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "65796E", fontStyle: "italic" },
    { token: "string", foreground: "B8CD97" },
    { token: "keyword", foreground: "C2ADE0" },
  ],
  colors: {
    "editor.background": "#111916",
    "editor.foreground": "#D7E2DA",
    "editorLineNumber.foreground": "#475B50",
    "editorLineNumber.activeForeground": "#A9C9B5",
    "editor.selectionBackground": "#345246",
    "editor.lineHighlightBackground": "#18221D",
    "editorCursor.foreground": "#BBDD9D",
    "editorWidget.background": "#1B2721",
    "editorIndentGuide.background1": "#24322B",
  },
});
monaco.editor.defineTheme("grove-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#F8FAF6",
    "editorLineNumber.foreground": "#9AA69B",
    "editor.lineHighlightBackground": "#EFF3EA",
    "editor.selectionBackground": "#D7E8CA",
  },
});
export function language(file: string) {
  const ext = file.split(".").pop()?.toLowerCase();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        json: "json",
        md: "markdown",
        css: "css",
        html: "html",
        py: "python",
        rs: "rust",
        go: "go",
        sh: "shell",
        zsh: "shell",
        yml: "yaml",
        yaml: "yaml",
        toml: "ini",
        sql: "sql",
        lua: "lua",
        c: "c",
        h: "c",
        cpp: "cpp",
        swift: "swift",
        vue: "html",
      } as Record<string, string>
    )[ext || ""] || "plaintext"
  );
}
export interface OpenDocument {
  key: string;
  projectId: string;
  path: string;
  content: string;
  base: string;
  hash: string;
  external?: { content: string; hash: string };
  missing?: boolean;
  position?: { lineNumber: number; column: number };
}
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: '"SF Mono", Menlo, monospace',
  fontSize: 13,
  lineHeight: 22,
  minimap: { enabled: false },
  padding: { top: 16 },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderLineHighlight: "all",
  smoothScrolling: true,
  wordWrap: "off",
  bracketPairColorization: { enabled: true },
  // Monaco 0.52's occurrence scheduler rejects on rapid model disposal.
  // Syntax highlighting remains enabled; opt out of symbol occurrences.
  occurrencesHighlight: "off",
};
export default function Editor({
  doc,
  theme,
  onChange,
  onPosition,
  onSave,
}: {
  doc: OpenDocument;
  theme: string;
  onChange(value: string): void;
  onPosition(position: { lineNumber: number; column: number }): void;
  onSave(): void;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onSave, onPosition, onChange });
  callbacks.current = { onSave, onPosition, onChange };
  const handleChange = useCallback(
    (value: string | undefined) => callbacks.current.onChange(value || ""),
    [],
  );
  const listener = useRef<monaco.IDisposable | null>(null);
  useEffect(() => () => listener.current?.dispose(), []);
  useEffect(() => {
    const editor = editorRef.current;
    // Cursor events are persisted by the parent. Do not echo the same
    // position back: setPosition collapses a mouse or keyboard selection.
    if (doc.position && editor && !editor.getPosition()?.equals(doc.position)) {
      editor.setPosition(doc.position);
      editor.revealLineInCenterIfOutsideViewport(doc.position.lineNumber);
    }
  }, [doc.key, doc.position?.lineNumber, doc.position?.column]);
  return (
    <MonacoEditor
      path={`grove:///${doc.projectId}/${doc.path.split("/").map(encodeURIComponent).join("/")}`}
      language={language(doc.path)}
      value={doc.content}
      theme={`grove-${theme}`}
      onChange={handleChange}
      loading={<div className="muted center">正在打开编辑器…</div>}
      options={editorOptions}
      onMount={(editor) => {
        editorRef.current = editor;
        if (editor.getValue() !== doc.content) editor.setValue(doc.content);
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
          callbacks.current.onSave(),
        );
        if (doc.position) {
          editor.setPosition(doc.position);
          editor.revealLineInCenterIfOutsideViewport(doc.position.lineNumber);
        }
        listener.current?.dispose();
        listener.current = editor.onDidChangeCursorPosition((event) =>
          callbacks.current.onPosition({
            lineNumber: event.position.lineNumber,
            column: event.position.column,
          }),
        );
        editor.focus();
      }}
    />
  );
}
export function DiffView({
  diff,
  path,
  theme,
  sideBySide,
}: {
  diff: GitDiff;
  path: string;
  theme: string;
  sideBySide: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useEffect(() => {
    if (diff.binary || !host.current) return;
    const original = monaco.editor.createModel(diff.original, language(path));
    const modified = monaco.editor.createModel(diff.modified, language(path));
    const editor = monaco.editor.createDiffEditor(host.current, {
      theme: `grove-${theme}`,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: sideBySide,
      automaticLayout: true,
      fontSize: 13,
      lineHeight: 22,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12 },
      occurrencesHighlight: "off",
    });
    editor.setModel({ original, modified });
    instance.current = editor;
    return () => {
      // Detach first: disposing models while the diff widget still observes them causes an async Monaco error.
      editor.setModel(null);
      editor.dispose();
      original.dispose();
      modified.dispose();
      instance.current = null;
    };
  }, [path, diff.binary]);
  useEffect(() => {
    const model = instance.current?.getModel();
    if (model) {
      if (model.original.getValue() !== diff.original)
        model.original.setValue(diff.original);
      if (model.modified.getValue() !== diff.modified)
        model.modified.setValue(diff.modified);
    }
  }, [diff.original, diff.modified]);
  useEffect(() => {
    instance.current?.updateOptions({ renderSideBySide: sideBySide });
    monaco.editor.setTheme(`grove-${theme}`);
  }, [sideBySide, theme]);
  if (diff.binary)
    return (
      <div className="empty-state">
        <h2>二进制文件</h2>
        <p>此文件不支持文本 Diff，可在 Git 列表中暂存。</p>
      </div>
    );
  return <div ref={host} style={{ width: "100%", height: "100%" }} />;
}
