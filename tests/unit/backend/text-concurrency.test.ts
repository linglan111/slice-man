import { describe, expect, it } from "vitest";
import { acquireTextSlot } from "../../../src/main/services/providers/lib/text-concurrency";
import { profileSchema, type Profile } from "../../../src/shared/contracts";

function profile(id: string, limit?: number): Profile {
  return profileSchema.parse({ id, name: id, protocol: "openai", baseUrl: "https://fixture.invalid", model: "fixture", hasKey: true, textConcurrency: limit });
}

describe("shared API-service text slots", () => {
  it("defaults legacy profiles and validates the persisted service limit", () => {
    expect(profile("legacy").textConcurrency).toBe(2);
    for (const limit of [0, 17, 1.5]) expect(() => profile("invalid", limit)).toThrow();
    expect(profile("max", 16).textConcurrency).toBe(16);
  });
  it("queues all text operations for the same service while other services remain independent", async () => {
    const release = await acquireTextSlot(profile("same", 1));
    let started = false;
    const waiting = acquireTextSlot(profile("same", 1)).then((next) => { started = true; return next; });
    const other = await acquireTextSlot(profile("other", 1));
    expect(started).toBe(false);
    other();
    release();
    const next = await waiting;
    expect(started).toBe(true);
    next(); next();
    const reusable = await acquireTextSlot(profile("same", 1));
    reusable();
  });
  it("removes cancelled queue entries without consuming a later slot", async () => {
    const release = await acquireTextSlot(profile("cancel", 1));
    const controller = new AbortController();
    const pending = acquireTextSlot(profile("cancel", 1), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    controller.abort();
    await rejected;
    release();
    const next = await acquireTextSlot(profile("cancel", 1));
    next();
  });
  it("admits up to the service cap and preserves FIFO admission", async () => {
    const p = profile("fifo", 2);
    const first = await acquireTextSlot(p);
    const second = await acquireTextSlot(p);
    const order: number[] = [];
    const third = acquireTextSlot(p).then((release) => { order.push(3); return release; });
    const fourth = acquireTextSlot(p).then((release) => { order.push(4); return release; });
    expect(order).toEqual([]);
    second();
    const releaseThird = await third;
    expect(order).toEqual([3]);
    first();
    const releaseFourth = await fourth;
    expect(order).toEqual([3, 4]);
    releaseThird(); releaseFourth();
  });
});
