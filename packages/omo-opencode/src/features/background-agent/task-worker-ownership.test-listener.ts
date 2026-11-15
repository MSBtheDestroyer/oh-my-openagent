import { createServer } from "node:http"

const server = createServer((_request, response) => response.writeHead(404).end())
server.on("connection", () => process.stdout.write("connection\n"))
server.listen(Number(process.argv[2]), "127.0.0.1", () => process.stdout.write("listening\n"))
