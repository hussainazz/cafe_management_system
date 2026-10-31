import { describe, expect, it } from "vitest";
import {
  createMenuImageReadiness,
  isMenuImageReadinessComplete,
  settleMenuImage,
} from "./menu-image-readiness";

describe("menu image readiness", () => {
  it("keeps the menu opening state pending until every image has loaded or fallen back", () => {
    const identity = "manager-a|bundle-b|bundle-c";
    const images = ["manager-a", "bundle-b", "bundle-c"];
    let state = createMenuImageReadiness(identity, images);

    expect(isMenuImageReadinessComplete(state, identity)).toBe(false);
    state = settleMenuImage(state, identity, images, "manager-a");
    state = settleMenuImage(state, identity, images, "bundle-b");
    expect(isMenuImageReadinessComplete(state, identity)).toBe(false);
    state = settleMenuImage(state, identity, images, "bundle-c");
    expect(isMenuImageReadinessComplete(state, identity)).toBe(true);
  });

  it("resets readiness when the product image set changes", () => {
    const previous = createMenuImageReadiness("image-a", ["image-a"]);
    const completed = settleMenuImage(previous, "image-a", ["image-a"], "image-a");
    const next = settleMenuImage(completed, "image-b", ["image-b", "image-c"], "image-b");

    expect(isMenuImageReadinessComplete(next, "image-a")).toBe(false);
    expect(isMenuImageReadinessComplete(next, "image-b")).toBe(false);
    expect(settleMenuImage(next, "image-b", ["image-b", "image-c"], "image-c").settled.size).toBe(2);
  });

  it("treats a menu with no image URLs as ready", () => {
    expect(isMenuImageReadinessComplete(createMenuImageReadiness("", []), "")).toBe(true);
  });
});
