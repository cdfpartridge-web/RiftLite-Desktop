const NON_GAME_PACKET_TYPES = new Set([
  "auth", "ready", "auth_session", "auth_refresh", "ping", "pong",
  "presence_event", "presence_update", "chat_sync", "chat_append", "chat_send",
  "judge_call_sync", "spectator_roster_sync", "customization_refresh",
  "join_shell", "room_shell_sync", "room_shell_action", "room_shell_action_ack",
  "room_shell_leave", "setup_log_sync", "search", "searching"
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Only suppress sources proven to contain connection/lobby traffic alone.
 * Unknown packets, damaged data and any game/setup evidence stay reviewable. */
export function isAtlasConnectionOrLobbyCapture(value: unknown): boolean {
  const source = record(value);
  if (source?.schema !== "riftreplay-raw-capture" || source.version !== 1) return false;
  const capture = record(source.capture);
  const lifecycle = record(capture?.lifecycle);
  if (!capture || !lifecycle || !Array.isArray(source.messages) || !source.messages.length) return false;
  const lobbyPhase = (phase: unknown) => phase == null || phase === "" || phase === "lobby";
  if (!lobbyPhase(lifecycle.lastPhase)) return false;
  if (Number(lifecycle.lastGameNumber) > 1) return false;
  if (!Array.isArray(lifecycle.phases) || !Array.isArray(lifecycle.games)) return false;
  const phases = [...lifecycle.phases];
  for (const game of lifecycle.games) {
    const entry = record(game);
    if (!entry || Number(entry.gameNumber) > 1 || !Array.isArray(entry.phases)) return false;
    phases.push(...entry.phases);
  }
  if (phases.some((phase) => !record(phase) || !lobbyPhase(record(phase)?.phase))) return false;
  return source.messages.every((message) => {
    const frame = record(message);
    if (typeof frame?.raw !== "string") return false;
    let packet: Record<string, unknown> | null;
    try { packet = record(JSON.parse(frame.raw)); } catch { return false; }
    if (!packet || typeof packet.type !== "string" || !NON_GAME_PACKET_TYPES.has(packet.type)) return false;
    if (packet.type !== "room_shell_sync") return true;
    const session = record(packet.sessionDoc) ?? record(record(packet.payload)?.sessionDoc) ?? packet;
    return session.phase === "lobby" && !(Number(session.gameNumber ?? session.game_number ?? session.game) > 1);
  });
}
