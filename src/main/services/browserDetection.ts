import { access } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserInfo } from "../../shared/types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectBrowsers(): Promise<BrowserInfo[]> {
  const local = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  const candidates: Array<BrowserInfo & { paths: string[] }> = [
    {
      name: "Chrome",
      installed: false,
      paths: [
        join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        join(local, "Google", "Chrome", "Application", "chrome.exe")
      ]
    },
    {
      name: "Edge",
      installed: false,
      paths: [
        join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(local, "Microsoft", "Edge", "Application", "msedge.exe")
      ]
    },
    {
      name: "Opera",
      installed: false,
      paths: [
        join(local, "Programs", "Opera", "opera.exe"),
        join(local, "Programs", "Opera GX", "opera.exe")
      ]
    },
    {
      name: "Firefox",
      installed: false,
      paths: [
        join(programFiles, "Mozilla Firefox", "firefox.exe"),
        join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
        join(local, "Mozilla Firefox", "firefox.exe")
      ]
    }
  ];

  const result: BrowserInfo[] = [];
  for (const candidate of candidates) {
    const found = await Promise.all(candidate.paths.map((path) => exists(path)));
    const path = candidate.paths[found.findIndex(Boolean)];
    result.push({ name: candidate.name, installed: Boolean(path), path });
  }
  return result;
}
