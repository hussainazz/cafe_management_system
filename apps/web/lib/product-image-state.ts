export const productImageRetryDelays = [500, 1_500] as const;
export const productImageStallTimeoutMs = 12_000;

export type ProductImagePhase = "waiting" | "loading" | "retry-wait" | "loaded" | "fallback";

export type ProductImageState = {
  identity: string;
  sourceCount: number;
  sourceIndex: number;
  retries: number;
  visible: boolean;
  phase: ProductImagePhase;
};

export type ProductImageEvent =
  | { type: "reset"; identity: string; sourceCount: number }
  | { type: "visible" }
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
    visible: false,
    phase: sourceCount > 0 ? "waiting" : "fallback",
  };
}

function advanceAfterFailure(state: ProductImageState): ProductImageState {
  const retriesAllowed = productImageRetryDelays.length;
  if (state.retries < retriesAllowed) {
    return { ...state, retries: state.retries + 1, visible: true, phase: "retry-wait" };
  }

  const sourceIndex = state.sourceIndex + 1;
  return {
    ...state,
    sourceIndex,
    retries: 0,
    phase: sourceIndex < state.sourceCount ? (state.visible ? "loading" : "waiting") : "fallback",
  };
}

export function reduceProductImageState(
  state: ProductImageState,
  event: ProductImageEvent,
): ProductImageState {
  if (event.type === "reset") return createProductImageState(event.identity, event.sourceCount);

  switch (event.type) {
    case "visible":
      return state.phase === "waiting"
        ? { ...state, visible: true, phase: "loading" }
        : { ...state, visible: true };
    case "loaded":
      return state.phase === "fallback"
        ? state
        : { ...state, visible: true, phase: "loaded" };
    case "failed":
      return state.phase === "loaded" || state.phase === "fallback"
        ? state
        : advanceAfterFailure({ ...state, visible: true });
    case "stalled":
      return state.visible && state.phase === "loading" ? advanceAfterFailure(state) : state;
    case "retry":
      return state.phase === "retry-wait"
        ? { ...state, phase: state.visible ? "loading" : "waiting" }
        : state;
  }
}

export function isProductImageNearViewport(
  top: number,
  bottom: number,
  viewportHeight: number,
  margin = 200,
) {
  return top <= viewportHeight + margin && bottom >= -margin;
}
