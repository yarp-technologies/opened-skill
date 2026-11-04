import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lifetime = 10 * 60 * 1000;
const maxBody = 2048;

if (process.platform === "win32") {
  console.error("Native Windows is not supported because POSIX key permissions cannot be guaranteed. Use WSL.");
  process.exitCode = 1;
} else if (process.argv[2] === "--migrate" || process.argv[2] === "--migrate-previous") {
  const previous = process.argv[2] === "--migrate-previous";
  try {
    if (
      (previous && process.argv.length !== 3) ||
      (!previous && (process.argv.length !== 4 || !process.argv[3]))
    ) {
      console.error(
        previous ? "The previous-key migration takes no arguments." : "Specify the path to the existing key file after --migrate.",
      );
      process.exitCode = 1;
    } else {
      const source = previous ? path.join(configDirectory(), "opened", "loom-api-key") : process.argv[3];
      if (await migrate(source)) {
        console.log("The existing Opened key was copied to the current configuration location.");
      } else {
        console.error("The existing Opened key was not found.");
        process.exitCode = previous ? 2 : 1;
      }
    }
  } catch (error) {
    if (error.code === "EEXIST") console.error("An Opened key already exists and was not changed.");
    else console.error("Could not migrate the Opened key. Check the key and directory permissions.");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "--serve") {
  await serve();
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const timer = setTimeout(() => {
    child.kill();
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  }, 5000);
  child.once("message", (message) => {
    clearTimeout(timer);
    if (typeof message !== "string" || !message.startsWith("http://127.0.0.1:")) {
      console.error("Could not start the local initialization form.");
      process.exitCode = 1;
    } else {
      console.log(message);
    }
    child.disconnect();
    child.unref();
  });
  child.once("error", () => {
    clearTimeout(timer);
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    if (!child.connected || code === 0) return;
    clearTimeout(timer);
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  });
}

async function serve() {
  const route = `/${randomBytes(32).toString("hex")}`;
  let busy = false;
  let closed = false;
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 500, "Could not save the key. Check local file permissions.");
      else response.end();
    });
  });
  server.requestTimeout = 30_000;
  const timer = setTimeout(() => server.close(), lifetime);

  function finish(response, text) {
    closed = true;
    reply(response, 200, text);
    clearTimeout(timer);
    server.close();
  }

  async function handle(request, response) {
    if (closed) {
      reply(response, 410, "Initialization has ended.");
      return;
    }
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== origin.slice("http://".length)) {
      reply(response, 403, "Request denied.");
      return;
    }
    if (request.url !== route && request.url !== `${route}/cancel`) {
      reply(response, 404, "Page not found.");
      return;
    }
    if (request.method === "GET" && request.url === route) {
      reply(response, 200, form(route));
      return;
    }
    if (request.method !== "POST" || request.headers.origin !== origin) {
      reply(response, 403, "Request denied.");
      return;
    }
    if (busy) {
      reply(response, 409, "Initialization is already in progress.");
      return;
    }
    if (request.url === `${route}/cancel`) {
      finish(response, "Initialization cancelled. You can close this page.");
      return;
    }
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/x-www-form-urlencoded") {
      reply(response, 400, "Unsupported form submission.");
      return;
    }
    busy = true;
    request.setTimeout(30_000, () => request.destroy());
    try {
      let size = 0;
      const parts = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBody) {
          reply(response, 413, "Form is too large.");
          return;
        }
        parts.push(chunk);
      }
      const fields = new URLSearchParams(Buffer.concat(parts).toString("utf8"));
      const values = fields.getAll("key");
      const key = values.length === 1 ? values[0].trim() : "";
      if (!/^loom_[A-Za-z0-9_-]{20,128}$/.test(key)) {
        reply(response, 400, "The key format is not recognized. Use your Opened API key.");
        return;
      }
      await save(key);
      finish(response, "The Opened key was saved. You can close this page.");
    } finally {
      busy = false;
    }
  }

  server.listen(0, "127.0.0.1", () => {
    process.send?.(`http://127.0.0.1:${server.address().port}${route}`);
  });
}

function reply(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    // `no-referrer` makes browsers send Origin: null on the form POST.
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(body);
}

function form(route) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Opened</title><style>:root{color-scheme:light dark}body{font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1.25rem;line-height:1.5}input{box-sizing:border-box;width:100%;padding:.7rem;margin:.5rem 0 1rem}button{padding:.6rem 1rem;margin-right:.5rem}form{display:inline}label{display:block}</style></head>
<body><h1>Connect Opened</h1><p>Paste your Opened API key here, not in the agent chat. It stays on this computer. Saving replaces any previously stored Opened key.</p>
<form method="post" action="${route}" autocomplete="off"><label for="key">Opened API key</label><input id="key" name="key" type="password" autocomplete="off" required autofocus><button type="submit">Save key</button></form>
<form method="post" action="${route}/cancel"><button type="submit">Cancel</button></form></body></html>`;
}

async function migrate(source) {
  let file;
  try {
    file = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let key;
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 133 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("The legacy key is not private.");
    }
    key = (await file.readFile("utf8")).trim();
    if (!/^loom_[A-Za-z0-9_-]{20,128}$/.test(key)) throw new Error("The legacy key format is not recognized.");
  } finally {
    await file.close();
  }
  await save(key, false);
  return true;
}

function configDirectory() {
  const configured = process.env.XDG_CONFIG_HOME || "";
  return path.isAbsolute(configured) ? configured : path.join(os.homedir(), ".config");
}

async function save(key, replace = true) {
  const directory = path.join(configDirectory(), "opened");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) {
    throw new Error("The key directory is not private.");
  }
  const temporary = path.join(directory, `.opened-key-${randomBytes(16).toString("hex")}`);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(key, "utf8");
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
    const target = path.join(directory, "api-key");
    if (replace) await rename(temporary, target);
    else await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
