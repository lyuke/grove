import { describe, it, expect } from "vitest";
import {
  normalizeTerminalShortcut,
  shortcutFromKey,
} from "../shared/shortcuts";
describe("terminal shortcut validation", () => {
  it("canonicalizes modifier order and supports the default", () => {
    expect(normalizeTerminalShortcut("Shift+Command+J")).toBe(
      "Command+Shift+J",
    );
    expect(normalizeTerminalShortcut("Control+`")).toBe("Control+`");
    expect(normalizeTerminalShortcut("cmd+j")).toBe("Command+J");
  });
  it("rejects reserved operations and invalid input", () => {
    for (const value of [
      "Command+Q",
      "Command+S",
      "Shift+A",
      "J",
      "Control+Control+J",
      "Control+Bogus",
      "Command+Alt+S",
    ])
      expect(() => normalizeTerminalShortcut(value)).toThrow();
  });
  it("uses physical keys for punctuation with modifiers", () => {
    expect(
      shortcutFromKey({
        code: "Backquote",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("Control+`");
  });
});
