export type MenuImageReadiness = {
  identity: string;
  expected: ReadonlySet<string>;
  settled: ReadonlySet<string>;
};

export function createMenuImageReadiness(identity: string, imageIds: readonly string[]): MenuImageReadiness {
  return { identity, expected: new Set(imageIds), settled: new Set() };
}

export function settleMenuImage(
  state: MenuImageReadiness,
  identity: string,
  imageIds: readonly string[],
  imageId: string,
): MenuImageReadiness {
  const current = state.identity === identity ? state : createMenuImageReadiness(identity, imageIds);
  if (!current.expected.has(imageId) || current.settled.has(imageId)) return current;
  return { ...current, settled: new Set([...current.settled, imageId]) };
}

export function isMenuImageReadinessComplete(state: MenuImageReadiness, identity: string) {
  return state.identity === identity && [...state.expected].every((imageId) => state.settled.has(imageId));
}
