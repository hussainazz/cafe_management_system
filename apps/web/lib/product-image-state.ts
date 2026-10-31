export const productImageRetryDelays = [500, 1_500] as const;
export const productImageStallTimeoutMs = 12_000;

export type ProductImagePhase = "loading" | "retry-wait" | "loaded" | "fallback";

export type ProductImageState = {
  identity: string;
  sourceCount: number;
  sourceIndex: number;
  retries: number;
  phase: ProductImagePhase;
};

export type ProductImageEvent =
  | { type: "reset"; identity: string; sourceCount: number }
  | { type: "loaded" }
  | { type: "failed" }
  | { type: "stalled" }
  | { type: "retry" };

export function createProductImageState(identity: string, sourceCount: number): ProductImageState {
  return {
    identity,
    sourceCount,
    sourceIndex: 0,
    retries: 0,
    phase: sourceCount > 0 ? "loading" : "fallback",
  };
}

function advanceAfterFailure(state: ProductImageState): ProductImageState {
  const retriesAllowed = productImageRetryDelays.length;
  if (state.retries < retriesAllowed) {
    return { ...state, retries: state.retries + 1, phase: "retry-wait" };
  }

  const sourceIndex = state.sourceIndex + 1;
  return {
    ...state,
    sourceIndex,
    retries: 0,
    phase: sourceIndex < state.sourceCount ? "loading" : "fallback",
  };
}

export function reduceProductImageState(
  state: ProductImageState,
  event: ProductImageEvent,
): ProductImageState {
  if (event.type === "reset") return createProductImageState(event.identity, event.sourceCount);

  switch (event.type) {
    case "loaded":
      return state.phase === "fallback"
        ? state
        : { ...state, phase: "loaded" };
    case "failed":
      return state.phase !== "loading"
        ? state
        : advanceAfterFailure(state);
    case "stalled":
      return state.phase === "loading" ? advanceAfterFailure(state) : state;
    case "retry":
      return state.phase === "retry-wait"
        ? { ...state, phase: "loading" }
        : state;
  }
}
