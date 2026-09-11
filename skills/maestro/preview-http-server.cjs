#!/usr/bin/env node
/**
 * preview-http-server.cjs
 * Временный локальный preview-сервер для статических HTML-отчётов maestro.
 *
 * Использование:
 *   node preview-http-server.cjs <html-file> [--port N] [--no-open] [--ttl-min N] [--state-file PATH]
 *   node preview-http-server.cjs --stop <state-file>
 *
 * - Порт по умолчанию 0 — свободный порт от ОС; bind только 127.0.0.1.
 * - Отдаёт только один HTML-файл по случайному URL-токену (GET / → 404).
 * - Пишет state-файл (JSON) по готовности сервера и печатает строку `PREVIEW: <url>`.
 * - По умолчанию открывает браузер (open/xdg-open/start); --no-open отключает.
 * - --ttl-min: авто-завершение через N минут (0 = безлимит; дефолт 60).
 * - --stop: graceful-остановка сервера, запущенного ранее с этим state-файлом.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const DEFAULT_TTL_MIN = 60;

function fail(msg, code = 1) {
  process.stderr.write(`Ошибка: ${msg}\n`);
  process.exit(code);
}

function usage() {
  process.stderr.write(
    "Использование:\n" +
      "  node preview-http-server.cjs <html-file> [--port N] [--no-open] [--ttl-min N] [--state-file PATH]\n" +
      "  node preview-http-server.cjs --stop <state-file>\n",
  );
  process.exit(2);
}

function parseArgs(argv) {
  if (argv.length === 0) usage();
  if (argv[0] === "--stop") {
    if (argv.length !== 2) usage();
    return { mode: "stop", stateFile: argv[1] };
  }
  const args = { mode: "start", html: null, port: 0, open: true, ttlMin: DEFAULT_TTL_MIN, stateFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = parseInt(argv[++i], 10);
    else if (a === "--no-open") args.open = false;
    else if (a === "--ttl-min") args.ttlMin = parseFloat(argv[++i]);
    else if (a === "--state-file") args.stateFile = argv[++i];
    else if (a.startsWith("-")) usage();
    else args.html = a;
  }
  if (!args.html) usage();
  if (Number.isNaN(args.port) || args.port < 0 || args.port > 65535) fail("неверный --port");
  if (Number.isNaN(args.ttlMin) || args.ttlMin < 0) fail("неверный --ttl-min");
  return args;
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, header: res.headers["x-maestro-preview"] });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function killProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (e) {
    return false;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

async function waitExited(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isAlive(pid);
}

function removeStateFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    if (e.code !== "ENOENT") process.stderr.write(`Предупреждение: не удалось удалить state-файл: ${e.message}\n`);
  }
}

async function stopServer(stateFile) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (e) {
    process.stdout.write("Preview-сервер не запущен (state-файл отсутствует).\n");
    return;
  }
  const pid = state.pid;
  if (!isAlive(pid)) {
    removeStateFile(stateFile);
    process.stdout.write("Preview-сервер уже остановлен (state-файл устарел).\n");
    return;
  }
  const url = `http://127.0.0.1:${state.port}/${state.token}/`;
  const probe = await httpGet(url, 2000);
  if (probe === null || probe.status !== 200 || probe.header !== state.token) {
    process.stderr.write(
      `Предупреждение: процесс pid=${pid} не отвечает как наш preview-сервер (маркер не совпал) — не останавливаю.\n`,
    );
    return;
  }
  killProcess(pid, "SIGTERM");
  const exited = await waitExited(pid, 3000);
  if (!exited) killProcess(pid, "SIGKILL");
  await waitExited(pid, 1000);
  removeStateFile(stateFile);
  process.stdout.write("Preview-сервер остановлен.\n");
}

async function stopOldServer(stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.pid && isAlive(state.pid)) {
      process.stdout.write("Останавливаю предыдущий preview-сервер...\n");
      await stopServer(stateFile);
    } else {
      removeStateFile(stateFile);
    }
  } catch (e) {
    // state-файла нет — чистый старт
  }
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", (e) => {
    process.stderr.write(`Предупреждение: не удалось открыть браузер (${e.code}) — URL в выводе ниже.\n`);
  });
  child.unref();
}

async function startServer(args) {
  const html = path.resolve(args.html);
  if (!fs.existsSync(html) || !fs.statSync(html).isFile()) fail(`файл не найден: ${html}`);

  const stateFile = args.stateFile ? path.resolve(args.stateFile) : path.join(path.dirname(html), "preview-server.json");
  await stopOldServer(stateFile);

  const token = crypto.randomBytes(16).toString("hex");
  const basePath = `/${token}`;
  const htmlBytes = fs.readFileSync(html);

  const server = http.createServer((req, res) => {
    const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
    const isTarget = pathname === basePath || pathname === `${basePath}/index.html`;
    res.setHeader("X-Maestro-Preview", token);
    if (!isTarget) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": htmlBytes.length,
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : htmlBytes);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") fail(`порт ${args.port} занят — укажите --port 0 или свободный порт`);
    fail(`ошибка сервера: ${e.message}`);
  });

  let ttlTimer = null;
  function shutdown() {
    if (ttlTimer) clearTimeout(ttlTimer);
    removeStateFile(stateFile);
    try {
      server.closeAllConnections();
    } catch (e) {
      /* нет такого метода на старых Node */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(args.port, "127.0.0.1", () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}${basePath}/`;
    const state = { pid: process.pid, port, token, url, file: html, startedAt: new Date().toISOString(), ttlMin: args.ttlMin };
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, stateFile);

    process.stdout.write(`PREVIEW: ${url}\n`);
    if (args.ttlMin > 0) {
      ttlTimer = setTimeout(shutdown, args.ttlMin * 60 * 1000);
      process.stdout.write(`Сервер остановится автоматически через ${args.ttlMin} мин (или по --stop).\n`);
    } else {
      process.stdout.write("Сервер без TTL — остановите вручную: --stop с этим state-файлом.\n");
    }
    if (args.open) openBrowser(url);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "stop") {
    await stopServer(path.resolve(args.stateFile));
  } else {
    await startServer(args);
  }
}

main().catch((e) => fail(e.stack || String(e)));