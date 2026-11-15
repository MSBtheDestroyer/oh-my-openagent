import { currentOwnerProcess } from "./owner-process-identity"
import { TaskWorkerOwnership } from "./task-worker-ownership"

const owner = await new TaskWorkerOwnership(async () => "owned").open()
process.stdout.write(`${JSON.stringify({ owner, ownerProcess: await currentOwnerProcess() })}\n`)
process.stdin.resume()
