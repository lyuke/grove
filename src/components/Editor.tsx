import { useCallback, useEffect, useRef, useState } from "react";
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
  loading = false,
}: {
  diff: GitDiff;
  path: string;
  theme: string;
  sideBySide: boolean;
  loading?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [computing, setComputing] = useState(true);
  const last = useRef({ original: "", modified: "", path: "" });
  const large = diff.original.length + diff.modified.length > 500000;
  useEffect(() => {
    if (diff.binary || !host.current) return;
    const original = monaco.editor.createModel("", "plaintext");
    const modified = monaco.editor.createModel("", "plaintext");
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
      renderOverviewRuler: false,
      maxComputationTime: 5000,
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: 4,
        minimumLineCount: 12,
      },
    });
    const updated = editor.onDidUpdateDiff(() => setComputing(false));
    editor.setModel({ original, modified });
    last.current = { original: "", modified: "", path: "" };
    instance.current = editor;
    return () => {
      updated.dispose();
      editor.setModel(null);
      editor.dispose();
      original.dispose();
      modified.dispose();
      instance.current = null;
    };
  }, [diff.binary]);
  useEffect(() => {
    if (loading) return;
    const model = instance.current?.getModel();
    if (!model) return;
    const changed =
      last.current.original !== diff.original ||
      last.current.modified !== diff.modified;
    setComputing(changed);
    const lang = large ? "plaintext" : language(path);
    if (model.original.getLanguageId() !== lang)
      monaco.editor.setModelLanguage(model.original, lang);
    if (model.modified.getLanguageId() !== lang)
      monaco.editor.setModelLanguage(model.modified, lang);
    if (last.current.original !== diff.original)
      model.original.setValue(diff.original);
    if (last.current.modified !== diff.modified)
      model.modified.setValue(diff.modified);
    if (last.current.path !== path) {
      instance.current?.getOriginalEditor().setScrollTop(0);
      instance.current?.getModifiedEditor().setScrollTop(0);
    }
    last.current = { original: diff.original, modified: diff.modified, path };
  }, [diff.original, diff.modified, diff.binary, path, large, loading]);
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
  return (
    <div className="diff-view" data-diff-ready={!loading && !computing}>
      {(loading || computing || large) && (
        <div className="diff-progress" role="status">
          {loading
            ? "正在加载差异…"
            : computing
              ? "正在计算差异…"
              : "大文件使用纯文本差异；未修改区域已折叠，可按需展开。"}
        </div>
      )}
      <div
        ref={host}
        className="diff-host"
        style={{ visibility: loading ? "hidden" : undefined }}
      />
    </div>
  );
}
