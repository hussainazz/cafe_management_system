import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuImageQueue, categoryImageDwellMs, downloadMenuImage, type ImageLoader, type ImageTask } from "./menu-image-queue";

const tasks: ImageTask[] = [
  { id: "a1", categoryId: "a", sources: ["a1"] },
  { id: "a2", categoryId: "a", sources: ["a2"] },
  { id: "b1", categoryId: "b", sources: ["b1"] },
  { id: "c1", categoryId: "c", sources: ["c1"] },
];
function setup(concurrency = 2) {
  vi.useFakeTimers();
  const requests: { source: string; signal: AbortSignal; finish: (url: string | null) => void }[] = [];
  const load: ImageLoader = (sources, signal) => new Promise(resolve => {
    requests.push({ source: sources[0]!, signal, finish: resolve });
  });
  const publish = vi.fn();
  const release = vi.fn();
  const queue = new MenuImageQueue(tasks, load, publish, release, concurrency);
  queue.start();
  return { queue, requests, publish, release };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("menu image scheduling", () => {
  it("starts the initial category without waiting for authentication or a category click", () => {
    const { queue, requests } = setup();
    expect(requests.map(r => r.source)).toEqual(["a1", "a2"]);
    queue.stop();
  });
  it("does not start other categories until every active image finishes", async () => {
    const { queue, requests } = setup();
    requests[0]!.finish("blob:a1"); await flush();
    expect(requests).toHaveLength(2);
    requests[1]!.finish("blob:a2"); await flush();
    expect(requests.slice(2).map(r => r.source)).toEqual(["b1", "c1"]);
    queue.stop();
  });
  it("aborts unfinished previous-category requests and starts the new category after dwell", async () => {
    const { queue, requests } = setup();
    queue.select("b");
    await vi.advanceTimersByTimeAsync(categoryImageDwellMs - 1);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.signal.aborted).toBe(true);
    expect(requests.at(-1)!.source).toBe("b1");
    requests[2]!.finish("blob:b1"); await flush();
    expect(requests.slice(3).map(r => r.source)).toEqual(["a1", "a2"]);
    queue.stop();
  });
  it("debounces rapid navigation and only promotes the category where the user stays", async () => {
    const { queue, requests } = setup();
    queue.select("b");
    await vi.advanceTimersByTimeAsync(100);
    queue.select("c");
    await vi.advanceTimersByTimeAsync(100);
    queue.select("b");
    await vi.advanceTimersByTimeAsync(categoryImageDwellMs - 1);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.slice(2).map(r => r.source)).toEqual(["b1"]);
    queue.stop();
  });
  it("retains completed images and discards late results from aborted requests", async () => {
    const { queue, requests, publish, release } = setup();
    requests[0]!.finish("blob:a1"); await flush();
    queue.select("b"); await vi.advanceTimersByTimeAsync(categoryImageDwellMs);
    requests[1]!.finish("blob:stale"); await flush();
    expect(release).toHaveBeenCalledWith("blob:stale");
    expect(publish.mock.lastCall![0].has("a1")).toBe(true);
    expect(publish.mock.lastCall![0].has("a2")).toBe(false);
    queue.select("a"); await vi.advanceTimersByTimeAsync(categoryImageDwellMs);
    expect(requests.filter(r => r.source === "a1")).toHaveLength(1);
    queue.stop();
  });
  it("does not restart background requests when selecting a fully downloaded category", async () => {
    const { queue, requests } = setup();
    requests[0]!.finish("blob:a1"); requests[1]!.finish("blob:a2"); await flush();
    requests[2]!.finish("blob:b1"); await flush();
    queue.select("b"); await vi.advanceTimersByTimeAsync(categoryImageDwellMs);
    expect(requests[3]!.signal.aborted).toBe(false);
    expect(requests).toHaveLength(4);
    queue.stop();
  });
  it("a failed image cannot block remaining categories forever", async () => {
    const { queue, requests } = setup();
    requests[0]!.finish(null); requests[1]!.finish(null); await flush();
    expect(requests.slice(2).map(r => r.source)).toEqual(["b1", "c1"]);
    queue.stop();
  });
  it("stops timers and requests and releases downloaded blobs on unmount", async () => {
    const { queue, requests, release } = setup();
    requests[0]!.finish("blob:a1"); await flush();
    queue.select("b"); queue.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledWith("blob:a1");
  });
});

describe("image transport", () => {
  it("retries a failed upload before downloading the bundled fallback", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["image"]) });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fallback");
    expect(await downloadMenuImage(["upload", "fallback"], new AbortController().signal)).toBe("blob:fallback");
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["upload", "upload", "upload", "fallback"]);
  });
  it("does not retry or fetch fallback after navigation aborts the request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(async () => { controller.abort(); throw new Error("aborted"); });
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadMenuImage(["upload", "fallback"], controller.signal)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
