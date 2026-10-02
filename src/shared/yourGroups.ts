import type { HubInboxItem, SocialTeamInvite, SocialTeamProfile, UserSettings } from "./types.js";

export type YourGroupsTab = "teams" | "hubs" | "invitations";
export type GroupKind = "team" | "hub";
export interface GroupInvitation {
  key: string;
  kind: GroupKind;
  inviteId: string;
  groupId: string;
  groupName: string;
  senderName: string;
  createdAt: number;
  expiresAt: number;
  status: SocialTeamInvite["status"];
}

/** Endpoints already scope invitations to the authenticated account. Names and
 * handles are display data, never evidence that two groups or accounts match. */
export function selectGroupInvitations(teams: readonly SocialTeamInvite[], hubs: readonly HubInboxItem[], now = Date.now()): GroupInvitation[] {
  const rows: GroupInvitation[] = [
    ...teams.filter((invite) => Boolean(invite.targetHandle.trim())).map((invite): GroupInvitation => ({
      key: `team:${invite.inviteId}`, kind: "team", inviteId: invite.inviteId, groupId: invite.teamId,
      groupName: invite.teamName, senderName: invite.senderName, createdAt: invite.createdAt,
      expiresAt: invite.expiresAt, status: invite.status,
    })),
    ...hubs.filter((invite) => invite.type === "hub-invite").map((invite): GroupInvitation => ({
      key: `hub:${invite.inviteId}`, kind: "hub", inviteId: invite.inviteId, groupId: invite.hubId,
      groupName: invite.hubName, senderName: invite.senderDisplayName || invite.senderHandle,
      createdAt: invite.createdAt, expiresAt: invite.expiresAt, status: invite.status,
    })),
  ];
  const unique = new Map<string, GroupInvitation>();
  for (const row of rows) {
    if (!row.inviteId || !row.groupId) continue;
    const normalized = row.status === "open" && !(Number.isFinite(row.expiresAt) && row.expiresAt > now)
      ? { ...row, status: "expired" as const } : row;
    const previous = unique.get(row.key);
    if (!previous || normalized.createdAt > previous.createdAt ||
      (normalized.createdAt === previous.createdAt && previous.status === "open" && normalized.status !== "open")) unique.set(row.key, normalized);
  }
  return [...unique.values()].sort((left, right) => Number(right.status === "open") - Number(left.status === "open") ||
    right.createdAt - left.createdAt || left.key.localeCompare(right.key));
}

/** Only the membership endpoint determines Your teams. Saved sync targets and
 * similarly named private hubs must never imply team membership. */
export function selectGroupTeams(directory: readonly SocialTeamProfile[], memberships: readonly SocialTeamProfile[]) {
  const joined = [...new Map(memberships.filter((team) => team.id).map((team) => [team.id, team])).values()];
  const joinedIds = new Set(joined.map((team) => team.id));
  const discover = [...new Map(directory.filter((team) => team.id && team.visibility === "public" && !joinedIds.has(team.id))
    .map((team) => [team.id, team])).values()];
  return { joined, discover };
}

export function groupsAccountScope(settings: Pick<UserSettings, "accountUid" | "firebaseUid" | "firebaseCredentialGeneration" | "firebaseRefreshToken">): string {
  return settings.accountUid && settings.firebaseRefreshToken
    ? JSON.stringify([settings.accountUid, settings.firebaseUid, settings.firebaseCredentialGeneration]) : "";
}
