import { useEffect, useState } from "react";
import { FileSearch, Search } from "lucide-react";
import type { SearchHit } from "../../shared/types";
export default function SearchPanel({
  projectId,
  filenames = false,
  onOpen,
}: {
  projectId: string;
  filenames?: boolean;
  onOpen(path: string, line: number): void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setResults([]);
    setError("");
    setBusy(Boolean(query.trim()));
    const timer = setTimeout(() => {
      window.grove
        .search(projectId, query, filenames)
        .then((hits) => {
          if (alive) setResults(hits);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, projectId, filenames]);
  return (
    <div className="search-panel">
      <label className="search-input">
        <Search size={14} />
        <input
          autoFocus
          aria-label={filenames ? "按文件名搜索" : "搜索项目内容"}
          placeholder={filenames ? "输入文件名…" : "搜索项目内容…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0])
              onOpen(results[0].path, results[0].line);
          }}
        />
      </label>
      <div className="search-meta">
        {busy
          ? "搜索中…"
          : query
            ? `${results.length}${results.length === 200 ? "+" : ""} 个结果`
            : filenames
              ? "输入文件名以快速打开"
              : "搜索当前项目 · 忽略依赖与构建目录"}
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="search-results">
        {results.map((hit, index) => (
          <button
            key={`${hit.path}:${hit.line}:${index}`}
            className="search-result"
            onClick={() => onOpen(hit.path, hit.line)}
          >
            <span>
              <FileSearch size={13} />
              <strong>{hit.path}</strong>
              {!filenames && <em>{hit.line}</em>}
            </span>
            {!filenames && <code>{hit.text}</code>}
          </button>
        ))}
        {query && !busy && !results.length && !error && (
          <p className="panel-copy">没有匹配结果</p>
        )}
      </div>
    </div>
  );
}
