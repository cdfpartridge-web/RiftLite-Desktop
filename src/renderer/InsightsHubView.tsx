import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, BrainCircuit, Layers3, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import type { ActiveView } from "../shared/navigationModel";
import type { MatchDraft, ReplayRecord, SavedDeck } from "../shared/types";
import { DeckInsightsView } from "./DeckInsightsView";
import { EnhancedInsightsIntro, type EnhancedInsightsIntroSelection } from "./EnhancedInsightsIntro";
import { InsightsComingSoon } from "./InsightsComingSoon";

type InsightsMode = "deck" | "coach";

export interface EnhancedInsightsSettingsPatch {
  enhancedInsightsEnabled?: boolean;
  enhancedInsightsIntroSeen?: boolean;
  enhancedInsightsPostGamePromptEnabled?: boolean;
}

interface InsightsHubViewProps {
  replays: ReplayRecord[];
  matches: MatchDraft[];
  decks: SavedDeck[];
  activeDeckId: string;
  enhancedInsightsEnabled: boolean;
  enhancedInsightsIntroSeen: boolean;
  enhancedInsightsPostGamePromptEnabled: boolean;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
  onNavigate: (view: ActiveView) => void;
  onSaveEnhancedInsights: (patch: EnhancedInsightsSettingsPatch) => Promise<void>;
}

export function InsightsHubView({
  replays,
  matches,
  decks,
  activeDeckId,
  enhancedInsightsEnabled,
  enhancedInsightsIntroSeen,
  enhancedInsightsPostGamePromptEnabled,
  onOpenReplay,
  onNavigate,
  onSaveEnhancedInsights
}: InsightsHubViewProps) {
  const [mode, setMode] = useState<InsightsMode>("deck");
  const [enhancedIntroOpen, setEnhancedIntroOpen] = useState(() => !enhancedInsightsIntroSeen);
  const [enhancedIntroBusy, setEnhancedIntroBusy] = useState(false);
  const [enhancedIntroError, setEnhancedIntroError] = useState("");
  const enhancedSaveInFlightRef = useRef(false);

  useEffect(() => {
    if (!enhancedInsightsIntroSeen) setEnhancedIntroOpen(true);
  }, [enhancedInsightsIntroSeen]);

  function openEnhancedInsightsGuide() {
    if (enhancedIntroBusy) return;
    setEnhancedIntroError("");
    setEnhancedIntroOpen(true);
  }

  async function enableEnhancedInsights(selection: EnhancedInsightsIntroSelection) {
    if (enhancedSaveInFlightRef.current) return;
    enhancedSaveInFlightRef.current = true;
    setEnhancedIntroBusy(true);
    setEnhancedIntroError("");
    try {
      await onSaveEnhancedInsights({
        enhancedInsightsEnabled: true,
        enhancedInsightsIntroSeen: true,
        enhancedInsightsPostGamePromptEnabled: selection.askPostGameQuestion
      });
      setEnhancedIntroOpen(false);
    } catch {
      setEnhancedIntroError("RiftLite couldn't enable Enhanced Insights. Nothing changed — please try again.");
    } finally {
      enhancedSaveInFlightRef.current = false;
      setEnhancedIntroBusy(false);
    }
  }

  async function dismissEnhancedInsightsIntro() {
    if (enhancedSaveInFlightRef.current) return;
    enhancedSaveInFlightRef.current = true;
    setEnhancedIntroOpen(false);
    setEnhancedIntroBusy(true);
    setEnhancedIntroError("");
    try {
      await onSaveEnhancedInsights({ enhancedInsightsIntroSeen: true });
    } catch {
      setEnhancedIntroError("RiftLite couldn't remember that choice. Nothing changed — please try again.");
      setEnhancedIntroOpen(true);
    } finally {
      enhancedSaveInFlightRef.current = false;
      setEnhancedIntroBusy(false);
    }
  }

  return (
    <section className="insights-hub-page">
      <nav className="insights-hub-switcher" aria-label="Insights mode">
        <button
          type="button"
          className={mode === "deck" ? "active" : ""}
          aria-pressed={mode === "deck"}
          onClick={() => setMode("deck")}
        >
          <Layers3 size={17} />
          <span><strong>Deck Insights</strong><small>Understand the list and how it performs</small></span>
        </button>
        <button
          type="button"
          className={mode === "coach" ? "active" : ""}
          aria-pressed={mode === "coach"}
          onClick={() => setMode("coach")}
        >
          <BrainCircuit size={17} />
          <span><strong>Replay Coach</strong><small>Coming soon · being refined</small></span>
        </button>
        <button
          type="button"
          className="enhanced-insights-hub-control"
          data-state={enhancedInsightsEnabled ? "enabled" : "disabled"}
          aria-haspopup="dialog"
          disabled={enhancedIntroBusy}
          onClick={openEnhancedInsightsGuide}
          style={{
            marginLeft: "auto",
            borderColor: enhancedInsightsEnabled ? "rgb(105 229 209 / 24%)" : undefined,
            background: enhancedInsightsEnabled ? "rgb(105 229 209 / 5%)" : undefined
          }}
        >
          {enhancedIntroBusy
            ? <LoaderCircle size={17} aria-hidden="true" />
            : enhancedInsightsEnabled
              ? <ShieldCheck size={17} aria-hidden="true" />
              : <Sparkles size={17} aria-hidden="true" />}
          <span>
            <strong>{enhancedIntroBusy ? "Saving Enhanced Insights…" : enhancedInsightsEnabled ? "Enhanced Insights on" : "Enable Enhanced Insights"}</strong>
            <small>{enhancedInsightsEnabled ? "Private evidence · View guide" : "Capture richer local evidence"}</small>
          </span>
        </button>
      </nav>

      {mode === "deck" ? (
        <DeckInsightsView
          replays={replays}
          matches={matches}
          decks={decks}
          activeDeckId={activeDeckId}
          onOpenReplay={onOpenReplay}
          onNavigate={onNavigate}
        />
      ) : (
        <InsightsComingSoon />
      )}

      {enhancedIntroOpen ? (
        <EnhancedInsightsIntro
          defaultAskPostGameQuestion={enhancedInsightsPostGamePromptEnabled}
          busy={enhancedIntroBusy}
          onEnable={(selection) => { void enableEnhancedInsights(selection); }}
          onDismiss={() => { void dismissEnhancedInsightsIntro(); }}
        />
      ) : null}

      {enhancedIntroError ? (
        <div
          className="enhanced-insights-hub-error"
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            zIndex: 380,
            left: "50%",
            bottom: "24px",
            display: "flex",
            maxWidth: "min(540px, calc(100vw - 28px))",
            gap: "9px",
            alignItems: "center",
            border: "1px solid rgb(255 120 160 / 36%)",
            borderRadius: "12px",
            padding: "11px 14px",
            color: "#ffd6e2",
            background: "rgb(34 10 20 / 96%)",
            boxShadow: "0 18px 54px rgb(0 0 0 / 46%)",
            fontSize: ".72rem",
            lineHeight: 1.4,
            transform: "translateX(-50%)"
          }}
        >
          <AlertTriangle size={17} aria-hidden="true" style={{ flex: "0 0 auto", color: "#ff8cac" }} />
          <span>{enhancedIntroError}</span>
        </div>
      ) : null}
    </section>
  );
}
