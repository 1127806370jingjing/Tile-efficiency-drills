import { describe, expect, it } from "vitest";
import { allTileKinds, canWin, createExercise, createListeningExercise, evaluateDiscards, getWaitingTiles } from "./fuzhou";
import type { Tile, TileInstance } from "./fuzhou";

function tile(id: string): Tile {
  const result = allTileKinds.find((item) => item.id === id);
  if (!result) throw new Error(`Missing tile ${id}`);
  return result;
}

function hand(ids: string[]): TileInstance[] {
  return ids.map((id, index) => ({
    ...tile(id),
    instanceId: `${id}-${index}`,
  }));
}

describe("fuzhou rules", () => {
  it("deals a legal 17 tile practice hand", () => {
    const exercise = createExercise();
    const counts = new Map<string, number>();

    exercise.hand.forEach((item) => {
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    });

    expect(exercise.hand).toHaveLength(17);
    expect([...counts.values()].every((count) => count <= 4)).toBe(true);
    expect(exercise.evaluations.length).toBeGreaterThan(0);
  });

  it("recognizes a standard five melds and pair win", () => {
    const gold = tile("wan-9");
    const winningHand = hand([
      "wan-1",
      "wan-2",
      "wan-3",
      "wan-4",
      "wan-5",
      "wan-6",
      "tong-1",
      "tong-2",
      "tong-3",
      "tong-7",
      "tong-7",
      "tong-7",
      "tiao-2",
      "tiao-3",
      "tiao-4",
      "tiao-8",
      "tiao-8",
    ]);

    expect(canWin(winningHand, gold)).toBe(true);
  });

  it("uses gold tiles as wildcards", () => {
    const gold = tile("wan-9");
    const wildcardHand = hand([
      "wan-1",
      "wan-2",
      "wan-9",
      "wan-4",
      "wan-5",
      "wan-6",
      "tong-1",
      "tong-2",
      "tong-3",
      "tong-7",
      "tong-7",
      "tong-7",
      "tiao-2",
      "tiao-3",
      "tiao-4",
      "tiao-8",
      "tiao-8",
    ]);

    expect(canWin(wildcardHand, gold)).toBe(true);
  });

  it("recognizes three golds as a Fuzhou special win", () => {
    const gold = tile("tong-5");
    const threeGoldHand = hand([
      "tong-5",
      "tong-5",
      "tong-5",
      "wan-1",
      "wan-4",
      "wan-7",
      "tong-1",
      "tong-3",
      "tong-8",
      "tiao-1",
      "tiao-3",
      "tiao-5",
      "tiao-7",
      "tiao-9",
      "wan-2",
      "wan-5",
      "wan-8",
    ]);

    expect(canWin(threeGoldHand, gold)).toBe(true);
  });

  it("returns discard evaluations with recommended candidates", () => {
    const gold = tile("wan-9");
    const practiceHand = hand([
      "wan-1",
      "wan-2",
      "wan-3",
      "wan-4",
      "wan-5",
      "wan-6",
      "tong-1",
      "tong-2",
      "tong-3",
      "tong-7",
      "tong-7",
      "tong-7",
      "tiao-2",
      "tiao-3",
      "tiao-4",
      "tiao-8",
      "wan-8",
    ]);

    const evaluations = evaluateDiscards(practiceHand, gold);

    expect(evaluations.length).toBeGreaterThan(1);
    expect(evaluations[0].score).toBeGreaterThanOrEqual(evaluations[evaluations.length - 1].score);
  });

  it("detects waiting tiles for a 16 tile hand", () => {
    const gold = tile("wan-9");
    const listeningHand = hand([
      "wan-1",
      "wan-2",
      "wan-3",
      "wan-4",
      "wan-5",
      "wan-6",
      "tong-1",
      "tong-2",
      "tong-3",
      "tong-7",
      "tong-7",
      "tong-7",
      "tiao-2",
      "tiao-3",
      "tiao-4",
      "tiao-8",
    ]);

    expect(getWaitingTiles(listeningHand, gold).map((item) => item.id)).toContain("tiao-8");
  });

  it("creates listening exercises with at least one wait", () => {
    const exercise = createListeningExercise();

    expect(exercise.hand).toHaveLength(16);
    expect(exercise.waitingTiles.length).toBeGreaterThan(0);
  });
});
