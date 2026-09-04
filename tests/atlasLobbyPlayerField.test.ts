import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATLAS_LOBBY_PLAYER_FIELD_PROBE,
  readAtlasLobbyPlayerField,
  type AtlasLobbyPlayerFieldState
} from "../src/shared/atlasLobbyPlayerField.js";

class LayoutElement {
  parentElement: LayoutElement | null = null;
  tagName = "DIV";
  type = "";
  disabled = false;
  readOnly = false;
  disabledByFieldset = false;
  classes = new Set<string>();
  attributes = new Map<string, string>();
  bounds = { width: 400, height: 44 };
  style = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible" };
  buttons: LayoutElement[] = [];

  get value(): never { throw new Error("The player name must never be read."); }
  checkVisibility(): never { throw new Error("Do not confuse zero-sized layout with intentional hiding."); }

  getBoundingClientRect() { return this.bounds; }
  querySelectorAll() { return this.buttons; }
  matches(selector: string): boolean {
    if (selector === ":disabled") return this.disabled || this.disabledByFieldset;
    return selector.split(",").some((part) => {
      const token = part.trim();
      if (token.startsWith(".")) return this.classes.has(token.slice(1));
      const attribute = /^\[([^=\]]+)(?:='([^']*)')?\]$/.exec(token);
      return Boolean(attribute && this.attributes.has(attribute[1]) &&
        (attribute[2] === undefined || this.attributes.get(attribute[1]) === attribute[2]));
    });
  }
  closest(selector: string): LayoutElement | null {
    for (let current: LayoutElement | null = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }
}

function fixture() {
  const panel = new LayoutElement();
  panel.classes.add("lobby-entry-panel");
  panel.bounds = { width: 412, height: 651 };
  const section = new LayoutElement();
  section.style.display = "grid";
  section.bounds = { width: 391, height: 95 };
  section.parentElement = panel;
  const field = new LayoutElement();
  field.tagName = "INPUT";
  field.type = "text";
  field.parentElement = section;
  field.bounds = { width: 391, height: 44 };
  panel.buttons = Array.from({ length: 4 }, () => {
    const button = new LayoutElement();
    button.tagName = "BUTTON";
    button.parentElement = panel;
    return button;
  });
  const surfaces: LayoutElement[] = [];
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    field: field as LayoutElement | null,
    querySelector(selector: string) {
      expect(selector).toBe("#right-rail-player-name");
      return this.field;
    },
    querySelectorAll(selector: string) {
      expect(selector).toContain("[role='dialog']");
      expect(selector).toContain(".gb-board");
      return surfaces;
    }
  };
  const window = {
    getComputedStyle(element: LayoutElement) {
      return { ...element.style, getPropertyValue: (name: string) => name === "content-visibility" ? element.style.contentVisibility : "" };
    }
  };
  const location = { href: "https://play.riftatlas.com/" };
  const sandbox = { URL, document, window, location };
  function read(): AtlasLobbyPlayerFieldState {
    return runInNewContext(ATLAS_LOBBY_PLAYER_FIELD_PROBE, sandbox, { timeout: 1_000 });
  }
  return { panel, section, field, surfaces, document, window, location, sandbox, read };
}

afterEach(() => vi.unstubAllGlobals());

describe("Atlas lobby player-field layout probe", () => {
  it("works both directly and serialized, without name, storage, token, or module access", () => {
    const page = fixture();
    vi.stubGlobal("document", page.document);
    vi.stubGlobal("window", page.window);
    vi.stubGlobal("location", page.location);
    expect(readAtlasLobbyPlayerField()).toBe("ready");
    expect(page.read()).toBe("ready");
    expect(ATLAS_LOBBY_PLAYER_FIELD_PROBE).not.toMatch(/(?:localStorage|sessionStorage|getToken|\.value\b|\.click\(|setAttribute\()/);
  });

  it("detects the native Chromium142 zero-size name section inside a healthy 412x651 sidebar", () => {
    const page = fixture();
    page.field.bounds = { width: 0, height: 0 };
    page.section.bounds = { width: 0, height: 0 };
    expect(page.read()).toBe("collapsed");
    page.field.bounds = { width: 391, height: 44 };
    page.section.bounds = { width: 391, height: 95 };
    expect(page.read()).toBe("ready");
  });

  it.each(["/", "/lobby", "/lobby/", "/en", "/en/lobby", "/zh-CN/", "/zh-CN/lobby?from=desktop"])("recognizes the idle lobby route %s", (path) => {
    const page = fixture();
    page.location.href = `https://play.riftatlas.com${path}`;
    expect(page.read()).toBe("ready");
  });

  it.each([
    "https://tcg-arena.fr/", "https://play.riftatlas.com.evil.example/", "http://play.riftatlas.com/",
    "https://play.riftatlas.com:444/", "https://clerk.riftatlas.com/", "https://play.riftatlas.com/game/ROOM",
    "https://play.riftatlas.com/zh-CN/play/ROOM", "https://play.riftatlas.com/room/ROOM",
    "https://play.riftatlas.com/sign-in", "https://play.riftatlas.com/decks", "not a URL"
  ])("never evaluates non-idle or non-Atlas URL %s", (url) => {
    const page = fixture();
    page.location.href = url;
    expect(page.read()).toBe("unavailable");
  });

  it("does not mistake missing or mismatched markup for a zero-size field", () => {
    const page = fixture();
    page.document.field = null;
    expect(page.read()).toBe("unavailable");
    page.document.field = page.field;
    page.field.type = "password";
    expect(page.read()).toBe("unavailable");
    page.field.type = "text";
    page.panel.classes.clear();
    expect(page.read()).toBe("unavailable");
  });

  it("leaves hydrating and background documents alone", () => {
    const page = fixture();
    page.document.readyState = "loading";
    expect(page.read()).toBe("unavailable");
    page.document.readyState = "complete";
    page.document.visibilityState = "hidden";
    expect(page.read()).toBe("blocked");
  });

  it.each(["hidden", "inert", "aria-hidden"])("does not repair an intentionally %s ancestor", (attribute) => {
    const page = fixture();
    page.field.bounds = { width: 0, height: 0 };
    page.section.attributes.set(attribute, attribute === "aria-hidden" ? "true" : "");
    expect(page.read()).toBe("blocked");
  });

  it.each([
    ["display", "none"], ["visibility", "hidden"], ["visibility", "collapse"],
    ["opacity", "0"], ["contentVisibility", "hidden"]
  ] as const)("respects ancestor CSS %s:%s", (property, value) => {
    const page = fixture();
    page.field.bounds = { width: 0, height: 0 };
    page.section.style[property] = value;
    expect(page.read()).toBe("blocked");
  });

  it.each(["disabled", "disabledByFieldset", "readOnly"] as const)("does not repair a %s name input during queue/auth transitions", (property) => {
    const page = fixture();
    page.field[property] = true;
    expect(page.read()).toBe("blocked");
  });

  it.each(["aria-busy", "aria-disabled"])("respects the input's %s ancestor", (attribute) => {
    const page = fixture();
    page.panel.attributes.set(attribute, "true");
    expect(page.read()).toBe("blocked");
  });

  it("blocks for a visible auth dialog, active board, or hosted-room console", () => {
    const page = fixture();
    const surface = new LayoutElement();
    page.surfaces.push(surface);
    expect(page.read()).toBe("blocked");
    surface.style.display = "none";
    expect(page.read()).toBe("ready");
  });

  it("requires real visible idle play buttons and a noncollapsed parent", () => {
    const page = fixture();
    page.field.bounds = { width: 0, height: 0 };
    page.panel.bounds = { width: 0, height: 0 };
    expect(page.read()).toBe("unavailable");
    page.panel.bounds = { width: 412, height: 651 };
    page.panel.buttons = [];
    expect(page.read()).toBe("unavailable");
  });

  it("does not accept hidden or tiny play buttons as proof of a ready lobby", () => {
    const page = fixture();
    page.panel.buttons[0].style.visibility = "hidden";
    page.panel.buttons[1].bounds = { width: 0, height: 0 };
    page.panel.buttons[2].attributes.set("hidden", "");
    expect(page.read()).toBe("unavailable");
  });

  it.each(["disabled", "aria-busy", "aria-disabled"])("leaves %s play actions untouched", (kind) => {
    const page = fixture();
    if (kind === "disabled") page.panel.buttons[0].disabled = true;
    else page.panel.buttons[0].attributes.set(kind, "true");
    expect(page.read()).toBe("blocked");
  });

  it("fails closed for incomplete geometry or DOM-read errors", () => {
    const page = fixture();
    page.field.bounds.width = Number.NaN;
    expect(page.read()).toBe("unavailable");
    page.document.querySelector = () => { throw new Error("Navigation in progress"); };
    expect(page.read()).toBe("unavailable");
  });
});
