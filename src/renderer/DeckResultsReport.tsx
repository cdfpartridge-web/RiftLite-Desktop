import React, { useMemo, useState } from "react";
import { ArrowUpRight, Database, ShieldCheck, Swords } from "lucide-react";
import { buildDeckBo3Results, buildDeckDataCompleteness, type CoverageCount, type SeriesRate } from "../shared/deckResults";
import type { MatchDraft, ReplayRecord } from "../shared/types";
import "./styles/deck-results.css";

export function DeckResultsReport({ matches, replays, onOpenReplay }: {
  matches: MatchDraft[];
  replays: ReplayRecord[];
  onOpenReplay: (replayId: string) => void;
}) {
  const completeness = useMemo(() => buildDeckDataCompleteness(matches), [matches]);
  const series = useMemo(() => buildDeckBo3Results(matches), [matches]);
  const replayByMatch = useMemo(() => new Map(replays.filter((replay) => !replay.deletedAt).map((replay) => [replay.matchId, replay.id])), [replays]);
  const [supportIds, setSupportIds] = useState<string[] | null>(null);
  const supporting = supportIds ? series.included.filter(({ match }) => supportIds.includes(match.id)) : series.included;

  return <div className="deck-results-report">
    <section className="deck-insights-panel deck-results-coverage" aria-label="Match data completeness">
      <header className="deck-results-heading"><Database size={20} /><div><small>YOUR DATA</small><h3>Know what is behind the numbers.</h3><p>{completeness.savedMatches} saved matches in this scope. Missing fields stay visible in every sample.</p></div></header>
      <div className="deck-results-coverage-grid">
        <Coverage label="Battlefield pairs" count={completeness.battlefields} unit="games" detail={`${completeness.myBattlefields.known} own · ${completeness.opponentBattlefields.known} opponent fields known`} />
        <Coverage label="First or second" count={completeness.initiative} unit="games" detail="Unknown and undecided seats are not assigned." />
        <Coverage label="Both point scores" count={completeness.scores} unit="games" detail="Includes a recorded zero; missing is not zero." />
        <Coverage label="Stored deck lists" count={completeness.storedDeckLists} unit="matches" detail="A usable main-deck snapshot is attached." />
      </div>
      <p className="deck-results-note"><ShieldCheck size={15} /> A stored list identifies recorded card contents; older records may not say whether the list came from capture or a fallback.</p>
      <details className="deck-results-method"><summary>How these counts work</summary><p>Game fields use {completeness.games} recorded game rows{completeness.legacySingleGames ? `, including ${completeness.legacySingleGames} legacy Bo1 match records` : ""}. Match-level battlefield names may fill game one only. Stored-list coverage uses saved matches, including incomplete results.</p><p>{completeness.matchesWithoutGameRows} matches have no usable game breakdown and are outside the game-field denominator. {completeness.excludedMatches} pending, incomplete-review, hidden, merged or deleted records are outside all counts. Missing game rows are never invented for a Bo3.</p></details>
    </section>

    <section className="deck-insights-panel deck-results-series" aria-label="Best of three results">
      <header className="deck-results-heading"><Swords size={20} /><div><small>BEST OF THREE</small><h3>From the opener to the series.</h3><p>{series.included.length} complete series included · {series.excluded.length} excluded from {series.considered} saved Bo3 matches.</p></div></header>
      <div className="deck-results-series-grid">
        <Rate label="Game-one win rate" value={series.gameOne} detail="How often you won the opening game." />
        <Rate label="Closed out the lead" value={series.conversion} detail="Match wins after winning game one." />
        <Rate label="Came back to win" value={series.comeback} detail="Match wins after losing game one." />
      </div>
      <p className="deck-results-note">Every rate shows its own sample. Later-game results describe outcomes; they do not establish that a sideboard change caused them.</p>

      {series.laterGames.length ? <div className="deck-results-table-wrap"><table className="deck-results-table"><caption>Games two and three by matchup and initiative</caption><thead><tr><th scope="col">Opponent legend</th><th scope="col">Initiative</th><th scope="col">Game 2</th><th scope="col">Game 3</th><th scope="col">Later games</th><th scope="col"><span className="deck-results-sr-only">Supporting matches</span></th></tr></thead><tbody>{series.laterGames.map((row) => <tr key={`${row.opponent}:${row.initiative}`}><th scope="row">{row.opponent}</th><td>{row.initiative === "1st" ? "Going first" : row.initiative === "2nd" ? "Going second" : "Unknown"}</td><td>{record(row.game2)}</td><td>{record(row.game3)}</td><td><strong>{rateLabel(row.overall)}</strong><small>{record(row.overall)} · {row.overall.total} {row.overall.total === 1 ? "game" : "games"}</small></td><td><button type="button" className="secondary" onClick={() => setSupportIds(row.matchIds)}>View {row.matchIds.length} {row.matchIds.length === 1 ? "match" : "matches"}</button></td></tr>)}</tbody></table></div> : <div className="deck-results-empty"><Swords size={26} /><strong>No complete Bo3 sample in this scope</strong><p>Save a series with consecutive game numbers, finished results and a matching series score to build this report.</p></div>}
      {series.laterInitiativeUnknown ? <p className="deck-results-note">{series.laterInitiativeUnknown} later {series.laterInitiativeUnknown === 1 ? "game has" : "games have"} unknown initiative, shown separately.</p> : null}

      {series.included.length ? <details className="deck-results-support" open={supportIds !== null} onToggle={(event) => { if (!event.currentTarget.open && supportIds !== null) setSupportIds(null); }}><summary>Supporting matches · {supporting.length}{supportIds ? " in this row" : " included"}</summary>{supportIds ? <button type="button" className="secondary" onClick={() => setSupportIds(null)}>Show all included matches</button> : null}<div className="deck-results-match-list">{supporting.slice(0, 100).map(({ match, games }) => <article key={match.id}><div><strong>{match.opponentChampion || "Unknown legend"} · {match.result} {match.score}</strong><span>{friendlyDate(match.capturedAt)} · {match.platform.toUpperCase()} · {games.map((game) => `G${game.gameNumber} ${game.result}`).join(" / ")}</span></div>{replayByMatch.has(match.id) ? <button type="button" className="secondary" onClick={() => onOpenReplay(replayByMatch.get(match.id)!)}>Replay <ArrowUpRight size={14} /></button> : <small>No local replay</small>}</article>)}</div>{supporting.length > 100 ? <p className="deck-results-note">Showing 100 of {supporting.length} supporting matches. Narrow the date or matchup filters to see a smaller sample.</p> : null}</details> : null}
      <details className="deck-results-method"><summary>Series eligibility{series.excluded.length ? ` · ${series.excluded.length} excluded` : ""}</summary><p>Only saved Bo3s with consecutive games 1–2 or 1–3, a win/loss for each game, a winner reaching two wins on the last game, and a matching headline result and score are included. Manually combined games are excluded because their original sequence is not verified.</p>{series.excluded.length ? <div className="deck-results-match-list">{series.excluded.slice(0, 100).map(({ match, reason }) => <article key={match.id}><div><strong>{match.opponentChampion || "Unknown legend"} · {friendlyDate(match.capturedAt)}</strong><span>{reason}</span></div></article>)}</div> : null}{series.excluded.length > 100 ? <p>Showing the first 100 exclusions. Narrow the scope to inspect the rest.</p> : null}</details>
    </section>
  </div>;
}

function Coverage({ label, count, unit, detail }: { label: string; count: CoverageCount; unit: string; detail: string }) {
  return <article><span>{label}</span><strong>{count.known}<em> / {count.total}</em></strong><small>{unit} with data</small><div className="deck-results-meter" aria-hidden="true"><i style={{ width: `${count.total ? count.known / count.total * 100 : 0}%` }} /></div><p>{detail}</p></article>;
}
function Rate({ label, value, detail }: { label: string; value: SeriesRate; detail: string }) {
  return <article><span>{label}</span><strong>{rateLabel(value)}</strong><small>{value.wins} of {value.total} series{value.total > 0 && value.total < 10 ? " · small sample" : ""}</small><p>{detail}</p></article>;
}
function rateLabel(value: SeriesRate): string { return value.total ? `${Math.round(value.wins / value.total * 100)}%` : "No sample"; }
function record(value: SeriesRate): string { return value.total ? `${value.wins}–${value.total - value.wins}` : "—"; }
function friendlyDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unknown" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
