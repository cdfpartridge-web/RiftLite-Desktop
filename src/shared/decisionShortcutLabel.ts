export function decisionShortcutLabel(accelerator: string, platform: string): string {
  return accelerator.split("+").map(key => {
    switch (key.toLowerCase()) {
      case "commandorcontrol":
      case "cmdorctrl": return platform === "darwin" ? "Command" : "Ctrl";
      case "control": return "Ctrl";
      case "cmd": return "Command";
      case "alt": return platform === "darwin" ? "Option" : "Alt";
      default: return key;
    }
  }).join("+");
}
