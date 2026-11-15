import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { currentOwnerProcess } from "./owner-process-identity"
import { OwnerProcessSchema, TaskOwnerSchema } from "./task-recovery-store"
import { probeTaskOwner, TaskWorkerOwnership } from "./task-worker-ownership"

async function listenCountingConnections(port: number) {
  let connections = 0
  const server = createServer((_request, response) => response.writeHead(404).end())
  server.on("connection", () => {
    connections += 1
  })
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(port, "127.0.0.1")
  await listening
  return {
    connections: () => connections,
    close: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}

test("an owner whose process exited is dead without contacting the listener that reused its port", async () => {
  // given an owner record written by another process that has since exited
  const script = fileURLToPath(new URL("./task-worker-ownership.test-process.ts", import.meta.url))
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "inherit"] })
  const exited = once(child, "exit", { signal: AbortSignal.timeout(10000) })
  const [line] = await once(createInterface({ input: child.stdout }), "line", { signal: AbortSignal.timeout(10000) })
  const reported = JSON.parse(String(line))
  const owner = TaskOwnerSchema.parse(reported.owner)
  const ownerProcess = OwnerProcessSchema.parse(reported.ownerProcess)
  child.kill("SIGKILL")
  await exited
  // and an unrelated listener now holds the owner's port
  const stranger = await listenCountingConnections(owner.port)
  try {
    // when recovery probes that owner
    const state = await probeTaskOwner({ owner, ownerProcess, sessionId: "child", generation: crypto.randomUUID() })
    // then
    expect(state).toBe("dead")
    expect(stranger.connections()).toBe(0)
  } finally {
    stranger.close()
  }
})

test("an owner pid now held by a different process is dead without a request", async () => {
  // given an owner whose recorded pid started at another time than the live process holding it
  const worker = new TaskWorkerOwnership(async () => "owned")
  const owner = await worker.open()
  worker.close()
  const stranger = await listenCountingConnections(owner.port)
  try {
    // when
    const state = await probeTaskOwner({
      owner,
      ownerProcess: { pid: process.pid, start: "an-earlier-process" },
      sessionId: "child",
      generation: crypto.randomUUID(),
    })
    // then
    expect(state).toBe("dead")
    expect(stranger.connections()).toBe(0)
  } finally {
    stranger.close()
  }
})

test("worker responder disappears on actual Bun worker termination while enclosing PID survives", async () => {
  const worker = new Worker(new URL("./task-worker-ownership.test-worker.ts", import.meta.url))
  const ready = once(worker, "message", { signal: AbortSignal.timeout(5000) })
  try {
    const [message] = await ready
    const owner = TaskOwnerSchema.parse(message)
    const record = { owner, sessionId: "worker-child", generation: crypto.randomUUID() }
    expect(await probeTaskOwner(record)).toBe("owned")
    const exited = once(worker, "exit", { signal: AbortSignal.timeout(5000) })
    await worker.terminate()
    await exited
    process.kill(process.pid, 0)
    expect(await probeTaskOwner(record)).toBe("dead")
  } finally {
    await worker.terminate()
  }
})

test("reachable live owners remain owned even when the child is idle", async () => {
  const worker = new TaskWorkerOwnership(async () => "owned")
  try {
    const owner = await worker.open()
    const ownerProcess = await currentOwnerProcess()
    expect(
      await probeTaskOwner({ owner, ownerProcess, sessionId: "idle-child", generation: crypto.randomUUID() }),
    ).toBe("owned")
    expect(
      await probeTaskOwner({
        owner: { ...owner, id: crypto.randomUUID() },
        sessionId: "idle-child",
        generation: crypto.randomUUID(),
      }),
    ).toBe("unknown")
  } finally {
    worker.close()
  }
})

test("a reused endpoint with malformed reply is unknown rather than proof of death", async () => {
  const worker = new TaskWorkerOwnership(async () => "unknown")
  const owner = await worker.open()
  worker.close()
  const server = createServer((_request, response) => response.end("invalid"))
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(owner.port, "127.0.0.1")
  await listening
  try {
    expect(await probeTaskOwner({ owner, sessionId: "child", generation: crypto.randomUUID() })).toBe("unknown")
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test("an owner that does not answer is unknown rather than proof of death", async () => {
  const worker = new TaskWorkerOwnership(async () => "unknown")
  const owner = await worker.open()
  worker.close()
  const server = createServer(() => undefined)
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(owner.port, "127.0.0.1")
  await listening
  try {
    expect(await probeTaskOwner({ owner, sessionId: "child", generation: crypto.randomUUID() })).toBe("unknown")
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
