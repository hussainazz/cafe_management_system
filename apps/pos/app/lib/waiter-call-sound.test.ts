// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const call = (id: string) => ({ id, tableId: "table-1", version: 1 });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

let audio: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; muted: boolean; currentTime: number; preload: string };
let AudioMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), muted: false, currentTime: 0, preload: "" };
  AudioMock = vi.fn(function () { return audio; });
  vi.stubGlobal("Audio", AudioMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("waiter-call sound notifications", () => {
  it("keeps the initial snapshot silent and identifies successive calls on the same table", async () => {
    const sound = await import("./waiter-call-sound");
    expect(sound.newWaiterCallSoundKeys([call("first")], null)).toEqual([]);
    expect(sound.newWaiterCallSoundKeys([call("second")], new Set(["first"]))).toEqual(["second"]);
    const observe = sound.createWaiterCallSoundObserver();
    await sound.unlockWaiterCallSound();
    audio.play.mockClear();
    observe([call("first")]);
    observe([call("second")]); // No empty poll between resolved and newly created calls.
    await flush();
    observe([call("second")]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(AudioMock).toHaveBeenCalledTimes(1);
  });

  it("announces a new call during a full reload using the same observer as polling", async () => {
    const sound = await import("./waiter-call-sound");
    const observe = sound.createWaiterCallSoundObserver();
    await sound.unlockWaiterCallSound();
    audio.play.mockClear();
    observe([]);
    observe([call("new")]);
    await flush();
    observe([call("new")]);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("retains a call received before audio unlock and retries a failed unlock", async () => {
    const sound = await import("./waiter-call-sound");
    const observe = sound.createWaiterCallSoundObserver();
    observe([]);
    observe([call("new")]);
    expect(audio.play).not.toHaveBeenCalled();
    audio.play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    expect(await sound.unlockWaiterCallSound()).toBe(false);
    expect(audio.muted).toBe(false);
    expect(await sound.unlockWaiterCallSound()).toBe(true);
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(3); // failed unlock, unlock, audible call
    expect(audio.muted).toBe(false);
  });

  it("reports playback rejection and retries unchanged active calls on the next poll", async () => {
    const sound = await import("./waiter-call-sound");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observe = sound.createWaiterCallSoundObserver();
    await sound.unlockWaiterCallSound();
    audio.play.mockClear();
    audio.play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    observe([]);
    observe([call("new")]);
    await flush();
    expect(warn).toHaveBeenCalledWith("Waiter-call sound playback failed", "NotAllowedError");
    observe([call("new")]);
    await flush();
    observe([call("new")]);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("drops queued calls when they are resolved before unlock", async () => {
    const sound = await import("./waiter-call-sound");
    const observe = sound.createWaiterCallSoundObserver();
    observe([]);
    observe([call("new")]);
    observe([]);
    await sound.unlockWaiterCallSound();
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(1); // unlock only
  });

  it("shares concurrent unlock attempts without interrupting the pending notification", async () => {
    const sound = await import("./waiter-call-sound");
    const observe = sound.createWaiterCallSoundObserver();
    observe([]);
    observe([call("new")]);
    const first = sound.unlockWaiterCallSound();
    const second = sound.unlockWaiterCallSound();
    expect(first).toBe(second);
    await first;
    await flush();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});
