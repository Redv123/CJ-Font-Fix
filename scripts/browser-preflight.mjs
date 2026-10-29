import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Check IPC permission without launching Chromium and generating a core dump. */
export default async function browserPreflight() {
  const directory = await mkdtemp(join(tmpdir(), "cj-browser-preflight-"));
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\cj-browser-preflight-${process.pid}`
    : join(directory, "ipc.sock");
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, resolve);
    });
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      throw new Error(
        `[browser-preflight] Local IPC is blocked (${error.code}); Chromium was not started. ` +
        "Run this browser command with sandbox_permissions=require_escalated in the agent tool, " +
        "or from a terminal that permits browser IPC. See docs/testing.md#agent-browser-permissions.",
        { cause: error }
      );
    }
    throw error;
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await browserPreflight();
  console.log("Browser IPC prerequisite: available");
}
