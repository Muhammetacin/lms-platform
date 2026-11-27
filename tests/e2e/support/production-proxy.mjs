import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";

const certificateDirectory = process.env.E2E_TLS_DIRECTORY;
if (process.env.CI !== "true" || !certificateDirectory) {
  throw new Error("The production test proxy requires the CI TLS fixture.");
}

createServer({
  cert: readFileSync(join(certificateDirectory, "cert.pem")),
  key: readFileSync(join(certificateDirectory, "key.pem")),
}, (incoming, outgoing) => {
  const upstream = request({
    hostname: "127.0.0.1",
    port: 3101,
    method: incoming.method,
    path: incoming.url,
    headers: {
      ...incoming.headers,
      "x-forwarded-for": incoming.socket.remoteAddress,
      "x-forwarded-host": "127.0.0.1:3100",
      "x-forwarded-port": "3100",
      "x-forwarded-proto": "https",
      "x-lms-test-client-ip": incoming.socket.remoteAddress,
    },
  }, (result) => {
    outgoing.writeHead(result.statusCode, result.headers);
    result.pipe(outgoing);
  });
  upstream.on("error", () => {
    if (outgoing.headersSent) outgoing.destroy();
    else outgoing.writeHead(502).end();
  });
  outgoing.on("close", () => upstream.destroy());
  incoming.pipe(upstream);
}).listen(3100, "127.0.0.1");
