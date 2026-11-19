import type { BackgroundTask } from "./types"

/**
 * From when the task's session holds output of the task's current run: a fork's copy of its parent and a resumed
 * child's earlier run both sit in its history and are not this run's answer. Undefined means the whole history.
 */
export function taskOutputSince(task: Pick<BackgroundTask, "ownMessagesSince" | "runOutputSince">): number | undefined {
  const { ownMessagesSince, runOutputSince } = task
  if (ownMessagesSince === undefined) return runOutputSince
  if (runOutputSince === undefined) return ownMessagesSince
  return Math.max(ownMessagesSince, runOutputSince)
}
