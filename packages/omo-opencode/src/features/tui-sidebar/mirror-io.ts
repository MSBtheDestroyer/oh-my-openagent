import { type fsyncSync as FsyncSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { STALE_MS } from "./constants"
import { canonicalProjectDir, mirrorFilePath } from "./mirror-path"
import { parseSnapshot } from "./snapshot-schema"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

export function writeMirror(
  projectDir: string,
  snapshot: TuiRuntimeSnapshot,
  deps: { fsyncSync?: typeof FsyncSync } = {},
): void {
  const filePath = mirrorFilePath(projectDir)
  const content = JSON.stringify(snapshot)

  mkdirSync(dirname(filePath), { recursive: true })
  // Rewritten every few seconds and rebuilt from live state, so a crash costs nothing worth an fsync.
  writeFileAtomically(filePath, content, { ...deps, mode: 0o600, durable: false })
}

export function readMirror(projectDir: string): TuiRuntimeSnapshot | null {
  return freshOrNull(readProjectSnapshot(mirrorFilePath(projectDir), canonicalProjectDir(projectDir)))
}

/**
 * Reader for a TUI polling one project's mirror: the file is parsed only when its stat changes,
 * while the staleness cutoff is still applied on every call, so results match `readMirror`.
 */
export function createMirrorReader(projectDir: string): () => TuiRuntimeSnapshot | null {
  const filePath = mirrorFilePath(projectDir)
  const projectCanonicalDir = canonicalProjectDir(projectDir)
  let cachedStamp: string | null = null
  let cachedSnapshot: TuiRuntimeSnapshot | null = null

  return () => {
    const stats = statSync(filePath, { throwIfNoEntry: false })
    if (stats === undefined) {
      cachedStamp = null
      cachedSnapshot = null
      return null
    }
    const stamp = `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
    if (stamp !== cachedStamp) {
      cachedSnapshot = readProjectSnapshot(filePath, projectCanonicalDir)
      cachedStamp = stamp
    }
    return freshOrNull(cachedSnapshot)
  }
}

function readProjectSnapshot(filePath: string, projectCanonicalDir: string): TuiRuntimeSnapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }

  const snapshot = parseSnapshot(raw)
  if (snapshot === null) {
    return null
  }
  if (canonicalProjectDir(snapshot.projectDir) !== projectCanonicalDir) {
    return null
  }
  return snapshot
}

function freshOrNull(snapshot: TuiRuntimeSnapshot | null): TuiRuntimeSnapshot | null {
  if (snapshot === null || Date.now() - snapshot.updatedAt > STALE_MS) {
    return null
  }
  return snapshot
}
