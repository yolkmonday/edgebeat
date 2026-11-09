import { describe, expect, test } from "bun:test";
import { reorderPatches } from "./reorder";

const item = (id: string, sort: number) => ({ id, sort });

describe("reorderPatches", () => {
  test("swaps two neighbours", () => {
    expect(reorderPatches([item("a", 0), item("b", 1), item("c", 2)], 2, -1)).toEqual([
      { id: "c", sort: 1 },
      { id: "b", sort: 2 },
    ]);
  });

  test("renumbers duplicate sort values", () => {
    const patches = reorderPatches([item("a", 0), item("b", 0), item("c", 0)], 2, -1);
    expect(patches).toEqual([
      { id: "c", sort: 1 },
      { id: "b", sort: 2 },
    ]);
  });

  test("does nothing at the edges", () => {
    expect(reorderPatches([item("a", 0), item("b", 1)], 0, -1)).toEqual([]);
    expect(reorderPatches([item("a", 0), item("b", 1)], 1, 1)).toEqual([]);
  });
});
