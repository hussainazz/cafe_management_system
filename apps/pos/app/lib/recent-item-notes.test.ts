// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentItemNotes, rememberItemNotes } from "./recent-item-notes";
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("recent item notes", () => {
  it("keeps twenty unique trimmed notes per product, newest first", () => {
    rememberItemNotes(Array.from({ length: 25 }, (_, index) => ({ productId: "coffee", note: ` note ${index} ` })));
    rememberItemNotes([{ productId: "coffee", note: " note 8 " }, { productId: "tea", note: "بدون قند" }, { productId: "coffee", note: " " }]);
    const notes = readRecentItemNotes("coffee");
    expect(notes).toHaveLength(20);
    expect(notes[0]).toBe("note 8");
    expect(notes.filter((note) => note === "note 8")).toHaveLength(1);
    expect(readRecentItemNotes("tea")).toEqual(["بدون قند"]);
  });
  it("ignores corrupted storage and storage failures", () => {
    localStorage.setItem("cafe.pos.item-notes.v1:coffee", "not JSON");
    expect(readRecentItemNotes("coffee")).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => rememberItemNotes([{ productId: "coffee", note: "hot" }])).not.toThrow();
  });
});
