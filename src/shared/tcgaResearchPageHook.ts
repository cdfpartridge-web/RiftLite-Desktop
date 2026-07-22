export const TCGA_REPLAY_RESEARCH_BINDING = "__riftliteTcgaReplayResearchRecord";
export const TCGA_REPLAY_RESEARCH_HOOK_KEY = "__riftliteTcgaReplayResearchHookV2";

/**
 * Runs in TCGA's main JavaScript world through the Chromium debugger. The game
 * uses PeerJS/WebRTC data channels, which are not visible to the ordinary
 * WebSocket/fetch hooks in the isolated Electron preload.
 */
export function tcgaReplayResearchPageHookSource(active = false, sessionId = ""): string {
  const bindingName = JSON.stringify(TCGA_REPLAY_RESEARCH_BINDING);
  const hookKey = JSON.stringify(TCGA_REPLAY_RESEARCH_HOOK_KEY);
  const requestedActive = active ? "true" : "false";
  const requestedSessionId = JSON.stringify(sessionId.slice(0, 128));
  return `(() => {
    try { if (globalThis.top !== globalThis) return false; } catch { return false; }
    const bindingName = ${bindingName};
    const hookKey = ${hookKey};
    const requestedActive = ${requestedActive};
    const requestedSessionId = ${requestedSessionId};
    const createDocumentId = () => {
      try {
        const uuid = globalThis.crypto && globalThis.crypto.randomUUID;
        if (typeof uuid === "function") return "document-" + uuid.call(globalThis.crypto);
      } catch {}
      return "document-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    };
    const existing = globalThis[hookKey];
    if (existing && existing.version === 2) {
      if (!existing.documentId) existing.documentId = createDocumentId();
      existing.active = requestedActive;
      existing.sessionId = requestedSessionId;
      if (requestedActive) existing.emit("hook-resumed", {});
      return true;
    }

    const state = {
      version: 2,
      documentId: createDocumentId(),
      active: requestedActive,
      sessionId: requestedSessionId,
      sequence: 0,
      channels: new WeakSet(),
      channelIds: new WeakMap(),
      nextChannelId: 1,
      peers: new WeakSet(),
      emit(kind, payload, originatingDocumentId = state.documentId) {
        if (!state.active) return;
        try {
          const binding = globalThis[bindingName];
          if (typeof binding !== "function") return;
          binding(JSON.stringify({
            schema: "riftlite-tcga-page-research",
            version: 1,
            hookSequence: state.sequence++,
            documentId: originatingDocumentId,
            sessionId: state.sessionId,
            capturedAt: new Date().toISOString(),
            monotonicMs: typeof performance !== "undefined" ? performance.now() : 0,
            kind,
            payload
          }));
        } catch {
          // Research capture must never affect the simulator.
        }
      },
      stop() {
        state.emit("hook-stopped", {});
        state.active = false;
      }
    };
    globalThis[hookKey] = state;

    const MAX_TEXT_CHARS = 1000000;
    const MAX_BINARY_BYTES = 1000000;
    const channelDetails = (channel) => {
      let captureChannelId = state.channelIds.get(channel);
      if (!captureChannelId) {
        captureChannelId = "channel-" + state.nextChannelId++;
        state.channelIds.set(channel, captureChannelId);
      }
      return {
        captureChannelId,
        label: String(channel && channel.label || "").slice(0, 256),
        protocol: String(channel && channel.protocol || "").slice(0, 256),
        id: Number.isFinite(channel && channel.id) ? channel.id : null,
        ordered: channel && channel.ordered === true,
        negotiated: channel && channel.negotiated === true,
        readyState: String(channel && channel.readyState || "")
      };
    };
    const bytesPayload = (buffer) => {
      const source = new Uint8Array(buffer);
      const length = Math.min(source.byteLength, MAX_BINARY_BYTES);
      let binary = "";
      for (let offset = 0; offset < length; offset += 32768) {
        binary += String.fromCharCode(...source.subarray(offset, Math.min(length, offset + 32768)));
      }
      return {
        encoding: "base64",
        data: btoa(binary),
        byteLength: source.byteLength,
        truncated: source.byteLength > length
      };
    };
    const dataPayload = (value) => {
      if (typeof value === "string") {
        return Promise.resolve({
          encoding: "utf8",
          data: value.slice(0, MAX_TEXT_CHARS),
          charLength: value.length,
          truncated: value.length > MAX_TEXT_CHARS
        });
      }
      if (value instanceof ArrayBuffer) {
        return Promise.resolve(bytesPayload(value));
      }
      if (ArrayBuffer.isView(value)) {
        return Promise.resolve(bytesPayload(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
      }
      if (typeof Blob !== "undefined" && value instanceof Blob) {
        return value.arrayBuffer().then(bytesPayload, () => ({
          encoding: "blob-metadata",
          byteLength: value.size,
          mimeType: String(value.type || ""),
          unavailable: true
        }));
      }
      return Promise.resolve({
        encoding: "unknown",
        dataType: Object.prototype.toString.call(value)
      });
    };
    const emitData = (direction, channel, value) => {
      if (!state.active) return;
      if (!channel || String(channel.label || "") !== "game") return;
      const sequence = state.sequence++;
      const originatingDocumentId = state.documentId;
      const capturedAt = new Date().toISOString();
      const monotonicMs = typeof performance !== "undefined" ? performance.now() : 0;
      void dataPayload(value).then((data) => {
        state.emit("rtc-data", {
          transportSequence: sequence,
          transportCapturedAt: capturedAt,
          transportMonotonicMs: monotonicMs,
          direction,
          channel: channelDetails(channel),
          data
        }, originatingDocumentId);
      });
    };

    const channelPrototype = globalThis.RTCDataChannel && globalThis.RTCDataChannel.prototype;
    const originalChannelAddEventListener = channelPrototype && channelPrototype.addEventListener;
    const ensureChannel = (channel, source) => {
      if (!channel || String(channel.label || "") !== "game" || state.channels.has(channel)) return channel;
      state.channels.add(channel);
      state.emit("rtc-channel", { event: "observed", source, channel: channelDetails(channel) });
      if (typeof originalChannelAddEventListener === "function") {
        originalChannelAddEventListener.call(channel, "message", (event) => emitData("in", channel, event.data));
        originalChannelAddEventListener.call(channel, "open", () => state.emit("rtc-channel", { event: "open", channel: channelDetails(channel) }));
        originalChannelAddEventListener.call(channel, "close", () => state.emit("rtc-channel", { event: "close", channel: channelDetails(channel) }));
        originalChannelAddEventListener.call(channel, "error", () => state.emit("rtc-channel", { event: "error", channel: channelDetails(channel) }));
      }
      return channel;
    };

    if (channelPrototype && !channelPrototype.__riftliteTcgaResearchPatched) {
      Object.defineProperty(channelPrototype, "__riftliteTcgaResearchPatched", { value: true });
      const originalSend = channelPrototype.send;
      if (typeof originalSend === "function") {
        channelPrototype.send = function riftliteResearchSend(data) {
          emitData("out", ensureChannel(this, "send"), data);
          return originalSend.call(this, data);
        };
      }
      if (typeof originalChannelAddEventListener === "function") {
        channelPrototype.addEventListener = function riftliteResearchAddEventListener(type, listener, options) {
          if (type === "message") ensureChannel(this, "message-listener");
          return originalChannelAddEventListener.call(this, type, listener, options);
        };
      }
      const onMessage = Object.getOwnPropertyDescriptor(channelPrototype, "onmessage");
      if (onMessage && onMessage.configurable && typeof onMessage.set === "function") {
        Object.defineProperty(channelPrototype, "onmessage", {
          configurable: onMessage.configurable,
          enumerable: onMessage.enumerable,
          get: onMessage.get,
          set(value) {
            ensureChannel(this, "onmessage");
            return onMessage.set.call(this, value);
          }
        });
      }
    }

    const peerPrototype = globalThis.RTCPeerConnection && globalThis.RTCPeerConnection.prototype;
    const originalPeerAddEventListener = peerPrototype && peerPrototype.addEventListener;
    const ensurePeer = (peer) => {
      if (!peer || state.peers.has(peer)) return peer;
      state.peers.add(peer);
      state.emit("rtc-peer", { event: "observed" });
      if (typeof originalPeerAddEventListener === "function") {
        originalPeerAddEventListener.call(peer, "datachannel", (event) => ensureChannel(event.channel, "remote-datachannel"));
        originalPeerAddEventListener.call(peer, "connectionstatechange", () => state.emit("rtc-peer", {
          event: "connection-state",
          connectionState: String(peer.connectionState || ""),
          iceConnectionState: String(peer.iceConnectionState || "")
        }));
      }
      return peer;
    };
    if (peerPrototype && !peerPrototype.__riftliteTcgaResearchPatched) {
      Object.defineProperty(peerPrototype, "__riftliteTcgaResearchPatched", { value: true });
      const originalCreateDataChannel = peerPrototype.createDataChannel;
      if (typeof originalCreateDataChannel === "function") {
        peerPrototype.createDataChannel = function riftliteResearchCreateDataChannel(...args) {
          ensurePeer(this);
          return ensureChannel(originalCreateDataChannel.apply(this, args), "local-datachannel");
        };
      }
      const originalSetRemoteDescription = peerPrototype.setRemoteDescription;
      if (typeof originalSetRemoteDescription === "function") {
        peerPrototype.setRemoteDescription = function riftliteResearchSetRemoteDescription(...args) {
          ensurePeer(this);
          return originalSetRemoteDescription.apply(this, args);
        };
      }
    }

    if (requestedActive) {
      state.emit("hook-ready", {
        hasRtcDataChannel: Boolean(channelPrototype),
        hasRtcPeerConnection: Boolean(peerPrototype),
        path: String(location.pathname || "")
      });
    }
    return true;
  })()`;
}
