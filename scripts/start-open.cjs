/**
 * next start（生产）→ 首页 2xx 后再打开浏览器
 * 先执行 npm run build，再：npm run start:open
 * 端口：环境变量 PORT（默认 3000）
 */
const { spawn, execSync, exec } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const port = String(process.env.PORT || "3000").trim() || "3000";
const url = `http://127.0.0.1:${port}`;

function freeWin32Port(p) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    const re = new RegExp(`:${p}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of out.split("\n")) {
      const m = line.match(re);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function openBrowser() {
  if (process.platform === "win32") {
    exec(`cmd /c start "" "${url}"`, { shell: true });
    return;
  }
  if (process.platform === "darwin") {
    exec(`open "${url}"`, { shell: true });
    return;
  }
  exec(`xdg-open "${url}"`, { shell: true });
}

function checkOk(cb) {
  const req = http.get(url, (res) => {
    const ok = res.statusCode >= 200 && res.statusCode < 400;
    cb(ok);
    res.resume();
  });
  req.on("error", () => cb(false));
  req.setTimeout(4000, () => {
    req.destroy();
    cb(false);
  });
}

const nextDir = path.join(root, ".next");
if (!fs.existsSync(nextDir)) {
  console.error("未找到 .next，请先在本目录执行: npm run build");
  process.exit(1);
}

freeWin32Port(port);
if (port === "3000") freeWin32Port("3001");

const child = spawn("npm", ["run", "start", "--", "-p", port], {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env: { ...process.env, PORT: port },
});

let opened = false;
let n = 0;
const intervalMs = 300;
const maxTicks = 200;

let iv;
function tick() {
  n += 1;
  if (n > maxTicks) {
    clearInterval(iv);
    if (!opened) {
      console.error("超时：仍尝试打开浏览器");
      opened = true;
      openBrowser();
    }
    return;
  }
  checkOk((ok) => {
    if (ok && !opened) {
      opened = true;
      clearInterval(iv);
      console.log(`生产服务已就绪 (${url})，正在打开浏览器…`);
      openBrowser();
    }
  });
}

iv = setInterval(tick, intervalMs);
setTimeout(tick, 400);

child.on("exit", (code) => {
  clearInterval(iv);
  process.exit(code ?? 0);
});
