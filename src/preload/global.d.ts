import type { RiftLiteApi } from "../shared/types.js";

declare global {
  interface Window {
    riftlite: RiftLiteApi;
  }
}

export {};
