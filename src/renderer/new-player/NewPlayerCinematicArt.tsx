import { useState } from "react";
import { resolveCardArtwork } from "../cardArtwork";

/** A decorative crop of the same real card used in the lessons; full cards stay readable in the board. */
export function NewPlayerCinematicArt({ cardId, caption, className = "", loading = "eager" }: { cardId: string; caption?: string; className?: string; loading?: "eager" | "lazy" }) {
  const [failed, setFailed] = useState(false);
  return <figure className={`nph-cinematic-art ${className}`} aria-hidden="true">
    {!failed && <img src={resolveCardArtwork(cardId)} alt="" loading={loading} decoding="async" onError={() => setFailed(true)} />}
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}
