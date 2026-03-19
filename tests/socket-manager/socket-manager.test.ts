import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToPendingAckQueue,
  clearPendingAckQueue,
  createSocketManager,
  removeFromPendingAckQueue,
} from "../../src/socket-manager";

class FakeSocket extends EventEmitter {
  readyState = 1;
  ping = vi.fn();
}

describe("socket-manager", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function createFixture(overrides?: { stopped?: () => boolean }) {
    const socket = new FakeSocket();
    const client = {
      socket,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      socketCallBackResponse: vi.fn(),
    };
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const pendingAckQueue = new Set<string>();
    const manager = createSocketManager(client as any, {
      accountId: "acc-1",
      log,
      stopped: overrides?.stopped ?? (() => false),
      pendingAckQueue,
      client,
      debug: true,
    });
    return { socket, client, log, pendingAckQueue, manager };
  }

  it("flushes pending ack queue when socket opens", () => {
    const { socket, client, pendingAckQueue } = createFixture();
    pendingAckQueue.add("m1");
    pendingAckQueue.add("m2");

    socket.emit("open");

    expect(client.socketCallBackResponse).toHaveBeenCalledTimes(2);
    expect(pendingAckQueue.size).toBe(0);
  });

  it("reconnects when disconnect system message is received", async () => {
    const { socket, client } = createFixture();

    socket.emit("message", JSON.stringify({ type: "SYSTEM", headers: { topic: "disconnect" } }));
    await Promise.resolve();
    await Promise.resolve();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects when socket close is emitted", async () => {
    vi.useFakeTimers();
    const { socket, client } = createFixture();

    socket.emit("close", 1006, "abnormal");
    await vi.advanceTimersByTimeAsync(0);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("keepAlive sends ping while socket is healthy", async () => {
    vi.useFakeTimers();
    const { manager, socket } = createFixture();
    const cleanup = manager.startKeepAlive();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.ping).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("stop clears listeners", () => {
    const { manager, socket } = createFixture();
    const removeSpy = vi.spyOn(socket, "removeAllListeners");
    manager.stop();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("pending queue helpers add/remove/clear", () => {
    const q = new Set<string>();
    addToPendingAckQueue(q, "a");
    addToPendingAckQueue(q, "b");
    removeFromPendingAckQueue(q, "a");
    expect([...q]).toEqual(["b"]);
    clearPendingAckQueue(q);
    expect(q.size).toBe(0);
  });
});
