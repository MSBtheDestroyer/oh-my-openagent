import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureQaRepo } from "./qa-repo.test-support"

const git = (cwd: string, ...argv: string[]): string =>
  execFileSync("git", argv, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim()

describe("ensureQaRepo", () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  test("creates its own repository inside a parent checkout and leaves the parent's config untouched", async () => {
    // given
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "omo-qa-parent-")))
    directories.push(parent)
    git(parent, "init", "-q", "-b", "main")
    const parentConfig = readFileSync(join(parent, ".git", "config"))
    const repoDir = join(parent, "nested", "repo")
    mkdirSync(repoDir, { recursive: true })

    // when
    await ensureQaRepo(repoDir)
    await ensureQaRepo(repoDir)

    // then
    expect(readFileSync(join(parent, ".git", "config")).equals(parentConfig)).toBe(true)
    expect(git(repoDir, "rev-parse", "--show-toplevel")).toBe(repoDir)
    expect(git(repoDir, "rev-list", "--count", "HEAD")).toBe("1")
  })
})
