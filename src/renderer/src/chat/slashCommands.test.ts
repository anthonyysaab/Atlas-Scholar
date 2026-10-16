import { describe, expect, it } from "vitest";
import type { ThinkingSupport } from "@shared/types";
import { commandsFor, parseSlash, slashMenu, type SlashContext } from "./slashCommands";
import { nextLevel, thinkingLabel, toggledLevel } from "./thinking";

const TOGGLE: ThinkingSupport = { kind: "toggle", levels: ["auto", "off", "medium"] };
const LEVELS: ThinkingSupport = { kind: "levels", levels: ["auto", "off", "low", "medium", "high"] };

function ctx(support: ThinkingSupport, surface: SlashContext["surface"] = "chat"): SlashContext {
  return { surface, doc: null, thinking: { level: "auto", support } };
}

describe("slash commands", () => {
  it("parses a command and an argument prefix", () => {
    expect(parseSlash("/think hi", "chat")).toMatchObject({ name: "think", arg: "hi" });
    expect(parseSlash("/thi", "chat")).toMatchObject({ name: "thi", arg: null, command: null });
    expect(parseSlash("hello", "chat")).toBeNull();
  });

  it("offers each surface its own commands", () => {
    const chat = commandsFor("chat").map((entry) => entry.command);
    const links = commandsFor("links").map((entry) => entry.command);
    expect(chat).toContain("/study");
    expect(chat).not.toContain("/apply");
    expect(links).toEqual(expect.arrayContaining(["/think", "/models", "/apply", "/discard", "/clear"]));
    expect(links).not.toContain("/study");
  });

  it("lists matching commands, then a command's options after a space", () => {
    expect(slashMenu("/th", ctx(LEVELS)).map((entry) => entry.label)).toEqual(["/think"]);
    expect(slashMenu("/think ", ctx(LEVELS)).map((entry) => entry.label)).toEqual(["auto", "off", "low", "medium", "high"]);
    expect(slashMenu("/think h", ctx(LEVELS)).map((entry) => entry.label)).toEqual(["high"]);
  });

  it("shows on/off models only on, off and auto", () => {
    const entries = slashMenu("/think ", ctx(TOGGLE));
    expect(entries.map((entry) => entry.label)).toEqual(["auto", "off", "on"]);
    expect(entries.map((entry) => entry.completion)).toContain("/think on");
  });

  it("marks the current level", () => {
    const entries = slashMenu("/think ", { ...ctx(LEVELS), thinking: { level: "high", support: LEVELS } });
    expect(entries.find((entry) => entry.current)?.label).toBe("high");
  });
});

describe("thinking level helpers", () => {
  it("toggles between off and the last level that was on", () => {
    expect(toggledLevel("auto", LEVELS)).toBe("off");
    expect(toggledLevel("off", TOGGLE)).toBe("medium");
  });

  it("cycles through the model's levels", () => {
    expect(nextLevel("auto", TOGGLE)).toBe("off");
    expect(nextLevel("medium", TOGGLE)).toBe("auto");
    expect(thinkingLabel("medium", TOGGLE)).toBe("on");
    expect(thinkingLabel("medium", LEVELS)).toBe("medium");
  });
});
