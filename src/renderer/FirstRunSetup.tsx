import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BarChart3, Check, ChevronRight, Cloud, ExternalLink, Gamepad2,
  Layers3, LoaderCircle, Mic, MonitorPlay, Play, Settings2, ShieldCheck,
  Sparkles, UserRound, Users, Video, X
} from "lucide-react";
import type { NavigationTarget } from "../shared/navigationModel.js";
import type { SavedDeck, UserSettings } from "../shared/types.js";
import { initialFirstRunReplayPreferences, rawCaptureForFirstRunReplayPreferences } from "../shared/firstRunReplayPreferences.js";
import { activeDiscordReplayHubIds } from "../shared/replaySharing.js";
import { SetupToolbarGuide } from "./SetupToolbarGuide.js";
import "./styles/first-run-setup.css";

export type FirstRunSetupStep = "player" | "account" | "replays" | "deck" | "ready";

export interface FirstRunSetupProps {
  settings: UserSettings;
  decks: SavedDeck[];
  step: FirstRunSetupStep;
  logoUrl?: string;
  accountVerified: boolean;
  onStepChange: (step: FirstRunSetupStep) => void;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onOpenDestination: (target: NavigationTarget) => void;
  onOpenWebsite: () => Promise<void>;
  onFinish: (target?: NavigationTarget) => Promise<void>;
  onSkip: () => Promise<void>;
}

const STEPS = [
  { id: "player", label: "Your player", hint: "Name & simulator", icon: Gamepad2 },
  { id: "account", label: "Your account", hint: "Connect when you're ready", icon: UserRound },
  { id: "replays", label: "Your replays", hint: "Choose what to save", icon: Video },
  { id: "deck", label: "Your deck", hint: "Bring your game plan", icon: Layers3 },
  { id: "ready", label: "Make it yours", hint: "Find your next step", icon: Sparkles }
] as const;

const FEATURE_MAP = [
  { title: "Play", description: "Open your simulator and play in RiftLite.", icon: Play, target: { view: "play" } },
  { title: "Review", description: "Results, replays, video, game logs and stats.", icon: Video, target: { view: "matches" } },
  { title: "Prepare", description: "Decks, matchup prep, Mulligan & Sideboard Labs.", icon: Layers3, target: { view: "decks", deckFocus: "library" } },
  { title: "Community", description: "Explore the meta, join groups and find a match.", icon: Users, target: { view: "community", communityTab: "legend-meta" } },
  { title: "Insights", description: "Explore patterns in your saved match data.", icon: BarChart3, target: { view: "insights" } },
  { title: "Overlay", description: "Add RiftLite match information to your stream.", icon: MonitorPlay, target: { view: "stream" } },
  { title: "Settings", description: "Adjust your preferences or reopen this setup.", icon: Settings2, target: { view: "settings" } }
] as const satisfies readonly { title: string; description: string; icon: typeof Play; target: NavigationTarget }[];

const FOCUSABLE_SELECTOR = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

export function FirstRunSetup({ settings, decks, step, logoUrl, accountVerified, onStepChange, onSave, onOpenDestination, onOpenWebsite, onFinish, onSkip }: FirstRunSetupProps) {
  const [username, setUsername] = useState(settings.username);
  const [platform, setPlatform] = useState(settings.defaultGamePlatform);
  const [localReplay, setLocalReplay] = useState(settings.replayCaptureEnabled);
  const [video, setVideo] = useState(settings.replayVideoEnabled);
  const [microphone, setMicrophone] = useState(settings.replayMicAudioEnabled);
  const [interactiveReplay, setInteractiveReplay] = useState(settings.rawCapture.enabled);
  const [onlineAtlas, setOnlineAtlas] = useState(() => initialFirstRunReplayPreferences(settings).atlas);
  const [onlineTcga, setOnlineTcga] = useState(() => initialFirstRunReplayPreferences(settings).tcga);
  const [visibility, setVisibility] = useState(() => initialFirstRunReplayPreferences(settings).visibility);
  const [replayDraftAccountUid, setReplayDraftAccountUid] = useState(settings.accountUid);
  const [confirmResults, setConfirmResults] = useState(settings.confirmationEnabled);
  const [fullscreenBar, setFullscreenBar] = useState(settings.showPlayToolbarInFullscreen);
  const [deckId, setDeckId] = useState(settings.activeDeckId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const skipRef = useRef<() => void>(() => undefined);
  const dialogRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const index = STEPS.findIndex((item) => item.id === step);
  const connected = accountVerified && Boolean(settings.accountUid);
  const discordDestinations = activeDiscordReplayHubIds(settings).length > 0 && (onlineAtlas || onlineTcga);
  const displayedVisibility = discordDestinations ? "unlisted" : visibility;
  const chosenDeck = decks.find((deck) => deck.id === deckId);
  const uploadsConfigured = settings.rawCapture.uploadEnabled || settings.rawCapture.webReplayAutoUploadEnabled || settings.rawCapture.tcgaWebReplayAutoUploadEnabled;
  const atlasUploads = Boolean(settings.accountUid && settings.rawCapture.webReplayAutoUploadEnabled && settings.rawCapture.webReplayAutoUploadAccountUid === settings.accountUid);
  const tcgaUploads = Boolean(settings.accountUid && settings.rawCapture.tcgaWebReplayAutoUploadEnabled && settings.rawCapture.tcgaWebReplayAutoUploadAccountUid === settings.accountUid);
  const onlineSummary = !uploadsConfigured ? "Online uploads off"
    : !interactiveReplay ? "Online uploads paused"
      : (atlasUploads || tcgaUploads) && !connected ? "Online uploads need verification"
        : atlasUploads && tcgaUploads ? "Atlas + TCG Arena uploads on"
          : atlasUploads ? "Atlas uploads on"
            : tcgaUploads ? "TCG Arena uploads on"
              : "Online uploads: check settings";

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error && cause.message ? cause.message : "Your changes could not be saved. Please try again.");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function saveCurrentStep() {
    const patch: Partial<UserSettings> = {};
    if (step === "player") {
      if (username.trim() !== settings.username) patch.username = username.trim();
      if (platform !== settings.defaultGamePlatform) patch.defaultGamePlatform = platform;
    } else if (step === "replays") {
      if (replayDraftAccountUid !== settings.accountUid) throw new Error("Your account changed. Please check your replay choices before continuing.");
      if (localReplay !== settings.replayCaptureEnabled) patch.replayCaptureEnabled = localReplay;
      if (video !== settings.replayVideoEnabled) patch.replayVideoEnabled = video;
      if (microphone !== settings.replayMicAudioEnabled) patch.replayMicAudioEnabled = microphone;
      const rawCapture = rawCaptureForFirstRunReplayPreferences(settings, { capture: interactiveReplay, atlas: onlineAtlas, tcga: onlineTcga, visibility }, connected);
      if (JSON.stringify(rawCapture) !== JSON.stringify(settings.rawCapture)) patch.rawCapture = rawCapture;
      if (confirmResults !== settings.confirmationEnabled) patch.confirmationEnabled = confirmResults;
      if (fullscreenBar !== settings.showPlayToolbarInFullscreen) patch.showPlayToolbarInFullscreen = fullscreenBar;
    } else if (step === "deck" && deckId !== settings.activeDeckId) {
      patch.activeDeckId = chosenDeck?.id ?? "";
    }
    if (Object.keys(patch).length) await onSave(patch);
    if (patch.rawCapture) setVisibility(patch.rawCapture.visibility);
  }

  function moveTo(next: FirstRunSetupStep) {
    void runAction(async () => { await saveCurrentStep(); onStepChange(next); });
  }

  function openDestination(target: NavigationTarget) {
    void runAction(async () => { await saveCurrentStep(); onOpenDestination(target); });
  }

  function finish(target: NavigationTarget) {
    void runAction(async () => { await saveCurrentStep(); await onFinish(target); });
  }

  function skip() {
    void runAction(onSkip);
  }
  skipRef.current = skip;

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) skipRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const preferences = initialFirstRunReplayPreferences(settings);
    setOnlineAtlas(preferences.atlas);
    setOnlineTcga(preferences.tcga);
    setVisibility(preferences.visibility);
    setInteractiveReplay(preferences.capture);
    setReplayDraftAccountUid(settings.accountUid);
    // Upload drafts belong to one account; changing accounts must not reuse consent.
  }, [settings.accountUid]);

  useEffect(() => {
    setError("");
    contentRef.current?.scrollTo({ top: 0 });
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  return (
    <div className="first-run-setup" data-setup-step={step}>
      <section className="first-run-setup__dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="first-run-setup-title" aria-describedby="first-run-setup-description" aria-busy={busy} tabIndex={-1}>
        <aside className="first-run-setup__sidebar" aria-label="Setup progress">
          <div className="first-run-setup__brand">
            <span className="first-run-setup__brand-mark" aria-hidden="true">{logoUrl ? <img src={logoUrl} alt="" /> : <Layers3 size={28} />}</span>
            <span>RiftLite<small>YOUR RIFTBOUND COMPANION</small></span>
          </div>
          <ol className="first-run-setup__steps">
            {STEPS.map(({ id, label, hint, icon: Icon }, position) => (
              <li key={id} aria-current={step === id ? "step" : undefined} data-complete={position < index}>
                <span className="first-run-setup__step-icon" aria-hidden="true">{position < index ? <Check size={17} /> : <Icon size={17} />}</span>
                <span><strong>{label}</strong><small>{hint}</small></span>
              </li>
            ))}
          </ol>
          <div className="first-run-setup__sidebar-note"><span className="first-run-setup__eyebrow">A little setup. More play.</span><p>Make RiftLite work for you.<br />You can change everything later.</p></div>
        </aside>

        <form className="first-run-setup__main" onSubmit={(event) => { event.preventDefault(); if (step === "ready") finish({ view: "play" }); else moveTo(STEPS[index + 1].id); }}>
          <header className="first-run-setup__topbar">
            <span>GET STARTED <span aria-hidden="true">/</span> <strong>Step {index + 1} of {STEPS.length}</strong></span>
            <button type="button" className="first-run-setup__close" aria-label="Skip setup" title="Skip setup" disabled={busy} data-setup-action="skip" onClick={skip}><X size={19} /></button>
          </header>

          <div className="first-run-setup__content" ref={contentRef}>
            {step === "player" ? <>
              <div className="first-run-setup__heading"><span className="first-run-setup__eyebrow">LET'S MAKE THIS YOURS</span><h1 ref={headingRef} tabIndex={-1} id="first-run-setup-title">Welcome to RiftLite.</h1><p id="first-run-setup-description">Play, review and improve your Riftbound games.<br />Start with a few simple choices.</p></div>
              <label className="first-run-setup__field" htmlFor="first-run-player"><span>Your simulator username <small>Optional</small></span><input id="first-run-player" value={username} autoComplete="off" spellCheck={false} disabled={busy} placeholder="The name you play under" onChange={(event) => setUsername(event.currentTarget.value)} aria-describedby="first-run-player-help" /><small id="first-run-player-help">Use the same name as in your simulator so RiftLite can recognise your games. This is separate from your RiftLite account handle.</small></label>
              <fieldset className="first-run-setup__platforms" disabled={busy}><legend>Where do you usually play?</legend><p>You can switch simulators any time in Play.</p><div className="first-run-setup__platform-grid">
                {([{ value: "atlas", title: "Atlas", description: "Open Atlas when you start playing." }, { value: "tcga", title: "TCG Arena", description: "Open TCG Arena when you start playing." }] as const).map(({ value, title, description }) => <label key={value} data-selected={platform === value}><input type="radio" name="first-run-platform" value={value} checked={platform === value} onChange={() => setPlatform(value)} /><span className="first-run-setup__platform-symbol" aria-hidden="true">{value === "atlas" ? "A" : "T"}</span><strong>{title}</strong><small>{description}</small></label>)}
              </div></fieldset>
            </> : null}

            {step === "account" ? <>
              <div className="first-run-setup__heading"><span className="first-run-setup__eyebrow">YOUR ACCOUNT · OPTIONAL</span><h1 ref={headingRef} tabIndex={-1} id="first-run-setup-title">Take your games further.</h1><p id="first-run-setup-description">A free RiftLite account connects your desktop to online replays and the community.</p></div>
              <div className="first-run-setup__benefits"><div><Video size={21} /><strong>Online replays</strong><span>Upload and share the games you choose.</span></div><div><Cloud size={21} /><strong>Account backup</strong><span>Choose whether to back up supported app data.</span></div><div><Users size={21} /><strong>Your community</strong><span>Join groups and connect with other players.</span></div></div>
              <div className="first-run-setup__account-card" data-connected={connected}><span className="first-run-setup__account-icon" aria-hidden="true">{connected ? <ShieldCheck size={25} /> : <UserRound size={25} />}</span><div><strong>{connected ? "Your account is connected" : settings.accountUid ? "Reconnect your RiftLite account" : "Connect when you're ready"}</strong><p>{connected ? settings.accountHandle ? `@${settings.accountHandle}` : settings.accountDisplayName || settings.accountEmail || "Verified RiftLite account" : settings.accountUid ? "Verify your saved account to use online features." : "Use Google, email or Discord on the Account page, then return to setup."}</p></div><button type="button" className="first-run-setup__button first-run-setup__button--secondary" disabled={busy} onClick={() => openDestination({ view: "account" })}>{connected ? "Account settings" : "Sign in / create account"}<ArrowRight size={15} /></button></div>
              <p className="first-run-setup__note"><ShieldCheck size={18} aria-hidden="true" /><span>You can keep using RiftLite on this device without an account. Uploads, replay visibility and account backup have their own settings.</span></p>
            </> : null}

            {step === "replays" ? <>
              <div className="first-run-setup__heading"><span className="first-run-setup__eyebrow">REMEMBER YOUR GAMES</span><h1 ref={headingRef} tabIndex={-1} id="first-run-setup-title">Choose what to save.</h1><p id="first-run-setup-description">Keep games for review, with recording choices that suit you.</p></div>
              <div className="first-run-setup__preferences">
                <SetupToggle title="Save local replays" description="Keep replay evidence on this device for games you play in RiftLite." checked={localReplay} disabled={busy} onChange={setLocalReplay} />
                <SetupToggle title="Record game video" description="Save video with game audio when available. Uses more disk space." checked={localReplay && video} disabled={busy || !localReplay} onChange={setVideo} />
                <SetupToggle title="Include my microphone" description="Add your voice to future game videos." checked={microphone} disabled={busy || !localReplay || !video} onChange={setMicrophone} icon={<Mic size={15} />} />
              </div>
              <section className="first-run-setup__online" aria-labelledby="first-run-online-title">
                <h2 id="first-run-online-title">Online replays</h2>
                <p>Automatically upload future games so you can watch and share them on the web.</p>
                {!connected ? <div className="first-run-setup__account-required"><p>{settings.accountUid ? "Reconnect and verify your RiftLite account before turning on online replays." : "If you didn’t connect a RiftLite account in the previous step, online replays aren’t available. Local recordings still work."}</p><button type="button" className="first-run-setup__text-button" disabled={busy} onClick={() => moveTo("account")}><ArrowLeft size={14} />Back to account</button></div> : null}
                <div className="first-run-setup__preferences">
                  <SetupToggle title="Upload Atlas replays" description="Save future captured Atlas games to your RiftLite account." checked={onlineAtlas} disabled={busy || (!connected && !onlineAtlas)} onChange={(enabled) => { setOnlineAtlas(enabled); if (enabled) setInteractiveReplay(true); }} />
                  <SetupToggle title="Upload TCG Arena replays" description="Save future captured TCG Arena games to your RiftLite account." checked={onlineTcga} disabled={busy || (!connected && !onlineTcga)} onChange={(enabled) => { setOnlineTcga(enabled); if (enabled) setInteractiveReplay(true); }} />
                </div>
                <label className="first-run-setup__field first-run-setup__visibility" htmlFor="first-run-visibility"><span>Who can watch new online replays?</span><select id="first-run-visibility" value={displayedVisibility} disabled={busy || !connected || discordDestinations} onChange={(event) => setVisibility(event.currentTarget.value as UserSettings["rawCapture"]["visibility"])} aria-describedby="first-run-visibility-help"><option value="public">Public — anyone can find and watch</option><option value="unlisted">Unlisted — anyone with the link</option><option value="private">Private — only you</option></select><small id="first-run-visibility-help">{discordDestinations ? "Your automatic Discord destinations use Unlisted. Change those destinations in Recording & sharing to choose another visibility." : "Applies to future uploads. Your existing online replays keep their current visibility."}</small></label>
                {(onlineAtlas || onlineTcga) && !interactiveReplay ? <p className="first-run-setup__paused" role="status">Uploads are paused. Turn on interactive replay data in the options below to resume them.</p> : null}
              </section>
              <details className="first-run-setup__extra"><summary>More recording & play options <ChevronRight size={15} aria-hidden="true" /></summary><div className="first-run-setup__preferences"><SetupToggle title="Capture interactive replay data" description={onlineAtlas || onlineTcga ? "Required for online replays. Turn off both upload options above to disable capture." : uploadsConfigured ? "Your existing upload preferences still apply." : "Interactive replay data stays here until you choose to upload."} checked={interactiveReplay} disabled={busy || (interactiveReplay && (onlineAtlas || onlineTcga))} onChange={setInteractiveReplay} /><SetupToggle title="Review results after each match" description="Check the result and add details before saving." checked={confirmResults} disabled={busy} onChange={setConfirmResults} /><SetupToggle title="Show the top bar in fullscreen" description="Keep Play controls, including Known opponent hand, within reach. Also in Settings → Appearance & Play." checked={fullscreenBar} disabled={busy} onChange={setFullscreenBar} /></div></details>
            </> : null}

            {step === "deck" ? <>
              <div className="first-run-setup__heading"><span className="first-run-setup__eyebrow">BRING YOUR GAME PLAN · OPTIONAL</span><h1 ref={headingRef} tabIndex={-1} id="first-run-setup-title">Start with your deck.</h1><p id="first-run-setup-description">Choose a deck to connect your games, stats and preparation.</p></div>
              {decks.length ? <><label className="first-run-setup__field" htmlFor="first-run-deck"><span>Your active deck</span><select id="first-run-deck" value={chosenDeck?.id ?? ""} disabled={busy} onChange={(event) => setDeckId(event.currentTarget.value)}><option value="">Choose later</option>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.title || "Untitled deck"}{deck.legend ? ` · ${deck.legend}` : ""}</option>)}</select><small>You can change your active deck from the Deck Library.</small></label><div className="first-run-setup__deck-card"><Layers3 size={32} aria-hidden="true" /><div><strong>{chosenDeck?.title || (chosenDeck ? "Untitled deck" : "No deck selected yet")}</strong><p>{chosenDeck ? chosenDeck.legend || "Saved in your Deck Library" : "That's fine — add or choose a deck whenever you're ready."}</p></div>{chosenDeck ? <Check size={20} aria-label="Deck selected" /> : null}</div></> : <div className="first-run-setup__empty-deck"><span aria-hidden="true"><Layers3 size={38} /></span><strong>Your first deck starts here.</strong><p>Import a public Piltover Archive deck link or paste a deck list in the Deck Library, then return to setup.</p></div>}
              <button type="button" className="first-run-setup__button first-run-setup__button--secondary" disabled={busy} onClick={() => openDestination({ view: "decks", deckFocus: "library" })}>{decks.length ? "Add another deck" : "Open Deck Library"}<ArrowRight size={16} /></button>
              <p className="first-run-setup__note"><Layers3 size={18} aria-hidden="true" /><span>Use the regular importer: a public Piltover Archive link or a pasted deck list. Prepare also holds your Deck Notebook, matchup plans, Mulligan Lab and Sideboard Lab.</span></p>
            </> : null}

            {step === "ready" ? <>
              <div className="first-run-setup__heading first-run-setup__heading--ready"><span className="first-run-setup__eyebrow">MAKE YOURSELF AT HOME</span><h1 ref={headingRef} tabIndex={-1} id="first-run-setup-title">You're ready to explore.</h1><p id="first-run-setup-description">Start a game, or pick something to explore. Your preferences are saved.</p></div>
              <dl className="first-run-setup__summary"><div><dt>Simulator</dt><dd>{platform === "atlas" ? "Atlas" : "TCG Arena"}</dd></div><div><dt>Player</dt><dd>{username.trim() || "Set later"}</dd></div><div><dt>Account</dt><dd>{connected ? "Connected" : "Not connected"}</dd></div><div><dt>Deck</dt><dd>{chosenDeck?.title || (chosenDeck ? "Untitled deck" : "Choose later")}</dd></div></dl>
              <div className="first-run-setup__recording-summary" aria-label="Your recording choices"><span>Video {localReplay && video ? "on" : "off"}</span><span>Microphone {localReplay && video && microphone ? "on" : "off"}</span><span>Interactive data {interactiveReplay ? "on" : "off"}</span><span>{onlineSummary}</span></div>
              <p className="first-run-setup__first-game"><strong>Your first game:</strong> Play in RiftLite. {confirmResults ? "When a result is captured, check it and choose Save match. Find it again in Review." : "Captured results save automatically. Open Review to check or correct them."}</p>
              <SetupToolbarGuide />
              <div className="first-run-setup__website"><Cloud size={21} aria-hidden="true" /><div><strong>Your games on RiftLite.com</strong><p>Watch your uploaded replays, share links and explore public games. Sign in with the same RiftLite account to find your library.</p><button type="button" className="first-run-setup__text-button" disabled={busy} onClick={() => void runAction(onOpenWebsite)}>Visit RiftLite.com/replays<ExternalLink size={14} /></button></div></div>
              <div className="first-run-setup__feature-map" aria-label="Explore RiftLite">{FEATURE_MAP.map(({ title, description, icon: Icon, target }) => <button key={title} type="button" disabled={busy} onClick={() => finish(target)}><Icon size={19} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={15} aria-hidden="true" /></button>)}</div>
            </> : null}
          </div>

          <footer className="first-run-setup__footer">
            {error ? <p className="first-run-setup__error" role="alert">{error}</p> : null}
            <div className="first-run-setup__footer-actions"><div>{index > 0 ? <button type="button" className="first-run-setup__text-button" disabled={busy} onClick={() => moveTo(STEPS[index - 1].id)}><ArrowLeft size={16} />Back</button> : <button type="button" className="first-run-setup__text-button" disabled={busy} data-setup-action="skip" onClick={skip}>Skip setup</button>}</div><div className="first-run-setup__forward-actions">{step === "ready" ? <button type="button" className="first-run-setup__text-button" disabled={busy} onClick={() => finish({ view: "home" })}>Go to Home</button> : <span className="first-run-setup__save-note">Change these any time.</span>}<button type="submit" className="first-run-setup__button first-run-setup__button--primary" disabled={busy} data-setup-action={step === "ready" ? "finish" : "next"}>{busy ? <LoaderCircle size={17} className="first-run-setup__spinner" aria-hidden="true" /> : null}{busy ? "Saving…" : step === "ready" ? "Open Play" : step === "account" && !connected ? "Continue without account" : step === "deck" && !chosenDeck ? "Choose a deck later" : "Continue"}{!busy ? <ArrowRight size={16} aria-hidden="true" /> : null}</button></div></div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SetupToggle({ title, description, checked, disabled, onChange, icon }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; icon?: React.ReactNode }) {
  return <label className="first-run-setup__toggle" data-disabled={disabled}><span><strong>{icon}{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} /></label>;
}
