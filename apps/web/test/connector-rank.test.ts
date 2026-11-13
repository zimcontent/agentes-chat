import { describe, expect, test } from "bun:test";
import { matchRank } from "../src/components/connector-rank";

describe("matchRank", () => {
  test("a name that starts with the search beats one that contains it, which beats the rest", () => {
    expect(matchRank("GitHub", "github code hosting", "git")).toBe(0);
    expect(matchRank("Bitbucket", "bitbucket git hosting", "git")).toBe(2);
    expect(matchRank("Digital", "digital", "git")).toBe(1);
    expect(matchRank("Linear", "linear issues", "git")).toBeNull();
  });

  test("ignores case and surrounding spaces, and a blank search ranks nothing", () => {
    expect(matchRank("GitHub", "", "  GIT ")).toBe(0);
    expect(matchRank("GitHub", "", "  ")).toBe(2);
  });
});
