import { useEffect, useRef, useState } from "react";
import { X, Server } from "lucide-react";
import type { Project, RemoteConnection, RemoteInfo } from "../../shared/types";

const blank = (): RemoteConnection => ({
  id: "",
  name: "",
  host: "",
  nodePath: "node",
});
export default function RemotePanel({
  connections,
  onConnections,
  onProject,
  onClose,
}: {
  connections: RemoteConnection[];
  onConnections(value: RemoteConnection[]): void;
  onProject(project: Project): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<RemoteConnection>(connections[0] || blank());
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<RemoteConnection>) => {
    setForm((value) => ({ ...value, ...patch }));
    setEdited(true);
    setInfo(null);
  };
  const refresh = async () =>
    onConnections((await window.grove.settings()).remotes || []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog remote-dialog"
      aria-labelledby="remote-title"
      onCancel={onClose}
    >
      <header>
        <div>
          <small>GROVE / SSH</small>
          <h2 id="remote-title">远端连接</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭远端连接"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
        <nav aria-label="SSH 连接列表">
          {connections.map((connection) => (
            <button
              key={connection.id}
              disabled={busy}
              aria-pressed={form.id === connection.id}
              onClick={() => {
                setForm(connection);
                setEdited(false);
                setInfo(null);
                setError("");
                setNotice("");
                setProjectPath("");
              }}
            >
              <Server size={15} />
              {connection.name}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => {
              setForm(blank());
              setEdited(false);
              setInfo(null);
              setError("");
              setNotice("");
              setProjectPath("");
            }}
          >
            ＋ 新建连接
          </button>
        </nav>
        <section>
          <h3>通过 SSH 管理项目</h3>
          <p>
            支持 Linux / macOS，使用本机 SSH 配置、密钥或 Kerberos 票据。 远端需
            Node.js 18+；Git 与搜索分别需要 Git 和 ripgrep。
          </p>
          <label className="remote-project-path">
            SSH 配置文件（可选）
            <input
              disabled={busy}
              value={form.configFile || ""}
              onChange={(e) => change({ configFile: e.target.value })}
              placeholder="留空时使用 ~/.ssh/config"
            />
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const saved = await window.grove.saveRemote(form);
                setForm(saved);
                setEdited(false);
                await refresh();
                setNotice("连接配置已保存");
              });
            }}
          >
            <fieldset disabled={busy} className="remote-fields">
              <label className="remote-authentication">
                认证方式
                <select
                  aria-label="认证方式"
                  value={form.authentication || "ssh"}
                  onChange={(event) =>
                    change({
                      authentication: event.target.value as "ssh" | "kerberos",
                    })
                  }
                >
                  <option value="ssh">SSH 配置 / 密钥</option>
                  <option value="kerberos">Kerberos / Devbox</option>
                </select>
              </label>
              <label>
                连接名称
                <input
                  required
                  value={form.name}
                  onChange={(e) => change({ name: e.target.value })}
                  placeholder="开发服务器"
                />
              </label>
              <label>
                主机或 SSH 别名
                <input
                  required
                  value={form.host}
                  onChange={(e) => change({ host: e.target.value })}
                  placeholder="dev-server 或 192.168.1.10"
                />
              </label>
              <label>
                SSH 用户名
                <input
                  value={form.user || ""}
                  onChange={(e) => change({ user: e.target.value })}
                  placeholder="留空时使用 SSH 配置"
                />
              </label>
              <label>
                SSH 端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port ?? ""}
                  onChange={(e) =>
                    change({
                      port: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  placeholder="留空时使用 SSH 配置"
                />
              </label>
              <label>
                私钥路径
                <input
                  disabled={form.authentication === "kerberos"}
                  value={form.identityFile || ""}
                  onChange={(e) => change({ identityFile: e.target.value })}
                  placeholder="可选，例如 ~/.ssh/id_ed25519"
                />
              </label>
              <label>
                远端 Node.js 路径
                <input
                  value={form.nodePath || ""}
                  onChange={(e) => change({ nodePath: e.target.value })}
                  placeholder="node 或远端绝对路径"
                />
              </label>
            </fieldset>
            <div className="remote-actions">
              <button className="primary-button" disabled={busy} type="submit">
                保存连接
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || !form.id || edited}
                onClick={() =>
                  void run(async () => {
                    const result = await window.grove.testRemote(form.id);
                    setInfo(result);
                    if (!projectPath) setProjectPath(result.home);
                  })
                }
              >
                测试连接
              </button>
              {form.id && (
                <button
                  type="button"
                  className="secondary-button danger-text"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.grove.removeRemote(form.id);
                      setForm(blank());
                      setInfo(null);
                      await refresh();
                    })
                  }
                >
                  移除连接
                </button>
              )}
            </div>
          </form>
          {form.authentication === "kerberos" ? (
            <div className="remote-kerberos">
              <p>
                使用本机 Kerberos 票据进行 GSSAPI 认证，关闭公钥和密码认证。
                Devbox 请先连接研发网络或 VPN，在系统终端执行：
              </p>
              <code>/usr/bin/kinit 你的SSO账号@BYTEDANCE.COM</code>
              <p>
                票据过期后重新执行 kinit 即可重试。使用系统自带的 /usr/bin/kinit
                和 /usr/bin/klist，避免 Conda 环境影响。 Grove 不收集 Kerberos
                密码或保存票据内容。
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await window.grove.kerberosStatus();
                    if (result.valid) setNotice(result.message);
                    else setError(result.message);
                  })
                }
              >
                检查 Kerberos 票据
              </button>
            </div>
          ) : (
            <p>密钥口令请通过 ssh-agent 解锁；Grove 不保存密码或私钥内容。</p>
          )}
          <p>
            首次连接前，请先在系统终端通过 ssh
            登录并确认主机指纹；跳板机沿用本机 SSH 配置。
          </p>
          {info && (
            <p role="status">
              已连接 {info.hostname} · Node {info.node} · Git{" "}
              {info.git ? "可用" : "未安装"} · 搜索{" "}
              {info.search ? "可用" : "需安装 rg"}
            </p>
          )}
          <h3>添加远端项目</h3>
          <label className="remote-project-path">
            远端项目路径
            <input
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder="/home/user/project 或 ~/project"
              disabled={busy}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || !form.id || edited || !projectPath.trim()}
            onClick={() =>
              void run(async () => {
                const project = await window.grove.addRemoteProject(
                  form.id,
                  projectPath,
                );
                onProject(project);
                onClose();
              })
            }
          >
            打开远端项目
          </button>
          {busy && <p role="status">正在连接远端…</p>}
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </dialog>
  );
}
