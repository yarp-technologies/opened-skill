import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/opened-init.mjs", import.meta.url));
const fakeKey = `loom_${"x".repeat(43)}`;

async function start(t, variables = {}, scriptPath = script) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opened-init-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    XGD_CONFIG_DIR: path.join(directory, "legacy"),
    XDG_CONFIG_HOME: path.join(directory, "config"),
    ...variables,
  };
  const { stdout, stderr } = await exec(process.execPath, [scriptPath], { cwd: directory, env, timeout: 5000 });
  assert.equal(stderr, "");
  assert.equal(stdout.includes(fakeKey), false);
  const url = new URL(stdout.trim());
  assert.equal(url.hostname, "127.0.0.1");
  t.after(async () => {
    await fetch(`${url.href}/cancel`, {
      method: "POST",
      headers: { Origin: url.origin },
    }).catch(() => {});
  });
  return { directory, env, url };
}

test("the local form receives the key without echoing it and saves it privately", async (t) => {
  const { env, url } = await start(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control"), /no-store/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await page.text(), /type="password"/);

  const response = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(fakeKey), false);
  const keyFile = path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key");
  assert.equal(await readFile(keyFile, "utf8"), fakeKey);
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
});

test("a wrong origin, wrong path, or malformed key cannot initialize the file", async (t) => {
  const { env, url } = await start(t);
  const request = (target, origin, key = fakeKey) =>
    fetch(target, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key }),
    });
  assert.equal((await request(url, "http://attacker.invalid")).status, 403);
  assert.equal((await request(url, "null")).status, 403);
  assert.equal((await request(new URL("/wrong", url), url.origin)).status, 404);
  const invalid = await request(url, url.origin, "invalid");
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.text()).includes("invalid"), false);
  assert.equal((await request(url, url.origin, "x".repeat(3000))).status, 413);
  await assert.rejects(stat(path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key")), {
    code: "ENOENT",
  });
});

test("cancellation closes the form without creating a key", async (t) => {
  const { env, url } = await start(t);
  const result = await fetch(`${url.href}/cancel`, {
    method: "POST",
    headers: { Origin: url.origin },
  });
  assert.equal(result.status, 200);
  await assert.rejects(stat(path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key")), {
    code: "ENOENT",
  });
  const after = await fetch(url).catch(() => undefined);
  if (after) assert.equal(after.status, 410);
});

test("reinitialization replaces the key with a private file", async (t) => {
  const first = await start(t);
  const send = (url, key) =>
    fetch(url, {
      method: "POST",
      headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key }),
    });
  assert.equal((await send(first.url, fakeKey)).status, 200);
  const keyFile = path.join(first.env.XDG_CONFIG_HOME, "opened", "loom-api-key");
  await chmod(keyFile, 0o644);
  const { stdout } = await exec(process.execPath, [script], { env: first.env, timeout: 5000 });
  const secondUrl = new URL(stdout.trim());
  t.after(() => fetch(`${secondUrl.href}/cancel`, { method: "POST", headers: { Origin: secondUrl.origin } }).catch(() => {}));
  const replacement = `loom_${"y".repeat(43)}`;
  assert.equal((await send(secondUrl, replacement)).status, 200);
  assert.equal(await readFile(keyFile, "utf8"), replacement);
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
});

test("without the custom variable, initialization uses XDG_CONFIG_HOME", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opened-init-xdg-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configured = path.join(directory, "xdg");
  const { url } = await start(t, { XGD_CONFIG_DIR: "", XDG_CONFIG_HOME: configured });
  const result = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(result.status, 200);
  assert.equal(await readFile(path.join(configured, "opened", "loom-api-key"), "utf8"), fakeKey);
});

test("a second submission cannot replace a key while the first is being received", async (t) => {
  const { env, url } = await start(t);
  const form = new URLSearchParams({ key: fakeKey }).toString();
  const firstDone = new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "POST",
      headers: {
        Origin: url.origin,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(form),
      },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.write(form.slice(0, 1));
    setTimeout(async () => {
      try {
        const second = await fetch(url, {
          method: "POST",
          headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ key: `loom_${"z".repeat(43)}` }),
        });
        assert.equal(second.status, 409);
        request.end(form.slice(1));
      } catch (error) {
        request.destroy();
        reject(error);
      }
    }, 50);
  });
  assert.equal(await firstDone, 200);
  assert.equal(await readFile(path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key"), "utf8"), fakeKey);
});

test("the documented API function sends a private key only in the HTTP header", async (t) => {
  const { env, url } = await start(t);
  const saved = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(saved.status, 200);
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/api/roadmaps");
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const skill = await readFile(fileURLToPath(new URL("../SKILL.md", import.meta.url)), "utf8");
  const shell = skill.match(/```sh\n([\s\S]*?)\n```/)[1];
  const shellEnv = { ...env, OPENED_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  const result = await exec("sh", ["-c", `${shell}\nopened_api '/roadmaps'`], { env: shellEnv });
  assert.equal(result.stdout, "[]");
  assert.equal(result.stderr.includes(fakeKey), false);
  await chmod(path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key"), 0o644);
  await assert.rejects(exec("sh", ["-c", `${shell}\nopened_api '/roadmaps'`], { env: shellEnv }), (error) => {
    assert.match(error.stderr, /mode 600/);
    assert.equal(error.stderr.includes(fakeKey), false);
    return true;
  });
});

test("initialization falls back to the user's XDG configuration directory", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "opened-init-home-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { url } = await start(t, { HOME: home, XGD_CONFIG_DIR: "", XDG_CONFIG_HOME: "" });
  const result = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(result.status, 200);
  assert.equal(await readFile(path.join(home, ".config", "opened", "loom-api-key"), "utf8"), fakeKey);
});

test("initialization and API calls ignore a relative XDG_CONFIG_HOME", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "opened-relative-xdg-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { directory, env, url } = await start(t, { HOME: home, XGD_CONFIG_DIR: "", XDG_CONFIG_HOME: "relative" });
  const saved = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(path.join(home, ".config", "opened", "loom-api-key"), "utf8"), fakeKey);
  await assert.rejects(stat(path.join(directory, "relative", "opened", "loom-api-key")), { code: "ENOENT" });

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`);
    response.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const skill = await readFile(fileURLToPath(new URL("../SKILL.md", import.meta.url)), "utf8");
  const shell = skill.match(/```sh\n([\s\S]*?)\n```/)[1];
  const result = await exec("sh", ["-c", `${shell}\nopened_api '/roadmaps'`], {
    cwd: directory,
    env: { ...env, OPENED_BASE_URL: `http://127.0.0.1:${server.address().port}` },
  });
  assert.equal(result.stdout, "[]");
  assert.equal(result.stderr.includes(fakeKey), false);
});

test("opened-init can initialize a key without the opened-api skill installed", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opened-init-only-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installed = path.join(directory, "opened-init");
  await cp(fileURLToPath(new URL("../../opened-init", import.meta.url)), installed, { recursive: true });
  const { env, url } = await start(t, {}, path.join(installed, "scripts", "opened-init.mjs"));
  const result = await fetch(url, {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: fakeKey }),
  });
  assert.equal(result.status, 200);
  assert.equal(await readFile(path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key"), "utf8"), fakeKey);
});

test("initialization refuses native Windows when POSIX key permissions cannot be guaranteed", async (t) => {
  const moduleUrl = new URL("../scripts/opened-init.mjs", import.meta.url).href;
  const probe = 'Object.defineProperty(process, "platform", { value: "win32" }); await import(process.argv[1]);';
  let result;
  try {
    result = await exec(process.execPath, ["--input-type=module", "-e", probe, moduleUrl], { timeout: 5000 });
  } catch (error) {
    result = error;
  }
  if (result.stdout.startsWith("http://127.0.0.1:")) {
    const url = new URL(result.stdout.trim());
    t.after(() => fetch(`${url.href}/cancel`, { method: "POST", headers: { Origin: url.origin } }).catch(() => {}));
  }
  assert.notEqual(result.code, undefined);
  assert.match(result.stderr, /POSIX|Windows/);
});

async function migrationFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opened-migration-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    XGD_CONFIG_DIR: path.join(directory, "legacy"),
    XDG_CONFIG_HOME: path.join(directory, "config"),
  };
  const source = path.join(env.XGD_CONFIG_DIR, "edharness", "opened_key");
  const target = path.join(env.XDG_CONFIG_HOME, "opened", "loom-api-key");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, fakeKey, { mode: 0o600 });
  return { env, source, target };
}

async function migrate(t, env) {
  try {
    const result = await exec(process.execPath, [script, "--migrate"], { env, timeout: 5000 });
    if (result.stdout.startsWith("http://127.0.0.1:")) {
      const url = new URL(result.stdout.trim());
      t.after(() => fetch(`${url.href}/cancel`, { method: "POST", headers: { Origin: url.origin } }).catch(() => {}));
    }
    return result;
  } catch (error) {
    return error;
  }
}

test("migration copies a legacy private key to the shared Opened directory without revealing it", async (t) => {
  const { env, source, target } = await migrationFixture(t);
  const result = await migrate(t, env);
  assert.equal(result.code, undefined);
  assert.equal(result.stdout.includes(fakeKey), false);
  assert.equal(result.stderr.includes(fakeKey), false);
  assert.equal(await readFile(target, "utf8"), fakeKey);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.equal(await readFile(source, "utf8"), fakeKey);
});

test("migration finds a legacy key in XDG_CONFIG_HOME when XGD_CONFIG_DIR is unset", async (t) => {
  const { env, target } = await migrationFixture(t);
  env.XGD_CONFIG_DIR = "";
  const source = path.join(env.XDG_CONFIG_HOME, "edharness", "opened_key");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, fakeKey, { mode: 0o600 });
  const result = await migrate(t, env);
  assert.equal(result.code, undefined);
  assert.equal(await readFile(target, "utf8"), fakeKey);
});

test("migration never overwrites an existing shared key", async (t) => {
  const { env, target } = await migrationFixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  const existing = `loom_${"y".repeat(43)}`;
  await writeFile(target, existing, { mode: 0o600 });
  const result = await migrate(t, env);
  assert.notEqual(result.code, undefined);
  assert.equal(await readFile(target, "utf8"), existing);
  assert.equal(result.stderr.includes(fakeKey), false);
});

test("migration refuses an unsafe legacy key file", async (t) => {
  const { env, source, target } = await migrationFixture(t);
  await chmod(source, 0o644);
  const result = await migrate(t, env);
  assert.notEqual(result.code, undefined);
  assert.equal(result.stderr.includes(fakeKey), false);
  await assert.rejects(stat(target), { code: "ENOENT" });
});

test("migration refuses a legacy key file reached through a symlink", async (t) => {
  const { env, source, target } = await migrationFixture(t);
  const linkTarget = `${source}-real`;
  await writeFile(linkTarget, fakeKey, { mode: 0o600 });
  await rm(source);
  await symlink(linkTarget, source);
  const result = await migrate(t, env);
  assert.notEqual(result.code, undefined);
  assert.equal(result.stderr.includes(fakeKey), false);
  await assert.rejects(stat(target), { code: "ENOENT" });
});

test("migration refuses a writable shared key directory", async (t) => {
  const { env, source, target } = await migrationFixture(t);
  await mkdir(path.dirname(target), { recursive: true });
  await chmod(path.dirname(target), 0o777);
  const result = await migrate(t, env);
  assert.notEqual(result.code, undefined);
  assert.equal(result.stderr.includes(fakeKey), false);
  assert.equal(await readFile(source, "utf8"), fakeKey);
  await assert.rejects(stat(target), { code: "ENOENT" });
});
