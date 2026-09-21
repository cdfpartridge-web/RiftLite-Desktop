import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import type { AtlasGameLog } from "../shared/atlasGameLog";
import { atlasGameLogActor, atlasGameLogText, loadAtlasMatchGameLog, type AtlasGameLogSegment } from "../shared/atlasMatchGameLog";
import type { MatchDraft } from "../shared/types";
import "./styles/atlas-game-log.css";

const EMPTY_LOG: AtlasGameLog = { games: [], source: "none", partial: false };
const PAGE_SIZE = 200;

export function AtlasGameLogDialog({ match, segments, onClose }: {
  match: MatchDraft;
  segments: AtlasGameLogSegment[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [log, setLog] = useState<AtlasGameLog>(EMPTY_LOG);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setLog(EMPTY_LOG);
    void loadAtlasMatchGameLog(match, segments, (id) => window.riftlite.getRawCapturePayload(id))
      .then((result) => { if (active) setLog(result); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [match, segments]);
  return (
    <dialog
      ref={dialogRef}
      className="atlas-game-log-dialog"
      aria-labelledby="atlas-game-log-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
    >
      <header className="atlas-game-log-heading">
        <div>
          <span>ATLAS · MATCH HISTORY</span>
          <h2 id="atlas-game-log-title">Game log</h2>
          <p>{match.myChampion || "You"} vs {match.opponentChampion || "Opponent"} · {new Date(match.capturedAt).toLocaleDateString()}</p>
        </div>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close game log"><X size={16} /> Close</button>
      </header>
      <AtlasGameLogContent key={match.id} log={log} loading={loading} failed={failed} />
    </dialog>
  );
}

export function AtlasGameLogContent({ log, loading = false, failed = false }: {
  log: AtlasGameLog;
  loading?: boolean;
  failed?: boolean;
}) {
  const [gameId, setGameId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const copyGeneration = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const allEntries = useMemo(() => log.games.flatMap((game) => game.entries.map((entry) => ({ ...entry, gameId: game.id, gameNumber: game.gameNumber }))), [log]);
  const query = search.trim().toLocaleLowerCase();
  const entries = useMemo(() => allEntries.filter((entry) => (!gameId || entry.gameId === gameId)
    && (!query || `${entry.text} ${entry.actor ?? ""}`.toLocaleLowerCase().includes(query))), [allEntries, gameId, query]);
  const lastPage = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  const visible = entries.slice(start, start + PAGE_SIZE);
  useEffect(() => {
    copyGeneration.current += 1;
    setCopyStatus("");
    listRef.current?.scrollTo({ top: 0 });
  }, [gameId, query, currentPage]);
  async function copy() {
    const generation = ++copyGeneration.current;
    try {
      await navigator.clipboard.writeText(atlasGameLogText(log, gameId, search));
      if (copyGeneration.current === generation) setCopyStatus("Copied to clipboard.");
    } catch { if (copyGeneration.current === generation) setCopyStatus("Could not copy. You can select and copy the log text below."); }
  }
  if (loading) return <p className="atlas-game-log-empty" role="status">Loading captured game log…</p>;
  if (failed) return <p className="atlas-game-log-empty" role="alert">The saved game log could not be opened. Close this window and try again.</p>;
  if (!allEntries.length) return <p className="atlas-game-log-empty">No game log was saved for this match. Logs are available when the Atlas replay capture has been kept.</p>;
  return (
    <div className="atlas-game-log-content">
      {log.games.length > 1 ? (
        <div className="atlas-game-log-games" role="group" aria-label="Log game">
          <button type="button" aria-pressed={!gameId} onClick={() => { setGameId(""); setPage(0); }}>All games</button>
          {log.games.map((game) => <button type="button" key={game.id} aria-pressed={gameId === game.id} onClick={() => { setGameId(game.id); setPage(0); }}>Game {game.gameNumber}</button>)}
        </div>
      ) : null}
      <div className="atlas-game-log-tools">
        <label className="atlas-game-log-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search game log" placeholder="Search cards, players or actions" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <button type="button" className="secondary" disabled={!entries.length} onClick={() => void copy()}><Copy size={15} /> {query ? "Copy results" : "Copy log"}</button>
      </div>
      {log.partial ? <p className="atlas-game-log-note">Only retained entries are available for this capture. Some parts of the game may be missing.</p> : null}
      <div className="atlas-game-log-summary"><span>{entries.length.toLocaleString()} {query ? "matching " : ""}entries · oldest first</span><span role="status">{copyStatus}</span></div>
      <ol className="atlas-game-log-entries" ref={listRef} aria-label="Captured game log" tabIndex={0}>
        {visible.map((entry, index) => (
          <li key={`${entry.gameId}:${entry.id}`} data-turn={/^(?:turn\s+\d+|.+['’]s turn\b)/i.test(entry.text)}>
            {log.games.length > 1 && (index === 0 || visible[index - 1].gameId !== entry.gameId) ? <div className="atlas-game-log-divider">Game {entry.gameNumber}</div> : null}
            <div className="atlas-game-log-line"><time>{entry.time || "—"}</time><p>{atlasGameLogActor(entry) ? <strong>{entry.actor} · </strong> : null}{entry.text}</p></div>
          </li>
        ))}
        {!entries.length ? <li className="atlas-game-log-empty">No entries match your search.</li> : null}
      </ol>
      {entries.length > PAGE_SIZE ? <nav className="atlas-game-log-pages" aria-label="Game log pages">
        <button type="button" className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, entries.length)} of {entries.length.toLocaleString()}</span>
        <button type="button" className="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav> : null}
    </div>
  );
}
