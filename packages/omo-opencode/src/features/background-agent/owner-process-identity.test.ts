import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { readProcessStart } from "./owner-process-identity"

// Storage contract: background-owner records written by builds that read the start with `ps -o lstart`
// must still compare equal, or a live owner of an older tab reads as a different process and is taken over.
test.skipIf(process.platform !== "darwin")("a live process's macOS start marker is the text ps prints", async () => {
  // given the start time ps reports for this process, in this runtime's zone
  const printed = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], {
    env: { ...process.env, LC_ALL: "C", TZ: Intl.DateTimeFormat().resolvedOptions().timeZone },
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/)
    .join(" ")

  // when
  const liveness = await readProcessStart(process.pid)

  // then
  expect(liveness).toEqual({ start: printed })
})
