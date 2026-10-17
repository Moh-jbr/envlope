import { describe, expect, it } from "vitest";
import { drawPicker, type PickerView, scrollWindow } from "../src/ui.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const repos = Array.from({ length: 40 }, (_, i) => `repo-${String(i + 1).padStart(2, "0")}`);
const options = repos.map((r) => ({ value: r, label: r }));

function view(overrides: Partial<PickerView> = {}): PickerView {
  return {
    message: "Pick",
    options,
    state: "active",
    cursor: 0,
    value: [],
    error: "",
    top: 0,
    rows: 24,
    columns: 80,
    ...overrides,
  };
}

describe("scrollWindow", () => {
  it("keeps the whole list when it fits", () => {
    expect(scrollWindow(7, 0, 10, 8)).toBe(0);
  });

  it("only scrolls once the cursor nears an edge, keeping a row of context", () => {
    expect(scrollWindow(5, 0, 10, 40)).toBe(0);
    expect(scrollWindow(9, 0, 10, 40)).toBe(1);
    expect(scrollWindow(20, 5, 10, 40)).toBe(12);
    expect(scrollWindow(12, 12, 10, 40)).toBe(11);
    // Wrapping from the top to the last row shows the end of the list.
    expect(scrollWindow(39, 0, 10, 40)).toBe(30);
  });
});

describe("drawPicker", () => {
  it("draws only what fits the terminal, with counts of what's above and below", () => {
    const { frame, top } = drawPicker(view({ rows: 24 }));
    const lines = plain(frame).trimEnd().split("\n");
    // Never taller than the terminal, or clack can't redraw it.
    expect(lines.length).toBeLessThan(24);
    expect(top).toBe(0);
    expect(lines).toContain("│  ↓ 25 more");
    expect(plain(frame)).toContain("◻ repo-01");
    expect(plain(frame)).not.toContain("repo-16");
  });

  it("scrolls with the cursor and shows the rows above", () => {
    const { frame, top } = drawPicker(view({ cursor: 30, top: 0 }));
    expect(top).toBe(17);
    expect(plain(frame)).toContain("↑ 17 more");
    expect(plain(frame)).toContain("↓ 8 more");
    expect(plain(frame)).toContain("repo-31");
  });

  it("ticks chosen rows, counts them, and shows the hint on the cursor's row only", () => {
    const hinted = options.map((o, i) => (i < 2 ? { ...o, hint: "already encrypted" } : o));
    const { frame } = drawPicker(view({ options: hinted, value: ["repo-01", "repo-03"] }));
    const text = plain(frame);
    expect(text).toContain("◼ repo-01  (already encrypted)");
    expect(text).toContain("◻ repo-02\n");
    expect(text).toContain("◼ repo-03");
    expect(text).toContain("2 of 40 ticked");
  });

  it("shows a short list whole", () => {
    const { frame } = drawPicker(view({ options: options.slice(0, 3) }));
    expect(plain(frame)).not.toMatch(/more/);
    expect(plain(frame)).toContain("repo-03");
  });

  it("cuts labels that would wrap", () => {
    const long = [{ value: "x", label: "a-very-long-repository-name-that-goes-on-and-on" }];
    const { frame } = drawPicker(view({ options: long, columns: 30 }));
    // 30 columns leave 22 for the label: 21 characters and the ellipsis.
    expect(plain(frame)).toContain("◻ a-very-long-repositor…\n");
  });

  it("sums up the choice once submitted", () => {
    const { frame } = drawPicker(
      view({ state: "submit", value: ["repo-01", "repo-02", "repo-03", "repo-04", "repo-05"] }),
    );
    expect(plain(frame)).toContain("5 · repo-01, repo-02, repo-03, repo-04 and 1 more");
  });
});
