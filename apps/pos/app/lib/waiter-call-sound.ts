export type WaiterCallSoundRef = { id: string };

const soundPath = "/pos/sound/service_bell.mp3";
let player: HTMLAudioElement | null = null;
let unlocked = false;
let unlocking: Promise<boolean> | null = null;
let playing = false;
const pending = new Set<string>();

function getPlayer() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!player) {
    player = new Audio(soundPath);
    player.preload = "auto";
  }
  return player;
}

export function waiterCallSoundKey(call: WaiterCallSoundRef) {
  return call.id;
}

export function newWaiterCallSoundKeys(current: readonly WaiterCallSoundRef[], previous: ReadonlySet<string> | null) {
  if (!previous) return [];
  return current.map(waiterCallSoundKey).filter((key) => !previous.has(key));
}

// Both full loads and operational polls must pass through the same baseline.
export function createWaiterCallSoundObserver() {
  let previous: Set<string> | null = null;
  return (calls: readonly WaiterCallSoundRef[]) => {
    const incoming = newWaiterCallSoundKeys(calls, previous);
    const active = new Set(calls.map(waiterCallSoundKey));
    previous = active;
    for (const key of pending) if (!active.has(key)) pending.delete(key);
    for (const key of incoming) pending.add(key);
    void playWaiterCallSound();
  };
}

export function unlockWaiterCallSound() {
  if (unlocked) {
    void playWaiterCallSound();
    return Promise.resolve(true);
  }
  if (unlocking) return unlocking;
  const audio = getPlayer();
  if (!audio) return Promise.resolve(false);
  unlocking = (async () => {
    audio.muted = true;
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      unlocked = true;
      return true;
    } catch {
      return false;
    } finally {
      audio.muted = false;
    }
  })().then((success) => {
    unlocking = null;
    if (success) void playWaiterCallSound();
    return success;
  });
  return unlocking;
}

export async function playWaiterCallSound() {
  const audio = getPlayer();
  if (!audio || !unlocked || playing || pending.size === 0) return false;
  const attempted = [...pending];
  playing = true;
  try {
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play();
    for (const key of attempted) pending.delete(key);
    return true;
  } catch (error) {
    // Keep active calls pending for the next poll or genuine user gesture.
    console.warn("Waiter-call sound playback failed", error instanceof Error || error instanceof DOMException ? error.name : "UnknownError");
    return false;
  } finally {
    playing = false;
  }
}
