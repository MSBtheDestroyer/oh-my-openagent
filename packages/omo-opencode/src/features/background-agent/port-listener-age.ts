import { readdir, readFile, readlink } from "node:fs/promises"

const LISTEN_STATE = "0A"
const USER_HZ = 100
const CLOCK_MARGIN_MS = 5000

/**
 * Proves, on Linux, that every process holding a listening TCP socket on
 * `port` started after `sinceMs`. An owner record is written only after its
 * owner's responder listens, so a listener whose process started after the
 * record was written cannot be that responder. Anything unproven returns
 * false: no listener, another platform, a socket no readable process holds,
 * or a holder that started before `sinceMs` plus a margin for clock error
 * (start times derive from btime and USER_HZ ticks).
 */
export async function portListenersStartedAfter(port: number, sinceMs: number): Promise<boolean> {
  if (process.platform !== "linux") return false
  const inodes = await listeningSocketInodes(port)
  if (inodes.size === 0) return false
  const holders = await socketHolders(inodes)
  if (holders.size < inodes.size) return false
  const bootMs = await readBootTimeMs()
  if (bootMs === undefined) return false
  for (const pids of holders.values()) {
    for (const pid of pids) {
      const startMs = await readStartMs(pid, bootMs)
      if (startMs === undefined || startMs <= sinceMs + CLOCK_MARGIN_MS) return false
    }
  }
  return true
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return undefined
  }
}

async function listeningSocketInodes(port: number): Promise<Set<string>> {
  const inodes = new Set<string>()
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of ((await readOptional(table)) ?? "").split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/)
      const local = fields[1]
      const inode = fields[9]
      if (fields[3] !== LISTEN_STATE || !local || !inode || inode === "0") continue
      if (Number.parseInt(local.slice(local.lastIndexOf(":") + 1), 16) === port) inodes.add(inode)
    }
  }
  return inodes
}

async function socketHolders(inodes: Set<string>): Promise<Map<string, Set<number>>> {
  const wanted = new Map([...inodes].map((inode) => [`socket:[${inode}]`, inode]))
  const holders = new Map<string, Set<number>>()
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue
    let fds: string[]
    try {
      fds = await readdir(`/proc/${entry}/fd`)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      continue
    }
    for (const fd of fds) {
      let target: string
      try {
        target = await readlink(`/proc/${entry}/fd/${fd}`)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        continue
      }
      const inode = wanted.get(target)
      if (inode === undefined) continue
      const pids = holders.get(inode) ?? new Set<number>()
      pids.add(Number(entry))
      holders.set(inode, pids)
    }
  }
  return holders
}

async function readBootTimeMs(): Promise<number | undefined> {
  const match = /^btime (\d+)$/m.exec((await readOptional("/proc/stat")) ?? "")
  return match?.[1] === undefined ? undefined : Number(match[1]) * 1000
}

async function readStartMs(pid: number, bootMs: number): Promise<number | undefined> {
  const stat = await readOptional(`/proc/${pid}/stat`)
  const ticks = stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[19]
  return ticks && /^\d+$/.test(ticks) ? bootMs + Number(ticks) * (1000 / USER_HZ) : undefined
}
