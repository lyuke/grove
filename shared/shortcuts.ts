export const DEFAULT_TERMINAL_SHORTCUT = "Control+`";
const modifiers = ["Command", "Control", "Alt", "Shift"];
const reserved = new Set([
  "Command+O",
  "Command+S",
  "Command+Alt+S",
  "Command+W",
  "Command+Q",
  "Command+P",
  "Command+Shift+F",
  "Command+B",
  "Control+Shift+`",
  "Control+C",
  "Control+D",
  "Control+Z",
  "Command+C",
  "Command+V",
  "Command+X",
  "Command+A",
  "Command+Z",
  "Command+Shift+Z",
  "Command+H",
  "Command+Alt+H",
  "Command+M",
  "Command+F",
  "Command+Control+F",
  "Command+Alt+I",
]);
export function normalizeTerminalShortcut(value: string): string {
  const aliases: Record<string, string> = {
    command: "Command",
    cmd: "Command",
    control: "Control",
    ctrl: "Control",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
  };
  const raw = value.split("+").map((part) => part.trim());
  const rawKey = raw.pop() || "";
  const key =
    rawKey.length === 1 || /^f[0-9]+$/i.test(rawKey)
      ? rawKey.toUpperCase()
      : rawKey;
  const parts = raw.map((part) => aliases[part.toLowerCase()] || part);
  if (
    !parts.length ||
    parts.some((part) => !modifiers.includes(part)) ||
    new Set(parts).size !== parts.length ||
    !/^(?:[A-Z0-9`]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Backspace|Tab|Left|Right|Up|Down)$/.test(
      key,
    )
  )
    throw new Error("请使用修饰键（⌘、⌃、⌥、⇧）加字母、数字或功能键");
  if (parts.every((part) => part === "Shift"))
    throw new Error("快捷键需要包含 ⌘、⌃ 或 ⌥");
  const normalized = [
    ...modifiers.filter((part) => parts.includes(part)),
    key,
  ].join("+");
  if (reserved.has(normalized))
    throw new Error("此快捷键已用于其他操作，请换一个组合");
  return normalized;
}
export function shortcutFromKey(
  event: Pick<
    KeyboardEvent,
    "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
): string | null {
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : event.code === "Backquote"
        ? "`"
        : event.code.startsWith("Arrow")
          ? event.code.slice(5)
          : event.code;
  if (
    [
      "MetaLeft",
      "MetaRight",
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "ShiftLeft",
      "ShiftRight",
    ].includes(key)
  )
    return null;
  return [
    event.metaKey && "Command",
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export const displayShortcut = (value: string) =>
  value
    .replaceAll("Command", "⌘")
    .replaceAll("Control", "⌃")
    .replaceAll("Alt", "⌥")
    .replaceAll("Shift", "⇧")
    .replaceAll("+", " ");
