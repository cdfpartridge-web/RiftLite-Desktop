import type { RiftLiteAccountState } from "./accountIdentity.js";
import type { AccountConnectionStatus } from "./types.js";

export interface AccountOverview {
  title: string;
  description: string;
  status: string;
  tone: "ready" | "attention" | "neutral";
  action: "sign-in" | "finish-profile" | "check-connection" | "troubleshooting" | null;
}

export function accountOverview(
  state: RiftLiteAccountState,
  connection: Pick<AccountConnectionStatus, "connected" | "verified" | "migrationState"> | null
): AccountOverview {
  if (state === "linking") return {
    title: "Finish signing in", description: "Confirm your RiftLite account in the browser, then return here.",
    status: "Signing in", tone: "neutral", action: null
  };
  if (state === "local") return {
    title: "Create or sign in", description: "Use one RiftLite account for your profile, private groups and online replays. Your local matches stay on this computer.",
    status: "Local only", tone: "neutral", action: "sign-in"
  };
  if (state === "reconnect" || connection?.connected === false) return {
    title: "Reconnect your account", description: "Sign in again to use account features. Your existing account data and local matches are kept.",
    status: "Sign-in needed", tone: "attention", action: "sign-in"
  };
  if (state === "needs-profile") return {
    title: "Choose your RiftLite name", description: "Choose the name other players see and a unique handle for invitations.",
    status: "Name needed", tone: "attention", action: "finish-profile"
  };
  if (!connection?.verified) return {
    title: "Check your account connection", description: "Confirm that this desktop and the website are using the same RiftLite account.",
    status: "Check needed", tone: "attention", action: "check-connection"
  };
  if (connection.migrationState === "attention") return {
    title: "Your RiftLite account", description: "You are connected. Some older account data needs attention; review the connection details below.",
    status: "Data needs attention", tone: "attention", action: "troubleshooting"
  };
  return {
    title: "Your RiftLite account", description: "Your account is connected. Manage your name, public profile and optional backup here.",
    status: "Connected", tone: "ready", action: null
  };
}
