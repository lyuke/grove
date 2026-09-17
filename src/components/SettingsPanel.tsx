import { useEffect, useRef, useState } from "react";
import { X, Palette, PanelsTopLeft, Keyboard } from "lucide-react";
import type { Settings } from "../../shared/types";
import { normalizeTerminalShortcut } from "../../shared/shortcuts";
export default function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState("外观");
  const [shortcut, setShortcut] = useState(settings.terminalShortcut);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const themes = [
    {
      id: "dark",
      name: "Grove 深色",
      colors: ["#111916", "#bbdd9d", "#c2ade0"],
    },
    {
      id: "light",
      name: "Grove 浅色",
      colors: ["#f8faf6", "#587c3e", "#d7e0d1"],
    },
    { id: "nord", name: "Nord", colors: ["#2e3440", "#88c0d0", "#b48ead"] },
    {
      id: "catppuccin",
      name: "Catppuccin Mocha",
      colors: ["#1e1e2e", "#cba6f7", "#a6e3a1"],
    },
  ];
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-labelledby="settings-title"
    >
      <header>
        <div>
          <small>GROVE / PREFERENCES</small>
          <h2 id="settings-title">工作区设置</h2>
        </div>
        <button className="icon-button" aria-label="关闭设置" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
        <nav aria-label="设置分类">
          {(
            [
              ["外观", Palette],
              ["布局", PanelsTopLeft],
              ["快捷键", Keyboard],
            ] as const
          ).map(([name, Icon]) => (
            <button
              key={name}
              aria-pressed={section === name}
              onClick={() => setSection(name)}
            >
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        <section>
          {section === "外观" && (
            <>
              <h3>让工作区适合你的目光</h3>
              <p>配色同时应用于界面、编辑器和终端。</p>
              <div className="theme-grid">
                {themes.map((theme) => (
                  <button
                    key={theme.id}
                    aria-pressed={settings.theme === theme.id}
                    onClick={() =>
                      onChange({ theme: theme.id as Settings["theme"] })
                    }
                  >
                    <span
                      className="theme-preview"
                      style={{ background: theme.colors[0] }}
                    >
                      {theme.colors.slice(1).map((color) => (
                        <i key={color} style={{ background: color }} />
                      ))}
                    </span>
                    {theme.name}
                  </button>
                ))}
              </div>
              <p className="theme-attribution">
                开源配色：Nord、Catppuccin（MIT），按 Grove 界面适配。
              </p>
            </>
          )}
          {section === "布局" && (
            <>
              <h3>安排你的工作空间</h3>
              {["项目栏", "文件侧栏", "终端"].map((name, i) => (
                <label className="setting-row" key={name}>
                  {name}
                  <input
                    type="checkbox"
                    checked={!settings.collapsed[i]}
                    onChange={(e) =>
                      onChange({
                        collapsed: settings.collapsed.map((v, j) =>
                          i === j ? !e.target.checked : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <label className="setting-row">
                终端位置
                <select
                  value={settings.terminalDock}
                  onChange={(e) =>
                    onChange({
                      terminalDock: e.target.value as "bottom" | "right",
                    })
                  }
                >
                  <option value="bottom">下方</option>
                  <option value="right">右侧</option>
                </select>
              </label>
              <label className="setting-row">
                终端字号
                <input
                  aria-label="终端字号"
                  type="number"
                  min={9}
                  max={24}
                  value={settings.terminalFontSize}
                  onChange={(e) =>
                    onChange({
                      terminalFontSize: Math.max(
                        9,
                        Math.min(24, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
              <button
                className="secondary-button"
                onClick={() =>
                  onChange({
                    widths: [180, 245, 390],
                    collapsed: [false, false, false],
                    terminalDock: "bottom",
                    terminalWidth: 440,
                    terminalHeight: 280,
                    terminalMaximized: false,
                  })
                }
              >
                恢复默认布局
              </button>
            </>
          )}
          {section === "快捷键" && (
            <>
              <h3>终端快捷键</h3>
              <p>支持 Command、Control、Alt、Shift，例如 Command+J。</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const value = normalizeTerminalShortcut(shortcut);
                    onChange({ terminalShortcut: value });
                    setShortcut(value);
                    setError("");
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <input
                  aria-label="终端快捷键"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                />
                <button className="primary-button" type="submit">
                  应用快捷键
                </button>
              </form>
              {error && <p role="alert">{error}</p>}
              <button
                className="secondary-button"
                onClick={() => {
                  setShortcut("Control+`");
                  onChange({ terminalShortcut: "Control+`" });
                  setError("");
                }}
              >
                恢复默认快捷键
              </button>
              <p>⌘ P 快速打开 · ⌘ S 保存 · ⌘ B 文件侧栏</p>
            </>
          )}
        </section>
      </div>
      <footer>设置自动保存到此设备</footer>
    </dialog>
  );
}
