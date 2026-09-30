import type { AgentProfile, Settings } from "./types";

export const defaultAgents: AgentProfile[] = [
  {
    id: "codex",
    name: "Codex",
    executable: "codex",
    args: ["exec", "{prompt}"],
  },
  {
    id: "claude",
    name: "Claude Code",
    executable: "claude",
    args: ["-p", "{prompt}"],
  },
];
export const paletteKeys = [
  "local",
  "remote",
  "title",
  "projects",
  "explorer",
  "editor",
  "terminal",
  "tabbar",
  "input",
  "raised",
  "text",
  "secondary",
  "muted",
  "border",
  "subtle",
  "hover",
  "selected",
  "selected-border",
  "accent",
  "accent-hover",
  "accent-text",
  "folder",
  "danger",
  "warning",
  "warning-bg",
  "welcome-glow",
  "scrollbar",
];
export function validatePalette(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("colors 必须是颜色对象");
  const result: Record<string, string> = {};
  for (const [key, color] of Object.entries(value)) {
    if (!paletteKeys.includes(key)) throw new Error(`未知颜色：${key}`);
    if (
      typeof color !== "string" ||
      !/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(color)
    )
      throw new Error(`${key} 必须是 #RRGGBB 或 #RRGGBBAA`);
    result[key] = color;
  }
  return result;
}
export function parsePalette(
  text: string,
): Pick<Settings, "theme" | "palette"> {
  const value = JSON.parse(text);
  if (
    !value ||
    value.version !== 1 ||
    !["dark", "light", "nord", "catppuccin"].includes(value.theme)
  )
    throw new Error("配色配置需要 version: 1 和有效的 theme");
  return { theme: value.theme, palette: validatePalette(value.colors) };
}
export function validateAgents(value: unknown): AgentProfile[] {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error("Agent 配置必须是数组，最多 30 项");
  const ids = new Set<string>();
  return value.map((agent) => {
    if (
      !agent ||
      ![agent.id, agent.name, agent.executable].every(
        (item) =>
          typeof item === "string" &&
          item.trim() &&
          item.length <= 500 &&
          !/[\0\r\n]/.test(item),
      ) ||
      ids.has(agent.id)
    )
      throw new Error("Agent 的 id、name、executable 不能为空，id 不能重复");
    if (
      !Array.isArray(agent.args) ||
      agent.args.length > 100 ||
      !agent.args.every(
        (arg: unknown) =>
          typeof arg === "string" && arg.length < 10000 && !arg.includes("\0"),
      ) ||
      !agent.args.some((arg: string) => arg.includes("{prompt}"))
    )
      throw new Error("args 必须是字符串数组，并包含 {prompt} 占位符");
    ids.add(agent.id);
    return {
      id: agent.id,
      name: agent.name,
      executable: agent.executable,
      args: agent.args,
    };
  });
}
