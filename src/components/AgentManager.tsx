import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile } from "../../shared/types";
import { defaultAgents, validateAgents } from "../../shared/preferences";

export default function AgentManager({
  agents,
  onSave,
}: {
  agents?: AgentProfile[];
  onSave(agents: AgentProfile[]): void;
}) {
  const [drafts, setDrafts] = useState<AgentProfile[]>(() =>
    (agents || defaultAgents).map((agent) => ({
      ...agent,
      args: [...agent.args],
    })),
  );
  const [selected, setSelected] = useState(
    (agents || defaultAgents)[0]?.id || "",
  );
  const [message, setMessage] = useState("");
  const active = drafts.find((agent) => agent.id === selected);
  const update = (patch: Partial<AgentProfile>) => {
    setDrafts((current) =>
      current.map((agent) =>
        agent.id === selected ? { ...agent, ...patch } : agent,
      ),
    );
    setMessage("");
  };
  const add = (preset?: AgentProfile) => {
    const agent = {
      id: crypto.randomUUID(),
      name: preset?.name || "新 Agent",
      executable: preset?.executable || "",
      args: preset ? [...preset.args] : ["{prompt}"],
    };
    setDrafts((current) => [...current, agent]);
    setSelected(agent.id);
    setMessage("");
  };
  return (
    <div className="agent-manager">
      <h3>Agent 管理</h3>
      <p>
        配置目标机器上的可执行程序和启动参数。已创建的任务保留创建时的配置。
      </p>
      <div className="agent-list" aria-label="Agent 列表">
        {drafts.map((agent) => (
          <button
            key={agent.id}
            aria-pressed={selected === agent.id}
            onClick={() => setSelected(agent.id)}
          >
            {agent.name || "未命名 Agent"}
          </button>
        ))}
      </div>
      <div className="task-actions">
        <button
          className="secondary-button"
          disabled={drafts.length >= 30}
          onClick={() => add()}
        >
          <Plus size={14} />
          添加 Agent
        </button>
        {defaultAgents.map((preset) => (
          <button
            key={preset.id}
            disabled={drafts.length >= 30}
            onClick={() => add(preset)}
          >
            添加 {preset.name}
          </button>
        ))}
      </div>
      {active && (
        <div className="agent-fields">
          <label>
            Agent 名称
            <input
              value={active.name}
              maxLength={500}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label>
            可执行程序
            <input
              value={active.executable}
              maxLength={500}
              placeholder="codex 或 /绝对路径/agent"
              onChange={(event) => update({ executable: event.target.value })}
            />
          </label>
          <span>启动参数</span>
          <p>
            每行是一个独立参数，不需要加引号。{"{prompt}"}{" "}
            会替换为本次任务描述。
          </p>
          {active.args.map((arg, index) => (
            <div className="agent-argument" key={index}>
              <textarea
                rows={1}
                aria-label={`参数 ${index + 1}`}
                value={arg}
                onChange={(event) =>
                  update({
                    args: active.args.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  })
                }
              />
              <button
                className="icon-button"
                aria-label={`删除参数 ${index + 1}`}
                onClick={() =>
                  update({
                    args: active.args.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="task-actions">
            <button
              disabled={active.args.length >= 100}
              onClick={() => update({ args: [...active.args, ""] })}
            >
              添加参数
            </button>
            <button
              onClick={() => {
                setDrafts((current) =>
                  current.filter((agent) => agent.id !== selected),
                );
                setSelected(
                  drafts.find((agent) => agent.id !== selected)?.id || "",
                );
                setMessage("");
              }}
            >
              <Trash2 size={13} /> 删除 Agent
            </button>
          </div>
        </div>
      )}
      {!drafts.length && <p>尚未配置 Agent，点击「添加 Agent」开始。</p>}
      <button
        className="primary-button"
        onClick={() => {
          try {
            onSave(validateAgents(drafts));
            setMessage("Agent 配置已保存");
          } catch (error) {
            setMessage(String(error));
          }
        }}
      >
        保存 Agent 配置
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
