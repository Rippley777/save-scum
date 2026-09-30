// Development/test server for the generated static artifact. Never deployed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
const root = resolve(new URL("../dist/", import.meta.url).pathname);
const config = JSON.parse(
  await readFile(join(root, "staticwebapp.config.json"), "utf8"),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".json": "application/json",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    let file = resolve(root, "." + path);
    if (!file.startsWith(root + "/") && file !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    for (const [name, value] of Object.entries(config.globalHeaders))
      res.setHeader(name, value);
    let status = 200;
    try {
      if ((await stat(file)).isDirectory()) {
        if (!path.endsWith("/")) {
          res.writeHead(301, { Location: path + "/" + url.search });
          res.end();
          return;
        }
        file = join(file, "index.html");
      }
      await stat(file);
    } catch {
      file = join(root, "404.html");
      status = 404;
    }
    const body = await readFile(file);
    res.writeHead(status, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500);
    res.end("Unable to serve artifact");
  }
}).listen(Number(process.env.PORT || 4388), "127.0.0.1", () =>
  console.log(
    "Static artifact: http://127.0.0.1:" + (process.env.PORT || 4388),
  ),
);
