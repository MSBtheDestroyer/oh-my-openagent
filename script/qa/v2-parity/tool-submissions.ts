import { readFileSync, watch } from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"

export class ToolSubmissionTimeoutError extends Error {
  constructor(readonly file: string) {
    super(`No tool registration record was written to ${file} within 5 seconds`)
    this.name = "ToolSubmissionTimeoutError"
  }
}

export async function readToolSubmissions(file: string, signal: AbortSignal): Promise<readonly string[]> {
  signal.throwIfAborted()
  const lifetime = new AbortController()
  const watcher = watch(dirname(file))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<readonly string[]>((resolve, reject) => {
      const check = () => {
        try {
          const log = readFileSync(file, "utf8")
          const records = [...log.matchAll(/tool definitions submitted (\{[^\n]+\})/g)]
          if (records.length > 0) resolve([...new Set(records.flatMap((match) =>
            z.object({ names: z.array(z.string()) }).parse(JSON.parse(match[1] ?? "")).names))])
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return
          reject(error)
        }
      }
      const abort = () => reject(signal.reason)
      watcher.on("change", check)
      watcher.once("error", reject)
      signal.addEventListener("abort", abort, { once: true, signal: lifetime.signal })
      timer = setTimeout(() => reject(new ToolSubmissionTimeoutError(file)), 5000)
      if (signal.aborted) abort()
      else check()
    })
  } finally {
    lifetime.abort()
    watcher.close()
    if (timer !== undefined) clearTimeout(timer)
  }
}
