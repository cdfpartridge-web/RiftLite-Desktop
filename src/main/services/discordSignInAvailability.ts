export const LOCAL_PRODUCT_PREVIEW_ORIGIN = "http://127.0.0.1:3187";
export const LOCAL_ACCOUNT_PROVIDERS_URL = `${LOCAL_PRODUCT_PREVIEW_ORIGIN}/api/account/providers`;

export async function discordSignInAvailability(localPreview: boolean, request: typeof fetch = fetch): Promise<"available" | "unconfigured" | "offline"> {
  const url = localPreview ? LOCAL_ACCOUNT_PROVIDERS_URL : "https://www.riftlite.com/api/account/providers";
  try {
    const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return "offline";
    const data = await response.json();
    if (typeof data?.discordAvailable !== "boolean" || typeof data.available !== "boolean") return "offline";
    return data.available && data.discordAvailable ? "available" : "unconfigured";
  } catch {
    return "offline";
  }
}
