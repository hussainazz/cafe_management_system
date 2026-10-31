import { describe, expect, it } from "vitest";
import {
  createProductImageState,
  isProductImageNearViewport,
  productImageRetryDelays,
  productImageStallTimeoutMs,
  reduceProductImageState,
} from "./product-image-state";

const event = reduceProductImageState;

describe("product image loading state", () => {
  it("keeps offscreen lazy images waiting without arming a stall timeout", () => {
    const waiting = createProductImageState("item-a:image-a", 2);

    expect(waiting.phase).toBe("waiting");
    expect(waiting.visible).toBe(false);
    expect(event(waiting, { type: "stalled" })).toEqual(waiting);
    expect(isProductImageNearViewport(1_100, 1_300, 800)).toBe(false);
    expect(isProductImageNearViewport(1_001, 1_200, 800, 200)).toBe(false);
    expect(isProductImageNearViewport(750, 950, 800, 200)).toBe(true);
  });

  it("tracks visible loading, successful completion, and a visible stall", () => {
    const waiting = createProductImageState("item-a:image-a", 1);
    const loading = event(waiting, { type: "visible" });
    expect(loading.phase).toBe("loading");
    expect(loading.visible).toBe(true);
    expect(event(loading, { type: "loaded" }).phase).toBe("loaded");
    expect(event(loading, { type: "stalled" }).phase).toBe("retry-wait");
    expect(productImageStallTimeoutMs).toBeGreaterThan(8_000);
  });

  it("retries a source twice with bounded backoff, then advances to the local image", () => {
    let state = event(createProductImageState("item-a:manager+local", 2), { type: "visible" });
    state = event(state, { type: "failed" });
    expect(state.phase).toBe("retry-wait");
    expect(state.retries).toBe(1);
    expect(productImageRetryDelays[0]).toBe(500);

    state = event(state, { type: "retry" });
    expect(state.phase).toBe("loading");
    state = event(state, { type: "failed" });
    expect(state.phase).toBe("retry-wait");
    expect(state.retries).toBe(2);
    expect(productImageRetryDelays[1]).toBe(1_500);

    state = event(state, { type: "retry" });
    state = event(state, { type: "failed" });
    expect(state.sourceIndex).toBe(1);
    expect(state.phase).toBe("loading");
    expect(state.retries).toBe(0);
  });

  it("uses the decorative fallback after the local image also exhausts retries", () => {
    let state = event(createProductImageState("item-a:manager+local", 2), { type: "visible" });
    for (let sourceIndex = 0; sourceIndex < 2; sourceIndex += 1) {
      for (let retry = 0; retry < 2; retry += 1) {
        state = event(state, { type: "failed" });
        expect(state.phase).toBe("retry-wait");
        state = event(state, { type: "retry" });
      }
      state = event(state, { type: "failed" });
    }
    expect(state.phase).toBe("fallback");
    expect(state.sourceIndex).toBe(2);
  });

  it("resets loading, retry, and fallback state when the product or image changes", () => {
    let state = event(createProductImageState("item-a:image-a", 1), { type: "visible" });
    state = event(state, { type: "failed" });
    state = event(state, { type: "retry" });
    state = event(state, { type: "loaded" });

    const next = event(state, { type: "reset", identity: "item-b:image-b", sourceCount: 2 });
    expect(next).toEqual({
      identity: "item-b:image-b",
      sourceCount: 2,
      sourceIndex: 0,
      retries: 0,
      visible: false,
      phase: "waiting",
    });
  });
});
