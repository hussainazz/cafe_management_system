export type WaiterCallSoundRef = { tableId: string; version: number };

const soundPath = "/pos/sound/service_bell.mp3";
let player: HTMLAudioElement | null = null;
let unlocked = false;

function getPlayer() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!player) {
    player = new Audio(soundPath);
    player.preload = "auto";
  }
  return player;
}

export function waiterCallSoundKey(call: WaiterCallSoundRef) {
  return `${call.tableId}:${call.version}`;
}

export function newWaiterCallSoundKeys(current: readonly WaiterCallSoundRef[], previous: ReadonlySet<string> | null) {
  if (!previous) return [];
  return current.map(waiterCallSoundKey).filter((key) => !previous.has(key));
}

export function unlockWaiterCallSound() {
  if (unlocked) return Promise.resolve(true);
  const audio = getPlayer();
  if (!audio) return Promise.resolve(false);
  audio.muted = true;
  const result = audio.play();
  if (!result) {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    unlocked = true;
    return Promise.resolve(true);
  }
  return result.then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    unlocked = true;
    return true;
  }).catch(() => false);
}

export function playWaiterCallSound() {
  const audio = getPlayer();
  if (!audio || !unlocked) return;
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}
