export type AccountLinkProvider = "google" | "email";

export function accountLinkUrlForProvider(loginUrl: string, provider: AccountLinkProvider): string {
  if (provider !== "google" && provider !== "email") {
    throw new Error("Choose Google or email to continue.");
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
