export const GAME_WEBVIEW_EVENT_NAMES = [
  "ipc-message",
  "dom-ready",
  "did-finish-load",
  "did-navigate",
  "did-navigate-in-page",
  "did-start-loading"
] as const;

export type GameWebviewEventName = (typeof GAME_WEBVIEW_EVENT_NAMES)[number];

export type GameWebviewIpcMessageEvent = Event & {
  channel?: string;
  args?: unknown[];
};

export interface GameWebviewEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface GameWebviewEventHandlers {
  onIpcMessage(event: GameWebviewIpcMessageEvent): void;
  onDomReady(event: Event): void;
  onDidFinishLoad(event: Event): void;
  onDidNavigate(event: Event): void;
  onDidNavigateInPage(event: Event): void;
  onDidStartLoading(event: Event): void;
}

/**
 * Electron webviews emit literal hyphenated event names. React-style custom
 * element props do not reliably subscribe to those events, so bind them on the
 * underlying WebviewTag instead.
 */
export function bindGameWebviewEvents(
  target: GameWebviewEventTarget,
  handlers: GameWebviewEventHandlers
): () => void {
  const bindings: ReadonlyArray<readonly [GameWebviewEventName, EventListener]> = [
    ["ipc-message", (event) => handlers.onIpcMessage(event as GameWebviewIpcMessageEvent)],
    ["dom-ready", (event) => handlers.onDomReady(event)],
    ["did-finish-load", (event) => handlers.onDidFinishLoad(event)],
    ["did-navigate", (event) => handlers.onDidNavigate(event)],
    ["did-navigate-in-page", (event) => handlers.onDidNavigateInPage(event)],
    ["did-start-loading", (event) => handlers.onDidStartLoading(event)]
  ];

  for (const [name, listener] of bindings) {
    target.addEventListener(name, listener);
  }

  let isBound = true;
  return () => {
    if (!isBound) {
      return;
    }
    isBound = false;

    for (const [name, listener] of bindings) {
      target.removeEventListener(name, listener);
    }
  };
}
