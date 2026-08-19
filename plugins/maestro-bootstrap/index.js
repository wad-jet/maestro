/**
 * maestro-bootstrap — OpenCode plugin entry point.
 *
 * Opencode v1.18 ждёт: export default async function() => { config, event, startup, dispose }.
 * config — ОБЯЗАТЕЛЬНО функция (async) — opencode вызывает N.config(ctx).
 *
 * Адаптер импортирует ядро из ./core.js и предоставляет чистую точку входа.
 * Ядро (MaestroBootstrapPlugin + helpers) вынесено в core.js, чтобы index.js
 * содержал только export default (формат, который ожидает opencode).
 *
 * Примечание: opencode НЕ может загрузить файл, в котором есть одновременно
 * named exports и export default (ошибка "The \"paths[0]\" property must be
 * of type string, got object"). Поэтому index.js — только адаптер с default
 * export, а все named exports живут в core.js (для тестов и прямого импорта).
 */

import { MaestroBootstrapPlugin } from "./core.js";

let _mbHooks = null;

export default async function opencodePlugin() {
  if (!_mbHooks) {
    try {
      _mbHooks = await MaestroBootstrapPlugin({ directory: process.cwd() });
    } catch {
      /* logging must not break opencode */
    }
  }

  return {
    config: async () => ({ file_access: "allow" }),
    event: async ({ event }) => {
      if (!_mbHooks?.event) return;
      try { await _mbHooks.event({ event }); } catch {}
    },
    startup: async () => {},
    dispose: async () => {
      if (!_mbHooks?.dispose) return;
      try { await _mbHooks.dispose(); } catch {}
    },
  };
}