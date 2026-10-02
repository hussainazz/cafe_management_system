// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beginRecoveryActivity, requestAutomaticRecovery, setRecoveryUser, readRecovery, finishRecoveryEpisode, useRecoveryState, writeRecovery } from "./automatic-recovery";
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Draft() { const [value, setValue] = useRecoveryState("draft", ""); return <input aria-label="draft" value={value} onChange={e => setValue(e.target.value)} />; }
describe("automatic recovery", () => {
  it("persists mounted draft edits across remount", () => {
    setRecoveryUser("draft-user"); render(<Draft />);
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "remember me" } });
    cleanup(); render(<Draft />);
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("remember me");
  });
  it("waits for an active print/request and reloads only once per episode", () => {
    vi.useFakeTimers(); setRecoveryUser("bounded-user"); writeRecovery("episode", false);
    const reload = vi.fn(); const finish = beginRecoveryActivity();
    requestAutomaticRecovery(reload); vi.advanceTimersByTime(500); expect(reload).not.toHaveBeenCalled();
    finish(); vi.advanceTimersByTime(300); expect(reload).toHaveBeenCalledTimes(1);
    requestAutomaticRecovery(reload); vi.advanceTimersByTime(100); expect(reload).toHaveBeenCalledTimes(1);
  });
  it("waits offline without consuming the reload guard", () => {
    vi.useFakeTimers(); setRecoveryUser("offline-user"); writeRecovery("episode", false);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const reload = vi.fn(); const cancel = requestAutomaticRecovery(reload);
    vi.advanceTimersByTime(1000); expect(reload).not.toHaveBeenCalled();
    online.mockReturnValue(true); vi.advanceTimersByTime(300); expect(reload).toHaveBeenCalledTimes(1);
    cancel(); online.mockRestore();
  });
});


it("ignores malformed snapshot shapes without preventing a safely persisted recovery", () => {
  vi.useFakeTimers(); setRecoveryUser("malformed-shape");
  sessionStorage.setItem("run-cafe:recovery:v1:malformed-shape:desk:bad:saved", JSON.stringify({ version: 1, value: [{ id: "missing-other-fields" }] }));
  expect(readRecovery("desk:bad:saved")).toBeUndefined();
  writeRecovery("episode", false);
  const reload = vi.fn(); requestAutomaticRecovery(reload); vi.advanceTimersByTime(100);
  expect(reload).toHaveBeenCalledTimes(1);
});
it("keeps work mounted when storage fails and permits a new episode after healthy reset", () => {
  vi.useFakeTimers(); setRecoveryUser("storage-failure");
  render(<Draft />);
  const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "retained" } });
  const reload = vi.fn(); requestAutomaticRecovery(reload); vi.advanceTimersByTime(100);
  expect(reload).not.toHaveBeenCalled();
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("retained");
  store.mockRestore(); setRecoveryUser("healthy-reset"); writeRecovery("episode", true);
  requestAutomaticRecovery(reload); vi.advanceTimersByTime(100); expect(reload).not.toHaveBeenCalled();
  finishRecoveryEpisode(); requestAutomaticRecovery(reload); vi.advanceTimersByTime(100); expect(reload).toHaveBeenCalledTimes(1);
});
