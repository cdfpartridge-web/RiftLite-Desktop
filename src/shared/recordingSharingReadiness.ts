import type { HubHealthStatus, MatchDraft, ReplayRecord } from "./types.js";

/** The editable match is authoritative; a captured snapshot can predate result review. */
export function replayDiscordResultNeedsReview(replay: ReplayRecord, currentMatch?: MatchDraft): boolean {
  const match = currentMatch ?? replay.matchSnapshot;
  if (match) return match.status !== "saved" || !["Win", "Loss", "Draw"].includes(match.result);
  return replay.rawCapture?.discordResultReviewRequired === true;
}

export type DiscordDestinationReadiness = {
  state: "account" | "unknown" | "profile" | "server" | "channel" | "configured";
  label: string;
  detail: string;
  canEnableAutomaticSharing: boolean;
};

/** Describes known configuration only; permission to deliver is rechecked when posting. */
export function discordDestinationReadiness(input: {
  accountUid: string;
  accountVerified: boolean;
  hubId: string;
  health?: HubHealthStatus | null;
  error?: string;
}): DiscordDestinationReadiness {
  const result = (state: DiscordDestinationReadiness["state"], label: string, detail: string): DiscordDestinationReadiness => ({
    state, label, detail, canEnableAutomaticSharing: state === "configured"
  });
  if (!input.accountUid || !input.accountVerified) {
    return result("account", "Connect your account", "Use the same RiftLite account for your games and private hub membership.");
  }
  if (input.error) return result("unknown", "Connection could not be checked", input.error);
  const health = input.health;
  if (!health || health.hub.id !== input.hubId || ![health.account.uid, ...health.account.identityUids].includes(input.accountUid)) {
    return result("unknown", "Check connection", "Check this hub's current membership and Discord destination before enabling automatic sharing.");
  }
  if (!health.account.profileComplete) {
    return result("profile", "Finish your profile", "Choose your RiftLite handle and player name to finish account setup.");
  }
  if (!health.discord.configured || health.discord.guilds.length !== 1) {
    return result("server", "Server setup needed", "A hub admin must connect this private hub to one Discord server.");
  }
  const guild = health.discord.guilds[0];
  if (!guild.reportsChannelConfigured || !guild.reportsChannelId) {
    return result("channel", "Reports channel needed", "A server admin must choose a reports channel before replay links can be posted.");
  }
  // Discord verification and an automatic Discord role are not replay-posting prerequisites.
  return result("configured", "Reports channel configured", "Membership and a reports destination are confirmed. Channel access is checked again when a replay is posted.");
}

/** Discord snowflakes identify real server/channel routes. Do not construct links from arbitrary data. */
export function discordReportsChannelUrl(health?: HubHealthStatus | null): string | null {
  if (!health?.discord.configured || health.discord.guilds.length !== 1) return null;
  const guild = health.discord.guilds[0];
  if (!guild.reportsChannelConfigured || !/^\d{15,22}$/.test(guild.guildId) || !/^\d{15,22}$/.test(guild.reportsChannelId)) return null;
  return `https://discord.com/channels/${guild.guildId}/${guild.reportsChannelId}`;
}
