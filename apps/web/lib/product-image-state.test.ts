import { describe, expect, it } from "vitest";
import {
  createProductImageState,
  productImageRetryDelays,
  productImageStallTimeoutMs,
  reduceProductImageState,
} from "./product-image-state";

const event = reduceProductImageState;

describe("product image loading state", () => {
  it("starts every menu image immediately so it does not wait for viewport visibility", () => {
    const loading = createProductImageState("item-a:image-a", 2);

    expect(loading.phase).toBe("loading");
    expect(event(loading, { type: "stalled" }).phase).toBe("retry-wait");
  });

  it("tracks successful completion and retries a stalled transfer", () => {
    const loading = createProductImageState("item-a:image-a", 1);
    expect(event(loading, { type: "loaded" }).phase).toBe("loaded");
    expect(event(loading, { type: "stalled" }).phase).toBe("retry-wait");
    expect(productImageStallTimeoutMs).toBeGreaterThan(8_000);
  });

  it("ignores duplicate error events while a retry is already scheduled", () => {
    const loading = createProductImageState("item-a:image-a", 2);
    const retrying = event(loading, { type: "failed" });

    expect(event(retrying, { type: "failed" })).toEqual(retrying);
    expect(retrying.sourceIndex).toBe(0);
    expect(retrying.retries).toBe(1);
  });

  it("retries a source twice with bounded backoff, then advances to the local image", () => {
    let state = createProductImageState("item-a:manager+local", 2);
    state = event(state, { type: "failed" });
    expect(state.phase).toBe("retry-wait");
    expect(state.retries).toBe(1);
    expect(productImageRetryDelays[0]).toBe(500);

    state = event(state, { type: "retry" });
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
    let state = createProductImageState("item-a:manager+local", 2);
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
    let state = createProductImageState("item-a:image-a", 1);
    state = event(state, { type: "failed" });
    state = event(state, { type: "retry" });
    state = event(state, { type: "loaded" });

    const next = event(state, { type: "reset", identity: "item-b:image-b", sourceCount: 2 });
    expect(next).toEqual({
      identity: "item-b:image-b",
      sourceCount: 2,
      sourceIndex: 0,
      retries: 0,
      phase: "loading",
    });
  });
});
