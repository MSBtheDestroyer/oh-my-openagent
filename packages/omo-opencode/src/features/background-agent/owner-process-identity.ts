import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { OwnerProcess } from "./task-recovery-store"

export type ProcessLiveness = { readonly start: string } | "gone" | "unknown"

/**
 * Tells whether a pid still names the process that recorded it. The start
 * marker separates a recorded owner from an unrelated process the OS later
 * gave the same pid: on Linux the boot id plus /proc/<pid>/stat starttime
 * (field 22, clock ticks since boot), on macOS the absolute `ps -o lstart`.
 * A zombie is gone, since its sockets are already closed. "unknown" means the
 * platform or the read gave no answer.
 */
export function readProcessStart(pid: number): Promise<ProcessLiveness> {
  if (process.platform === "linux") return readLinuxProcessStart(pid)
  if (process.platform === "darwin") return readDarwinProcessStart(pid)
  return Promise.resolve("unknown")
}

let current: Promise<OwnerProcess | undefined> | undefined

export function currentOwnerProcess(): Promise<OwnerProcess | undefined> {
  current ??= readProcessStart(process.pid).then((state) => typeof state === "object" ? { pid: process.pid, start: state.start } : undefined)
  return current
}

let bootId: Promise<string | undefined> | undefined

function readBootId(): Promise<string | undefined> {
  bootId ??= readFile("/proc/sys/kernel/random/boot_id", "utf8").then((id) => id.trim() || undefined, (error: unknown) => {
    if (!(error instanceof Error)) throw error
    return undefined
  })
  return bootId
}

async function readLinuxProcessStart(pid: number): Promise<ProcessLiveness> {
  const boot = await readBootId()
  if (boot === undefined) return "unknown"
  let stat: string
  try { stat = await readFile(`/proc/${pid}/stat`, "utf8") } catch (error) {
    if (!(error instanceof Error)) throw error
    return "code" in error && (error.code === "ENOENT" || error.code === "ESRCH") ? "gone" : "unknown"
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  const state = fields[0]
  const startTicks = fields[19]
  if (state === "Z" || state === "X") return "gone"
  return startTicks && /^\d+$/.test(startTicks) ? { start: `${boot}:${startTicks}` } : "unknown"
}

function readDarwinProcessStart(pid: number): Promise<ProcessLiveness> {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "stat=", "-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C" }, timeout: 5000 }, (error, stdout) => {
      const [state, ...start] = stdout.trim().split(/\s+/)
      if (!state) resolve(error?.code === 1 ? "gone" : "unknown")
      else if (state.startsWith("Z")) resolve("gone")
      else resolve(start.length > 0 ? { start: start.join(" ") } : "unknown")
    })
  })
}
