/**
 * maestro-bootstrap — OpenCode plugin entry point.
 *
 * opencode вызывает каждый function-export модуля (включая default) с
 * (input, options) и использует ВЕСЬ возвращённый объект как hooks:
 * hook[name] по любому ключу (event, tool, tool.execute.before/after,
 * chat.message, experimental.*, dispose, ...). Поэтому адаптер ОБЯЗАН
 * пробрасывать ВСЕ хуки core, а не только config/event/startup/dispose —
 * иначе memory-инструменты (tool), санитайзер/access_policy/confidential
 * (tool.execute.before/after) и auto_recall (chat.message +
 * experimental.chat.system.transform) недоступны в сессиях.
 *
 * config — ОБЯЗАТЕЛЬНО функция (async) — opencode вызывает hook.config?.(cfg).
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

export default async function opencodePlugin(input) {
  if (!_mbHooks) {
    try {
      _mbHooks = await MaestroBootstrapPlugin({
        directory: process.cwd(),
        client: input?.client,
      });
    } catch (err) {
      // I2: проглоченный сбой init тихо отключает ВСЕ хуки (confidential,
      // sanitizer, access_policy) → fail-open. Логируем, чтобы не было тихого
      // отключения защиты. Плагин не кэшируется — следующая инвокация повторит.
      console.error("[maestro-bootstrap] init failed:", err instanceof Error ? err.message : err);
      _mbHooks = null;
    }
  }

  // Fail-soft: init упал → минимальный каркас (без защиты).
  if (!_mbHooks) {
    return {
      config: async () => ({}),
      event: async () => {},
      startup: async () => {},
      dispose: async () => {},
    };
  }

  // Пробрасываем ВСЕ хуки core в opencode: event, dispose,
  // tool.execute.before/after (санитайзер/access_policy/confidential),
  // tool (memory-инструменты), chat.message + experimental.chat.system.transform
  // (auto_recall). `config: undefined` из core перекрываем пустой функцией —
  // opencode вызывает hook.config?.(cfg) (M12: НЕ форсируем file_access).
  return {
    ..._mbHooks,
    config: async () => ({}),
    startup: async () => {},
  };
}