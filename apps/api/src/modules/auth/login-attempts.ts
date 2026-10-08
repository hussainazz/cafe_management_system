const maxFailures = 5;
const windowMilliseconds = 15 * 60 * 1_000;
const maxEntries = 10_000;

type AttemptWindow = { startedAt: number; failures: number };

const attempts = new Map<string, AttemptWindow>();

function normalizedUsername(username: string) {
  return username.trim().toLocaleLowerCase("en-US");
}

function activeWindow(username: string, now: number) {
  const key = normalizedUsername(username);
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt >= windowMilliseconds) {
    attempts.delete(key);
    return { key, entry: undefined };
  }
  return { key, entry };
}

export function loginRetryAfterSeconds(username: string, now = Date.now()) {
  const { entry } = activeWindow(username, now);
  if (!entry || entry.failures < maxFailures) return 0;
  return Math.max(1, Math.ceil((entry.startedAt + windowMilliseconds - now) / 1_000));
}

export function recordLoginFailure(username: string, now = Date.now()) {
  const { key, entry } = activeWindow(username, now);
  if (entry) {
    entry.failures += 1;
  } else {
    attempts.set(key, { startedAt: now, failures: 1 });
  }

  for (const [candidate, candidateWindow] of attempts) {
    if (now - candidateWindow.startedAt >= windowMilliseconds) attempts.delete(candidate);
  }
  while (attempts.size > maxEntries) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function clearLoginFailures(username: string) {
  attempts.delete(normalizedUsername(username));
}
