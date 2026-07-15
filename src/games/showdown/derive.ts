import type { ShowdownContentType, ShowdownState } from "../../types";

// Mirrors server/showdown.js's roundPairs/currentMatch/derivePlacements — the
// server is authoritative for state mutation, but the client derives the same
// "what's on screen right now" view locally so we don't need to ship redundant
// derived fields over the wire on every state update.

export function roundPairs(state: ShowdownState, round: number): [string, string][] {
  if (round === 0) return state.bracket;
  const prevWinners = state.history
    .filter((h) => h.round === round - 1)
    .sort((a, b) => a.matchIndex - b.matchIndex)
    .map((h) => h.winner);
  if (prevWinners.length <= 1) return []; // 1 winner left = champion, no next round
  const pairs: [string, string][] = [];
  for (let i = 0; i < prevWinners.length; i += 2) pairs.push([prevWinners[i], prevWinners[i + 1]]);
  return pairs;
}

export function currentMatch(state: ShowdownState): [string, string] | null {
  const pairs = roundPairs(state, state.round);
  return pairs[state.matchIndex] || null;
}

export interface PlacementGroup {
  label: string;
  ids: string[];
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function placeLabel(round: number, maxRound: number): string {
  const stepsFromFinal = maxRound - round;
  const size = 2 ** (stepsFromFinal + 1);
  const start = size / 2 + 1;
  const end = size;
  return start === end ? `${ordinal(start)} place` : `${ordinal(start)}–${ordinal(end)} place`;
}

export function derivePlacements(state: ShowdownState): PlacementGroup[] {
  if (!state.history.length) return [];
  const maxRound = state.history.reduce((m, h) => Math.max(m, h.round), 0);
  const final = state.history.filter((h) => h.round === maxRound);
  const champion = final[0]?.winner;
  const runnerUp = final[0]?.pair.find((id) => id !== champion);
  const groups: PlacementGroup[] = [{ label: "Champion", ids: champion ? [champion] : [] }];
  if (runnerUp) groups.push({ label: "Runner-up", ids: [runnerUp] });
  for (let round = maxRound - 1; round >= 0; round--) {
    const losers = state.history
      .filter((h) => h.round === round)
      .map((h) => h.pair.find((id) => id !== h.winner))
      .filter((id): id is string => !!id);
    if (losers.length) groups.push({ label: placeLabel(round, maxRound), ids: losers });
  }
  return groups;
}

export function totalRounds(size: number): number {
  return Math.log2(size);
}

export function roundName(round: number, size: number): string {
  const remaining = size / 2 ** round;
  if (remaining === 2) return "Final";
  if (remaining === 4) return "Semifinal";
  if (remaining === 8) return "Quarterfinal";
  return `Round of ${remaining}`;
}

export function contentTypeLabel(contentType: ShowdownContentType): string {
  if (contentType === "endings") return "endings";
  if (contentType === "mixed") return "main themes";
  return "openings";
}
