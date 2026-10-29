import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import net from "node:net";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import browserPreflight from "../scripts/browser-preflight.mjs";

afterEach(() => vi.restoreAllMocks());

function socketResult(error) {
  const server = new EventEmitter();
  server.listening = false;
  server.listen = vi.fn((_endpoint, ready) => {
    queueMicrotask(() => {
      if (error) server.emit("error", error);
      else { server.listening = true; ready(); }
    });
  });
  server.close = vi.fn((closed) => { server.listening = false; closed(); });
  vi.spyOn(net, "createServer").mockReturnValue(server);
  return server;
}

it.each(["EPERM", "EACCES"])("stops before browser startup with actionable guidance for %s", async (code) => {
  const error = Object.assign(new Error("Socket denied"), { code });
  const server = socketResult(error);
  await expect(browserPreflight()).rejects.toMatchObject({
    message: expect.stringContaining("sandbox_permissions=require_escalated"),
    cause: error
  });
  expect(server.close).not.toHaveBeenCalled();
  if (process.platform !== "win32") {
    await expect(access(dirname(server.listen.mock.calls[0][0]))).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("preserves unexpected socket errors instead of treating them as permission failures", async () => {
  const error = Object.assign(new Error("Address in use"), { code: "EADDRINUSE" });
  socketResult(error);
  await expect(browserPreflight()).rejects.toBe(error);
});

it("closes the permitted probe and removes its temporary directory", async () => {
  const server = socketResult();
  await browserPreflight();
  expect(server.close).toHaveBeenCalledOnce();
  if (process.platform !== "win32") {
    await expect(access(dirname(server.listen.mock.calls[0][0]))).rejects.toMatchObject({ code: "ENOENT" });
  }
});
