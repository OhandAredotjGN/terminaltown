const test = require("node:test"),
  assert = require("node:assert/strict"),
  net = require("node:net"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
test("local API rejects cross-origin writes and private-file reads; valid state loads", async (t) => {
  const root = path.join(__dirname, ".."),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-api-test-"));
  const reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ["scripts/terminaltown-browser.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: tmp,
      CITY_MOUSE_DATA_DIR: tmp,
      TERMINALTOWN_LIVE: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  child.stdout.resume();
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(stderr || "Server exited");
    try {
      if ((await fetch(base + "/api/state")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "Server started with isolated storage: " + stderr);
  const state = await fetch(base + "/api/state");
  assert.equal(state.status, 200);
  assert.ok(await state.json());
  assert.equal(
    (
      await fetch(base + "/api/message", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/message", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  const rejectedHost = await new Promise((resolve, reject) => {
    require("node:http")
      .get(
        base + "/api/state",
        { headers: { host: "untrusted.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(rejectedHost, 403);
  const privateFile = await fetch(base + "/.git/config");
  assert.ok(
    privateFile.status === 404 ||
      !(await privateFile.text()).includes("[core]"),
  );
});
