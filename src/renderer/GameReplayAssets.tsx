import React from "react";
import { BookOpen, Cloud, Film, Shield } from "lucide-react";
import { deriveGameReplayAssets, type GameReplayAsset, type GameReplayAssetsInput } from "../shared/gameReplayAssets";
import { replayVisibilityManagementUrl } from "../shared/replayVisibilityNavigation";
import "./GameReplayAssets.css";

export interface GameReplayAssetsProps extends GameReplayAssetsInput {
  onWatchVideo?: () => void;
  onWatchWebReplay?: (url: string) => void;
  onUploadReplay?: () => void;
  onViewLog?: () => void;
  onSetUp?: () => void;
  onReviewResult?: () => void;
  onOpenDelivery?: () => void;
  busy?: boolean;
}

export function GameReplayAssets(props: GameReplayAssetsProps) {
  function callback(asset: GameReplayAsset): (() => void) | undefined {
    switch (asset.action) {
      case "watch-web": return props.onWatchWebReplay && asset.url ? () => props.onWatchWebReplay!(asset.url!) : undefined;
      case "watch-video": return props.onWatchVideo;
      case "upload": return props.onUploadReplay;
      case "view-log": return props.onViewLog;
      case "setup": return props.onSetUp;
      case "review-result": return props.onReviewResult;
      case "delivery": return props.onOpenDelivery;
      default: return undefined;
    }
  }

  return <section className="game-replay-assets" aria-label="This game's replays, video and log">
    {deriveGameReplayAssets(props).map((asset) => {
      const action = callback(asset);
      const visibilityUrl = asset.kind === "web-replay" && asset.url && props.accountReady && props.onWatchWebReplay
        ? replayVisibilityManagementUrl(asset.url) : null;
      const Icon = asset.kind === "web-replay" ? Cloud : asset.kind === "video" ? Film : BookOpen;
      return <article className="game-replay-asset" data-kind={asset.kind} data-tone={asset.tone} key={asset.kind}>
        <div className="game-replay-asset-heading"><Icon size={18} aria-hidden="true" /><h3>{asset.title}</h3></div>
        <strong className="game-replay-asset-status">{asset.status}</strong>
        <p>{asset.description}</p>
        <div className="game-replay-asset-actions">
          {asset.action && action ? <button type="button" className="secondary" disabled={props.busy} onClick={(event) => { event.stopPropagation(); action(); }}>{asset.actionLabel}</button> : null}
          {visibilityUrl ? <button type="button" className="secondary game-replay-visibility-action" disabled={props.busy}
            onClick={(event) => { event.stopPropagation(); props.onWatchWebReplay!(visibilityUrl); }}>
            <Shield size={14} aria-hidden="true" />Change visibility
          </button> : null}
        </div>
      </article>;
    })}
  </section>;
}
