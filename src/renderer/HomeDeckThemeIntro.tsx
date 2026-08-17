import React, { useEffect, useRef } from "react";
import { Settings, Sparkles, X } from "lucide-react";
import {
  HOME_DECK_DOMAIN_COLORS,
  type HomeDeckTheme
} from "../shared/homeDeckTheme";

export interface HomeDeckThemeIntroProps {
  legend: string;
  theme: HomeDeckTheme | null;
  busy: boolean;
  onEnable: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export function HomeDeckThemeIntro({
  legend,
  theme,
  busy,
  onEnable,
  onOpenSettings,
  onDismiss
}: HomeDeckThemeIntroProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  const primary = theme?.primary ?? HOME_DECK_DOMAIN_COLORS.Fury.hex;
  const secondary = theme?.secondary ?? HOME_DECK_DOMAIN_COLORS.Chaos.hex;
  const previewLabel = theme && legend
    ? `${legend}'s ${theme.label} palette`
    : "Your active deck's two-domain palette";

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      dismissRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [busy]);

  return (
    <div className="home-theme-intro-layer" data-testid="home-theme-intro">
      <section
        ref={dialogRef}
        className="home-theme-intro-card"
        role="dialog"
        aria-labelledby="home-theme-intro-title"
        tabIndex={-1}
        style={{
          "--theme-intro-primary": primary,
          "--theme-intro-secondary": secondary
        } as React.CSSProperties}
      >
        <button
          type="button"
          className="home-theme-intro-close"
          aria-label="Keep deck themes off"
          title="Keep deck themes off"
          disabled={busy}
          onClick={onDismiss}
        >
          <X size={17} />
        </button>
        <div className="home-theme-intro-icon" aria-hidden="true"><Sparkles size={23} /></div>
        <span className="modern-kicker">New - Optional appearance</span>
        <h2 id="home-theme-intro-title">Let your active deck colour Home</h2>
        <p>
          RiftLite can add a restrained two-colour theme based on your active legend. It starts off and only changes Home - never results, warnings, creator branding, or card art.
        </p>
        <div className="home-theme-intro-preview" aria-label={previewLabel}>
          {theme ? (
            <>
              <i data-tone="primary" />
              <i data-tone="secondary" />
              <span>{theme.domains[0]} <small>+</small> {theme.domains[1]}</span>
            </>
          ) : (
            <>
              {Object.entries(HOME_DECK_DOMAIN_COLORS).map(([domain, colour]) => (
                <i
                  data-domain={domain}
                  style={{ "--theme-intro-domain": colour.hex } as React.CSSProperties}
                  key={domain}
                />
              ))}
              <span>Choose an active deck to preview</span>
            </>
          )}
        </div>
        <p className="home-theme-intro-location">
          Change it any time in <strong>Settings / Getting started / Home appearance</strong>.
        </p>
        <footer className="home-theme-intro-actions">
          <button type="button" className="home-theme-intro-keep" disabled={busy} onClick={onDismiss}>Keep off</button>
          <button type="button" className="secondary" disabled={busy} onClick={onOpenSettings}><Settings size={15} /> Appearance settings</button>
          <button type="button" className="primary" disabled={busy} onClick={onEnable}><Sparkles size={15} /> {busy ? "Turning on..." : "Turn on theme"}</button>
        </footer>
      </section>
    </div>
  );
}
