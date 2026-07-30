import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { app } from "../server/src/app.js";
import { databasePath } from "../server/src/config/database.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const clientRoot = path.join(projectRoot, "client");
const apiPort = 3000;
const webPort = 5173;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const apiServer = app.listen(apiPort, () => {
  console.log(`API: http://localhost:${apiPort}`);
  console.log(`SQLite: ${databasePath}`);
});

function proxyApi(request, response) {
  const proxyRequest = http.request(
    {
      hostname: "localhost",
      port: apiPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 500, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on("error", () => {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ message: "无法连接本地 API" }));
  });
  request.pipe(proxyRequest);
}

function serveClient(request, response) {
  if (request.url?.startsWith("/api/")) {
    proxyApi(request, response);
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(clientRoot, relativePath);

  if (!filePath.startsWith(`${clientRoot}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  pipeline(fs.createReadStream(filePath), response, (error) => {
    if (error && !response.headersSent) response.writeHead(500);
  });
}

const webServer = http.createServer(serveClient);
webServer.listen(webPort, () => {
  console.log(`Web: http://localhost:${webPort}`);
});

let isStopping = false;
function stop() {
  if (isStopping) return;
  isStopping = true;
  webServer.close();
  apiServer.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);