import { useEffect, useState } from "react";
import { ListTodo, Plus, X } from "lucide-react";
import type { AgentTask, Settings } from "../../shared/types";
import { defaultAgents } from "../../shared/preferences";
import ProjectLocation from "./ProjectLocation";

const statuses = {
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
};
export default function TaskPanel({
  settings,
  onClose,
  onOpenTerminal,
}: {
  settings: Settings;
  onClose(): void;
  onOpenTerminal(task: AgentTask): Promise<void>;
}) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selected, setSelected] = useState("");
  const [followup, setFollowup] = useState("");
  const agents = settings.agents || defaultAgents;
  const target =
    settings.projects.find((project) => project.id === projectId) ||
    settings.projects.find(
      (project) => project.id === settings.activeProject,
    ) ||
    settings.projects[0];
  const agent = agents.find((item) => item.id === agentId) || agents[0];
  const detail = tasks.find((task) => task.id === selected);
  useEffect(() => {
    let disposed = false;
    const updates = new Map<string, AgentTask>();
    const off = window.grove.onTaskChange((task) => {
      updates.set(task.id, task);
      setTasks((current) =>
        [task, ...current.filter((item) => item.id !== task.id)].sort(
          (first, second) => second.createdAt.localeCompare(first.createdAt),
        ),
      );
    });
    void window.grove
      .tasks()
      .then((initial) => {
        if (!disposed)
          setTasks(
            [
              ...new Map([
                ...initial.map((task) => [task.id, task] as const),
                ...updates,
              ]).values(),
            ].sort((first, second) =>
              second.createdAt.localeCompare(first.createdAt),
            ),
          );
      })
      .catch((failure) => {
        if (!disposed) setError(String(failure));
      });
    return () => {
      disposed = true;
      off();
    };
  }, []);
  return (
    <aside
      className="tasks-pane"
      aria-label="任务系统"
      hidden={settings.tasksVisible === false}
    >
      <div className="project-title">
        <ListTodo size={15} />
        <span>任务</span>
        <span className="task-count">
          {tasks.filter((task) => task.status === "running").length} 执行中
        </span>
        <button
          className="icon-button"
          aria-label="创建任务"
          onClick={() => {
            setCreating(true);
            setSelected("");
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="收起任务列"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className="tasks-content">
        {error && (
          <p role="alert" className="task-error">
            {error}
          </p>
        )}
        {creating && (
          <form
            className="task-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!target || !agent || busy) return;
              setBusy(true);
              setError("");
              try {
                await window.grove.saveSettings({
                  agents,
                  taskSound: settings.taskSound,
                  taskNotifications: settings.taskNotifications,
                });
                const task = await window.grove.createTask({
                  title,
                  prompt,
                  projectId: target.id,
                  agentId: agent.id,
                });
                setSelected(task.id);
                setCreating(false);
                setTitle("");
                setPrompt("");
                if (task.terminalId) await onOpenTerminal(task);
              } catch (failure) {
                setError(String(failure));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              任务标题
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：修复登录页布局"
              />
            </label>
            <label>
              执行项目
              <select
                required
                aria-label="执行项目"
                value={target?.id || ""}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {!target && <option value="">请先添加项目</option>}
                {settings.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.remoteId ? "远端" : "本地"} · {project.name}
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <p className="task-target">
                <ProjectLocation remote={!!target.remoteId} />{" "}
                {target.remoteId
                  ? `${settings.remotes?.find((remote) => remote.id === target.remoteId)?.host}:`
                  : ""}
                {target.path}
              </p>
            )}
            <label>
              执行 Agent
              <select
                required
                aria-label="执行 Agent"
                value={agent?.id || ""}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {!agent && <option value="">请在设置中配置 Agent</option>}
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              任务描述
              <textarea
                required
                rows={5}
                maxLength={32000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述目标、约束和验收条件…"
              />
            </label>
            <p className="task-hint">
              在所选项目目录执行。Agent
              需已在目标机器安装并登录，使用其自身权限配置。
            </p>
            <div className="task-actions">
              <button
                className="primary-button"
                disabled={busy || !target || !agent}
                type="submit"
              >
                {busy ? "正在分配…" : "分配并执行"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                取消
              </button>
            </div>
          </form>
        )}
        {!tasks.length && !creating && (
          <div className="tasks-empty">
            <ListTodo size={28} />
            <h3>把下一步交给 Agent</h3>
            <p>选择本地或远端项目，创建任务并跟踪执行结果。</p>
            <button
              className="secondary-button"
              onClick={() => setCreating(true)}
            >
              创建第一个任务
            </button>
          </div>
        )}
        <div className="task-list">
          {tasks.map((task) => (
            <button
              key={task.id}
              className={`task-card ${selected === task.id ? "selected" : ""}`}
              aria-pressed={selected === task.id}
              onClick={() => {
                setSelected(selected === task.id ? "" : task.id);
                setFollowup("");
                setCreating(false);
              }}
            >
              <span className="task-card-top">
                <ProjectLocation remote={task.remote} />
                <span className={`task-status ${task.status}`}>
                  {statuses[task.status]}
                </span>
              </span>
              <strong>{task.title}</strong>
              <span>
                {task.agentName} · {task.projectName}
              </span>
              <time>{new Date(task.createdAt).toLocaleString()}</time>
            </button>
          ))}
        </div>
        {detail && (
          <section className="task-detail" aria-label="任务详情">
            <h3>{detail.title}</h3>
            <p className="task-target">{detail.target}</p>
            <p className="task-description">{detail.prompt}</p>
            <button
              className="secondary-button"
              disabled={!detail.terminalId}
              onClick={() =>
                void onOpenTerminal(detail).catch((failure) =>
                  setError(String(failure)),
                )
              }
            >
              进入任务终端
            </button>
            {detail.terminalId ? (
              <form
                className="task-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    const task = await window.grove.continueTask(
                      detail.id,
                      followup,
                    );
                    setFollowup("");
                    await onOpenTerminal(task);
                  } catch (failure) {
                    setError(String(failure));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  追加 Prompt
                  <textarea
                    required
                    maxLength={32000}
                    rows={3}
                    value={followup}
                    onChange={(event) => setFollowup(event.target.value)}
                    placeholder="输入下一步任务…"
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || detail.status === "running"}
                  type="submit"
                >
                  继续执行
                </button>
                <p className="task-hint">
                  每次追加会在同一终端启动该 Agent
                  命令。执行中可进入终端直接交互。
                </p>
              </form>
            ) : (
              <p className="task-hint">
                终端已关闭，保留执行记录；再次执行请创建新任务。
              </p>
            )}
            {(detail.prompts || []).slice(1).map((prompt, index) => (
              <p className="task-description" key={index}>
                追加 {index + 1}：{prompt}
              </p>
            ))}
            <p>
              {statuses[detail.status]}
              {detail.exitCode !== undefined
                ? ` · 退出码 ${detail.exitCode}`
                : ""}
            </p>
            <pre aria-label="任务输出">
              {detail.output || "等待 Agent 输出…"}
            </pre>
            <p className="task-hint">
              终端显示实时执行内容；此处保留最近输出。Agent
              退出后通知完成，终端继续保留。
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}
