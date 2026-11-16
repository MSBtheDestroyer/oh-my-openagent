import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLogger } from "@oh-my-opencode/utils"
import { ZodError } from "zod"
import { readToolSubmissions, ToolSubmissionTimeoutError } from "./tool-submissions"

test("waits for a queued tool registration batch from the real buffered logger", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-submissions-"))
  const file = join(root, "plugin.log")
  writeFileSync(file, "Plugin initialization completed\n")
  const logger = createLogger({ logFileName: "plugin.log", resolveLogFilePath: () => file })
  logger.log("[plugin-v2] tool definitions submitted", { names: ["skill", "skill_mcp"] })
  try {
    // when
    const pending = readToolSubmissions(file, new AbortController().signal)
    logger._flushForTesting()

    // then
    expect(await pending).toEqual(["skill", "skill_mcp"])
  } finally {
    logger._flushForTesting()
    rmSync(root, { recursive: true, force: true })
  }
})

test("reads existing registration records and retains distinct submitted tools", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-submissions-"))
  const file = join(root, "plugin.log")
  const logger = createLogger({ logFileName: "plugin.log", resolveLogFilePath: () => file })
  logger.log("[plugin-v2] tool definitions submitted", { names: ["skill"] })
  logger.log("[plugin-v2] tool definitions submitted", { names: ["skill", "skill_mcp"] })
  logger._flushForTesting()
  try {
    // when / then
    expect(await readToolSubmissions(file, new AbortController().signal)).toEqual(["skill", "skill_mcp"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test.each([true, false])("retains caller cancellation before the read starts=%s", async (abortBefore) => {
  const root = mkdtempSync(join(tmpdir(), "omo-submissions-"))
  const file = join(root, "plugin.log")
  writeFileSync(file, "Plugin initialization completed\n")
  const controller = new AbortController()
  const reason = new Error("Owned witness read cancelled")
  try {
    if (abortBefore) controller.abort(reason)
    const pending = readToolSubmissions(file, controller.signal)
    if (!abortBefore) controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects malformed registration fields instead of treating them as absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-submissions-"))
  const file = join(root, "plugin.log")
  const logger = createLogger({ logFileName: "plugin.log", resolveLogFilePath: () => file })
  logger.log("[plugin-v2] tool definitions submitted", { names: [123] })
  logger._flushForTesting()
  try {
    await expect(readToolSubmissions(file, new AbortController().signal)).rejects.toBeInstanceOf(ZodError)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("fails at the bounded deadline when no registration record is written", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-submissions-"))
  const file = join(root, "plugin.log")
  writeFileSync(file, "Plugin initialization completed\n")
  try {
    await expect(readToolSubmissions(file, new AbortController().signal)).rejects.toBeInstanceOf(
      ToolSubmissionTimeoutError,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 10000)
