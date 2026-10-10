import { useId, useState } from "react";
import { ArrowLeft, Camera, Cloud, Eye, Film, Gamepad2, Maximize2, Mic, PanelLeftClose, RefreshCw, RotateCcw, RotateCw, Square, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import "./styles/setup-toolbar-guide.css";

const ATLAS_EXAMPLE = {
  src: new URL("./assets/setup-atlas-example.webp", import.meta.url).href,
  alt: "An example Atlas game from the official Rift Atlas website, with Rebuke targeting Kai'Sa at a battlefield.",
  attribution: "Example board: Rift Atlas (riftatlas.com/play)."
};

const CONTROLS: ReadonlyArray<{ id: string; label: string; shortLabel?: string; icon: LucideIcon; detail: string }> = [
  { id: "sidebar", label: "Show or hide sidebar", icon: PanelLeftClose, detail: "Give the game more room, or bring back navigation to the rest of RiftLite." },
  { id: "web", label: "Web replay status", shortLabel: "Web", icon: Cloud, detail: "Check whether interactive replay capture is enabled or active. Click this status in Play to open Recording & sharing." },
  { id: "video", label: "Video status", shortLabel: "Video", icon: Film, detail: "Check whether video is waiting for a game, recording or off. Click this status in Play to change your recording choices." },
  { id: "mic-status", label: "Microphone status", shortLabel: "Mic", icon: Mic, detail: "Check whether your microphone is included in the current video or will change for the next recording." },
  { id: "tcga", label: "Play on TCG Arena", shortLabel: "TCGA", icon: Gamepad2, detail: "Switch the embedded simulator to TCG Arena. Finish your current match before switching." },
  { id: "atlas", label: "Play on Atlas", shortLabel: "Atlas", icon: Gamepad2, detail: "Switch the embedded simulator to Atlas. Your default simulator can be changed later in Settings." },
  { id: "refresh", label: "Refresh game page", icon: RefreshCw, detail: "Reload the simulator page if it stops responding. Try the regular refresh before the stronger repair options." },
  { id: "hard-refresh", label: "Hard refresh game page", icon: RotateCcw, detail: "Reload the simulator while bypassing cached page resources. Use this if a normal refresh has not helped." },
  { id: "repair", label: "Atlas site-state repair", icon: RotateCw, detail: "Open Atlas repair options when its page will not load correctly. Read the options before choosing a repair." },
  { id: "hand", label: "Known opponent hand", icon: Eye, detail: "On Atlas, see cards your opponent has already revealed. Unknown cards stay hidden. Shortcut: F12, unless assigned to another RiftLite action." },
  { id: "screenshot", label: "Save screenshot", icon: Camera, detail: "Save a picture of the current game. You can set a screenshot shortcut in Settings." },
  { id: "microphone", label: "Toggle replay microphone", icon: Mic, detail: "Include or exclude your voice in game videos. Check the microphone status to see when the change takes effect." },
  { id: "stop", label: "Stop match", shortLabel: "Stop match", icon: Square, detail: "Force RiftLite to finish the current capture and open the match review. Use this when capture has not ended normally; it does not concede the simulator game." }
];

export interface SetupToolbarGuideProps {
  screenshot?: { src: string; alt: string; attribution?: string } | null;
}

/** Informational controls only: this guide never operates the simulator or changes recording. */
export function SetupToolbarGuide({ screenshot = ATLAS_EXAMPLE }: SetupToolbarGuideProps) {
  const headingId = useId();
  const detailId = useId();
  const [selected, setSelected] = useState("hand");
  const [enlarged, setEnlarged] = useState(false);
  const current = CONTROLS.find((control) => control.id === selected) ?? CONTROLS[0];
  const CurrentIcon = current.icon;

  return <section className="setup-toolbar-guide" aria-labelledby={headingId}>
    <div className="setup-toolbar-guide__heading">
      <h2 id={headingId}>Know your Play controls</h2>
      <p>Choose an icon below to see what it does. These are previews, so you can explore safely.</p>
      <span className="setup-toolbar-guide__shortcut"><Maximize2 size={13} aria-hidden="true" /><kbd>F11</kbd> Enter or leave fullscreen</span>
    </div>
    <figure className="setup-toolbar-guide__example">
      <div className="setup-toolbar-guide__toolbar" role="group" aria-label="RiftLite top bar button guide">
        {[CONTROLS.slice(0, 4), CONTROLS.slice(4)].map((group, index) => <div key={index} className="setup-toolbar-guide__control-group">
          {group.map(({ id, label, shortLabel, icon: Icon }) => <button key={id} type="button" className="setup-toolbar-guide__control" data-kind={id} aria-label={label} aria-pressed={selected === id} aria-controls={detailId} title={label} onClick={() => setSelected(id)}>
            <Icon size={15} aria-hidden="true" fill={id === "stop" ? "currentColor" : "none"} />{shortLabel ? <span>{shortLabel}</span> : null}
          </button>)}
        </div>)}
      </div>
      <div className="setup-toolbar-guide__detail" id={detailId} aria-live="polite" aria-atomic="true"><CurrentIcon size={20} aria-hidden="true" /><div><strong>{current.label}</strong><p>{current.detail}</p></div></div>
      {screenshot ? <>
        <div className="setup-toolbar-guide__image-wrap" data-enlarged={enlarged} tabIndex={enlarged ? 0 : undefined} aria-label={enlarged ? "Enlarged Atlas screenshot. Scroll to see the whole board." : undefined}>
          <img className="setup-toolbar-guide__image" src={screenshot.src} alt={screenshot.alt} width={1800} height={1000} loading="lazy" />
        </div>
        <figcaption><span>{screenshot.attribution} The RiftLite toolbar above is a button guide.</span><button type="button" aria-expanded={enlarged} onClick={() => setEnlarged(!enlarged)}>{enlarged ? <ZoomOut size={13} /> : <ZoomIn size={13} />}{enlarged ? "Fit image" : "Enlarge"}</button></figcaption>
      </> : <figcaption>The icons match RiftLite's Play top bar.</figcaption>}
    </figure>
    <div className="setup-toolbar-guide__fullscreen"><Maximize2 size={19} aria-hidden="true" /><div><strong>More room to play: press F11</strong><p>F11 enters or leaves fullscreen. Some keyboards also need Fn. On Mac, you can also use the green window button.</p><p>To keep these controls visible, turn on <b>Show top bar in fullscreen</b> in <b>Settings → Appearance & Play</b>.</p></div></div>
    <details className="setup-toolbar-guide__extra"><summary>Controls that appear when needed</summary><p><ArrowLeft size={14} aria-hidden="true" /><span><strong>Back to Play</strong> appears while editing a deck in Atlas.</span></p><p><span><strong>Mark decision</strong> appears during an enhanced-insights session. Use it to mark a moment to review later.</span></p><p><span>Atlas repair and Known opponent hand are Atlas-only controls. Recording status always reflects your own choices and the current game.</span></p></details>
  </section>;
}
