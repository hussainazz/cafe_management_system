export const categoryImageDwellMs = 200;
export type ImageTask = { id: string; categoryId: string; sources: string[] };
export type ImageDownload = { url: string | null };
export type ImageLoader = (sources: string[], signal: AbortSignal) => Promise<string | null>;

// Owns the requests so a category switch can release network slots immediately.
export class MenuImageQueue {
  private complete = new Map<string, ImageDownload>();
  private running = new Map<string, AbortController>();
  private category: string | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private tasks: ImageTask[], private load: ImageLoader,
    private publish: (images: ReadonlyMap<string, ImageDownload>) => void,
    private release: (url: string) => void = () => {}, private concurrency = 3) {
    this.category = tasks[0]?.categoryId ?? null;
  }
  start() { this.pump(); }
  select(category: string | null) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.stopped || category === this.category) return;
      this.category = category;
      const needsPriority = this.tasks.some(task => task.categoryId === category && !this.complete.has(task.id));
      for (const [id, controller] of this.running) {
        if (needsPriority && this.tasks.find(task => task.id === id)?.categoryId !== category) {
          this.running.delete(id);
          controller.abort();
        }
      }
      this.pump();
    }, categoryImageDwellMs);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    for (const image of this.complete.values()) if (image.url) this.release(image.url);
  }
  private pump() {
    if (this.stopped) return;
    const pending = this.tasks.filter(task => !this.complete.has(task.id));
    const active = pending.filter(task => task.categoryId === this.category);
    const eligible = active.length ? active : pending;
    for (const task of eligible) {
      if (this.running.size >= this.concurrency) break;
      if (this.running.has(task.id)) continue;
      const controller = new AbortController();
      this.running.set(task.id, controller);
      void this.load(task.sources, controller.signal).catch(() => null).then(url => {
        if (this.stopped || controller.signal.aborted) {
          if (url) this.release(url);
          return;
        }
        this.running.delete(task.id);
        this.complete.set(task.id, { url });
        this.publish(new Map(this.complete));
        this.pump();
      });
    }
  }
}

export const downloadMenuImage: ImageLoader = async (sources, signal) => {
  for (const source of sources) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) return null;
      try {
        const response = await fetch(source, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
          cache: "force-cache",
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (signal.aborted) return null;
        return URL.createObjectURL(blob);
      } catch {
        if (signal.aborted) return null;
      }
    }
  }
  return null;
};
