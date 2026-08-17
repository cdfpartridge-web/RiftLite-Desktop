export type AccountLinkProvider = "google" | "email" | "discord";

const ACCOUNT_LINK_TRANSPORT_MESSAGE = "Could not reach RiftLite account services. Check your connection, VPN, or antivirus, then try again; no account changes were made.";

export function accountLinkUrlForProvider(loginUrl: string, provider: AccountLinkProvider): string {
  if (provider !== "google" && provider !== "email" && provider !== "discord") {
    throw new Error("Choose Google, email, or Discord to continue.");
  }

  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    throw new Error("RiftLite returned an invalid account sign-in link.");
  }

  const loopbackHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new Error("RiftLite returned an unsafe account sign-in link.");
  }

  url.searchParams.set("provider", provider);
  return url.toString();
}

export function accountLinkErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "").trim();
  if (/fetch failed|network request failed|network-request-failed|timed?\s*out|aborterror/i.test(raw)) {
    return ACCOUNT_LINK_TRANSPORT_MESSAGE;
  }
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:Error|TypeError):\s*/i, "")
    .trim();
  return cleaned || "Could not start account sign-in. Try again; no account changes were made.";
}
