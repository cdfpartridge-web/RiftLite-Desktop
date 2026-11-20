import { parseFirstRunSetupState, shouldStartFirstRunSetup, type FirstRunSetupContext } from "./firstRunSetup.js";
import type { UserSettings } from "./types.js";

export const NEW_PLAYER_WELCOME_KEY = "riftlite.ui.new-player-welcome";
export type NewPlayerWelcomeChoice = "learn" | "setup";

export function parseNewPlayerWelcomeChoice(raw: unknown): NewPlayerWelcomeChoice | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && value.version === 1 && (value.choice === "learn" || value.choice === "setup") ? value.choice : null;
  } catch { return null; }
}

export function serializeNewPlayerWelcomeChoice(choice: NewPlayerWelcomeChoice): string {
  return JSON.stringify({ version: 1, choice });
}

/** Learning is separate from setup completion and from recording/account consent. */
export function newPlayerFirstRunEntry(
  settings: Pick<UserSettings, "firstRunComplete" | "username" | "accountUid">,
  context: FirstRunSetupContext,
  choice: NewPlayerWelcomeChoice | null
): "welcome" | "setup" | "new-player" | null {
  if (settings.firstRunComplete) return null;
  if (choice === "learn") return "new-player";
  if (!shouldStartFirstRunSetup(settings, context)) return null;
  return choice === "setup" || parseFirstRunSetupState(context.setupState)?.status === "active" ? "setup" : "welcome";
}
