// ABOUTME: Forwards a local port to a remote party server over TLS, for both HTTP and WebSocket requests.
// ABOUTME: Lets a dev page that defaults to localhost:1999 talk to a chosen remote server: `node e2e/v2/feel/party-proxy.mjs <port> <host>`.

import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const port = Number(process.argv[2]);
const remoteHost = process.argv[3];
if (!port || !remoteHost) {
  throw new Error("Usage: node party-proxy.mjs <port> <host>");
}

const server = http.createServer((request, response) => {
  const upstream = https.request(
    {
      host: remoteHost,
      port: 443,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: remoteHost },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const upstream = tls.connect(
    { host: remoteHost, port: 443, servername: remoteHost, ALPNProtocols: ["http/1.1"] },
    () => {
      const headers = { ...request.headers, host: remoteHost };
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        for (const item of [].concat(value)) lines.push(`${name}: ${item}`);
      }
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.setNoDelay(true);
      socket.setNoDelay(true);
      upstream.pipe(socket);
      socket.pipe(upstream);
    },
  );
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(port, "127.0.0.1", () => {
  console.log(`proxy ready on ${port} -> ${remoteHost}`);
});
