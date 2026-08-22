export type Suit = "wan" | "tong" | "tiao";

export type Tile = {
  id: string;
  suit: Suit;
  rank: number;
};

export type TileInstance = Tile & {
  instanceId: string;
};

export type HintLevel = "off" | "light" | "teaching";

export type SpecialPattern = {
  name: string;
  description: string;
};

export type DiscardEvaluation = {
  tile: Tile;
  copiesInHand: number;
  score: number;
  winningDraws: Tile[];
  winningDrawCopies: number;
  structureScore: number;
  isolatedPenalty: number;
  reasons: string[];
};

export type Exercise = {
  hand: TileInstance[];
  gold: Tile;
  evaluations: DiscardEvaluation[];
  bestDiscardIds: string[];
  specialPatterns: SpecialPattern[];
};

export type ListeningExercise = {
  hand: TileInstance[];
  gold: Tile;
  waitingTiles: Tile[];
  waitingCopies: number;
  specialPatterns: SpecialPattern[];
};

export type DrawSession = {
  hand: TileInstance[];
  gold: Tile;
  wall: TileInstance[];
  river: TileInstance[];
  drawnTile: TileInstance | null;
  round: number;
  maxRounds: number;
  evaluations: DiscardEvaluation[];
  bestDiscardIds: string[];
  waitingTiles: Tile[];
  waitingCopies: number;
  specialPatterns: SpecialPattern[];
  won: boolean;
  exhausted: boolean;
};

const suits: Suit[] = ["wan", "tong", "tiao"];

export const suitLabels: Record<Suit, string> = {
  wan: "万",
  tong: "筒",
  tiao: "条",
};

export const allTileKinds: Tile[] = suits.flatMap((suit) =>
  Array.from({ length: 9 }, (_, index) => ({
    id: `${suit}-${index + 1}`,
    suit,
    rank: index + 1,
  })),
);

const tileById = new Map(allTileKinds.map((tile) => [tile.id, tile]));

export function tileLabel(tile: Tile): string {
  return `${tile.rank}${suitLabels[tile.suit]}`;
}

function tileSortValue(tile: Tile): number {
  return suits.indexOf(tile.suit) * 10 + tile.rank;
}

export function sortHand(hand: TileInstance[], gold: Tile): TileInstance[] {
  return [...hand].sort((a, b) => {
    if (a.id === gold.id && b.id !== gold.id) return 1;
    if (b.id === gold.id && a.id !== gold.id) return -1;
    return tileSortValue(a) - tileSortValue(b);
  });
}

export function createExercise(): Exercise {
  let exercise = dealExercise();
  let guard = 0;

  while (exercise.evaluations.length < 2 && guard < 20) {
    exercise = dealExercise();
    guard += 1;
  }

  return exercise;
}

export function createListeningExercise(): ListeningExercise {
  let exercise = dealListeningExercise();
  let guard = 0;

  while (exercise.waitingTiles.length === 0 && guard < 80) {
    exercise = dealListeningExercise();
    guard += 1;
  }

  return exercise;
}

export function createDrawSession(maxRounds = 18): DrawSession {
  const gold = randomItem(allTileKinds);
  const wall = buildWall();
  shuffle(wall);

  const session = hydrateDrawSession({
    hand: sortHand(wall.slice(0, 16), gold),
    gold,
    wall: wall.slice(16),
    river: [],
    drawnTile: null,
    round: 0,
    maxRounds,
  });

  return drawFromWall(session);
}

export function drawFromWall(session: DrawSession): DrawSession {
  if (session.drawnTile || session.won || session.exhausted || session.round >= session.maxRounds) {
    return hydrateDrawSession(session);
  }

  const [drawnTile, ...wall] = session.wall;
  if (!drawnTile) {
    return hydrateDrawSession({ ...session, exhausted: true });
  }

  return hydrateDrawSession({
    ...session,
    hand: sortHand([...session.hand, drawnTile], session.gold),
    wall,
    drawnTile,
    round: session.round + 1,
  });
}

export function discardFromDrawSession(session: DrawSession, tileId: string): DrawSession {
  if (!session.drawnTile || session.won) return hydrateDrawSession(session);

  const discarded = session.hand.find((tile) => tile.id === tileId);
  if (!discarded) return hydrateDrawSession(session);

  return hydrateDrawSession({
    ...session,
    hand: sortHand(removeOneTile(session.hand, tileId), session.gold),
    river: [...session.river, discarded],
    drawnTile: null,
  });
}

function dealListeningExercise(): ListeningExercise {
  const gold = randomItem(allTileKinds);
  const wall = buildWall();
  shuffle(wall);
  const hand = sortHand(wall.slice(0, 16), gold);
  const waitingTiles = getWaitingTiles(hand, gold);
  const remainingCounts = getRemainingCounts(hand);
  const waitingCopies = waitingTiles.reduce((sum, tile) => sum + (remainingCounts.get(tile.id) ?? 0), 0);

  return {
    hand,
    gold,
    waitingTiles,
    waitingCopies,
    specialPatterns: describeSpecialPatterns(hand, gold),
  };
}

function dealExercise(): Exercise {
  const gold = randomItem(allTileKinds);
  const wall = buildWall();
  shuffle(wall);
  const hand = sortHand(wall.slice(0, 17), gold);
  const evaluations = evaluateDiscards(hand, gold);
  const bestScore = Math.max(...evaluations.map((item) => item.score));
  const bestDiscardIds = evaluations
    .filter((item) => item.score >= bestScore - 0.01)
    .map((item) => item.tile.id);

  return {
    hand,
    gold,
    evaluations,
    bestDiscardIds,
    specialPatterns: describeSpecialPatterns(hand, gold),
  };
}

function hydrateDrawSession(
  session: Omit<
    DrawSession,
    "evaluations" | "bestDiscardIds" | "waitingTiles" | "waitingCopies" | "specialPatterns" | "won" | "exhausted"
  > &
    Partial<
      Pick<
        DrawSession,
        "evaluations" | "bestDiscardIds" | "waitingTiles" | "waitingCopies" | "specialPatterns" | "won" | "exhausted"
      >
    >,
): DrawSession {
  const evaluations = session.drawnTile ? evaluateDiscards(session.hand, session.gold) : [];
  const bestScore = evaluations.length > 0 ? Math.max(...evaluations.map((item) => item.score)) : 0;
  const bestDiscardIds = evaluations
    .filter((item) => item.score >= bestScore - 0.01)
    .map((item) => item.tile.id);
  const baseHand = session.drawnTile ? removeOneTile(session.hand, session.drawnTile.id) : session.hand;
  const waitingTiles = getWaitingTiles(baseHand, session.gold);
  const remainingCounts = getRemainingCounts([...session.hand, ...session.river]);
  const waitingCopies = waitingTiles.reduce((sum, tile) => sum + (remainingCounts.get(tile.id) ?? 0), 0);

  return {
    ...session,
    evaluations,
    bestDiscardIds,
    waitingTiles,
    waitingCopies,
    specialPatterns: describeSpecialPatterns(session.hand, session.gold),
    won: canWin(session.hand, session.gold),
    exhausted:
      session.exhausted ?? ((session.wall.length === 0 || session.round >= session.maxRounds) && !session.drawnTile),
  };
}

function buildWall(): TileInstance[] {
  return allTileKinds.flatMap((tile) =>
    Array.from({ length: 4 }, (_, copy) => ({
      ...tile,
      instanceId: `${tile.id}-${copy}`,
    })),
  );
}

function shuffle<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function evaluateDiscards(hand: TileInstance[], gold: Tile): DiscardEvaluation[] {
  const uniqueTiles = uniqueTilesInHand(hand);
  const remainingWall = getRemainingCounts(hand);

  return uniqueTiles
    .map((tile) => {
      const afterDiscard = removeOneTile(hand, tile.id);
      const winningDraws = allTileKinds.filter((draw) =>
        (remainingWall.get(draw.id) ?? 0) > 0 && canWin([...afterDiscard, toInstance(draw, "draw")], gold),
      );
      const winningDrawCopies = winningDraws.reduce(
        (sum, draw) => sum + (remainingWall.get(draw.id) ?? 0),
        0,
      );
      const shape = scoreShape(afterDiscard, gold);
      const score = winningDrawCopies * 100 + winningDraws.length * 12 + shape.structureScore - shape.isolatedPenalty;

      return {
        tile,
        copiesInHand: hand.filter((item) => item.id === tile.id).length,
        score,
        winningDraws,
        winningDrawCopies,
        structureScore: shape.structureScore,
        isolatedPenalty: shape.isolatedPenalty,
        reasons: buildReasons(tile, afterDiscard, gold, winningDraws, winningDrawCopies, shape),
      };
    })
    .sort((a, b) => b.score - a.score || tileSortValue(a.tile) - tileSortValue(b.tile));
}

function toInstance(tile: Tile, suffix: string): TileInstance {
  return {
    ...tile,
    instanceId: `${tile.id}-${suffix}`,
  };
}

function uniqueTilesInHand(hand: TileInstance[]): Tile[] {
  const ids = Array.from(new Set(hand.map((tile) => tile.id)));
  return ids.map((id) => tileById.get(id)!).sort((a, b) => tileSortValue(a) - tileSortValue(b));
}

function removeOneTile(hand: TileInstance[], tileId: string): TileInstance[] {
  const index = hand.findIndex((tile) => tile.id === tileId);
  return hand.filter((_, itemIndex) => itemIndex !== index);
}

function getRemainingCounts(hand: TileInstance[]): Map<string, number> {
  const counts = new Map(allTileKinds.map((tile) => [tile.id, 4]));
  hand.forEach((tile) => counts.set(tile.id, Math.max(0, (counts.get(tile.id) ?? 0) - 1)));
  return counts;
}

export function getWaitingTiles(hand: TileInstance[], gold: Tile): Tile[] {
  if (hand.length % 3 !== 1) return [];
  const remainingWall = getRemainingCounts(hand);

  return allTileKinds.filter(
    (draw) => (remainingWall.get(draw.id) ?? 0) > 0 && canWin([...hand, toInstance(draw, "listen")], gold),
  );
}

export function canWin(hand: TileInstance[], gold: Tile): boolean {
  const wilds = hand.filter((tile) => tile.id === gold.id).length;
  const counts = countTiles(hand.filter((tile) => tile.id !== gold.id));

  if (wilds >= 3) return true;
  if (hand.length % 3 !== 2) return false;

  const meldTarget = Math.floor((hand.length - 2) / 3);
  return canMakeStandardWin(counts, wilds, meldTarget);
}

function countTiles(hand: TileInstance[]): number[] {
  const counts = Array(27).fill(0);
  hand.forEach((tile) => {
    counts[tileIndex(tile)] += 1;
  });
  return counts;
}

function tileIndex(tile: Tile): number {
  return suits.indexOf(tile.suit) * 9 + tile.rank - 1;
}

function canMakeStandardWin(counts: number[], wilds: number, meldTarget: number): boolean {
  for (let pairIndex = -1; pairIndex < 27; pairIndex += 1) {
    const nextCounts = [...counts];
    let wildsLeft = wilds;

    if (pairIndex === -1) {
      if (wildsLeft < 2) continue;
      wildsLeft -= 2;
    } else {
      const needed = Math.max(0, 2 - nextCounts[pairIndex]);
      if (needed > wildsLeft) continue;
      nextCounts[pairIndex] = Math.max(0, nextCounts[pairIndex] - 2);
      wildsLeft -= needed;
    }

    if (canMakeMelds(nextCounts, wildsLeft, meldTarget, new Map())) return true;
  }

  return false;
}

function canMakeMelds(
  counts: number[],
  wilds: number,
  meldsLeft: number,
  memo: Map<string, boolean>,
): boolean {
  const key = `${counts.join("")}|${wilds}|${meldsLeft}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const first = counts.findIndex((count) => count > 0);
  if (first === -1) {
    const result = wilds >= meldsLeft * 3;
    memo.set(key, result);
    return result;
  }

  if (meldsLeft <= 0) {
    const result = counts.every((count) => count === 0);
    memo.set(key, result);
    return result;
  }

  const tryTriplet = () => {
    const needed = Math.max(0, 3 - counts[first]);
    if (needed > wilds) return false;
    const nextCounts = [...counts];
    nextCounts[first] = Math.max(0, nextCounts[first] - 3);
    return canMakeMelds(nextCounts, wilds - needed, meldsLeft - 1, memo);
  };

  const trySequence = () => {
    const suitStart = Math.floor(first / 9) * 9;
    const offset = first - suitStart;
    if (offset > 6) return false;

    const sequence = [first, first + 1, first + 2];
    let wildsNeeded = 0;
    const nextCounts = [...counts];

    sequence.forEach((item) => {
      if (nextCounts[item] > 0) {
        nextCounts[item] -= 1;
      } else {
        wildsNeeded += 1;
      }
    });

    if (wildsNeeded > wilds) return false;
    return canMakeMelds(nextCounts, wilds - wildsNeeded, meldsLeft - 1, memo);
  };

  const result = tryTriplet() || trySequence();
  memo.set(key, result);
  return result;
}

function scoreShape(hand: TileInstance[], gold: Tile): { structureScore: number; isolatedPenalty: number } {
  const countsBySuit = new Map<Suit, number[]>(
    suits.map((suit) => [suit, Array(10).fill(0)]),
  );
  const wildCount = hand.filter((tile) => tile.id === gold.id).length;

  hand
    .filter((tile) => tile.id !== gold.id)
    .forEach((tile) => {
      countsBySuit.get(tile.suit)![tile.rank] += 1;
    });

  let structureScore = wildCount * 24;
  let isolatedPenalty = 0;

  suits.forEach((suit) => {
    const counts = countsBySuit.get(suit)!;
    for (let rank = 1; rank <= 9; rank += 1) {
      if (counts[rank] >= 3) structureScore += 30;
      if (counts[rank] === 2) structureScore += 12;
      if (counts[rank] === 1) {
        const hasNeighbor = counts[rank - 1] > 0 || counts[rank + 1] > 0;
        const hasGap = counts[rank - 2] > 0 || counts[rank + 2] > 0;
        if (!hasNeighbor && !hasGap) isolatedPenalty += rank === 1 || rank === 9 ? 10 : 8;
      }
      if (rank <= 7) {
        const sequenceCount = Math.min(counts[rank], counts[rank + 1], counts[rank + 2]);
        structureScore += sequenceCount * 26;
      }
      if (rank <= 8) {
        const adjacent = Math.min(counts[rank], counts[rank + 1]);
        structureScore += adjacent * 7;
      }
      if (rank <= 7) {
        const gap = Math.min(counts[rank], counts[rank + 2]);
        structureScore += gap * 4;
      }
    }
  });

  return { structureScore, isolatedPenalty };
}

function buildReasons(
  tile: Tile,
  afterDiscard: TileInstance[],
  gold: Tile,
  winningDraws: Tile[],
  winningDrawCopies: number,
  shape: { structureScore: number; isolatedPenalty: number },
): string[] {
  const reasons: string[] = [];
  const sameSuit = afterDiscard.filter((item) => item.suit === tile.suit && item.id !== gold.id);
  const hasNeighbor = sameSuit.some((item) => Math.abs(item.rank - tile.rank) === 1);
  const hasGap = sameSuit.some((item) => Math.abs(item.rank - tile.rank) === 2);

  if (tile.id === gold.id) {
    reasons.push("金牌是万能牌，通常不建议主动打掉，除非规则或牌局目标非常特殊。");
  } else if (!hasNeighbor && !hasGap) {
    reasons.push(`${tileLabel(tile)}和周围牌联系弱，保留后形成顺子的机会较少。`);
  } else if (!hasNeighbor && hasGap) {
    reasons.push(`${tileLabel(tile)}只有嵌张联系，速度通常不如连续搭子。`);
  } else {
    reasons.push(`${tileLabel(tile)}仍有联络，打掉它需要看整体进张是否更好。`);
  }

  if (winningDraws.length > 0) {
    reasons.push(`打掉后已有 ${winningDraws.length} 种胡牌进张，共 ${winningDrawCopies} 张可见剩余机会。`);
  } else {
    reasons.push("打掉后暂未直接听牌，主要看是否保留更多完整面子、对子和两面搭子。");
  }

  if (shape.isolatedPenalty > 0) {
    reasons.push("这手牌里有孤张负担，优先清理低联络牌能让牌形更集中。");
  }

  return reasons;
}

function describeSpecialPatterns(hand: TileInstance[], gold: Tile): SpecialPattern[] {
  const goldCount = hand.filter((tile) => tile.id === gold.id).length;
  const patterns: SpecialPattern[] = [];

  if (goldCount >= 3) {
    patterns.push({
      name: "三金倒 / 三头金",
      description: "手中三张金在福州麻将里通常属于特殊胡形，练习时要优先识别。",
    });
  } else if (goldCount === 2) {
    patterns.push({
      name: "双金成雀",
      description: "两张金常可作为雀头使用，留金价值很高。",
    });
  } else if (goldCount === 1) {
    patterns.push({
      name: "单金",
      description: "金牌可补顺、补刻或补雀头，通常是全手牌效最高的牌。",
    });
  }

  if (canWin(hand, gold)) {
    patterns.push({
      name: "已成胡形",
      description: "这手牌已经满足胡牌结构，后续听牌练习会专门考这个判断。",
    });
  }

  return patterns;
}

export function getEvaluationForTile(exercise: Exercise, tileId: string): DiscardEvaluation | undefined {
  return exercise.evaluations.find((item) => item.tile.id === tileId);
}

export function getBestEvaluations(exercise: Exercise): DiscardEvaluation[] {
  return exercise.evaluations.filter((item) => exercise.bestDiscardIds.includes(item.tile.id));
}
