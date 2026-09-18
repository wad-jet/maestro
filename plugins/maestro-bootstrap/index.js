/**
 * maestro-bootstrap — OpenCode plugin entry point.
 *
 * opencode вызывает каждый function-export модуля (включая default) с
 * (input, options) и использует ВЕСЬ возвращённый объект как hooks:
 * hook[name] по любому ключу (event, tool, tool.execute.before/after,
 * chat.message, experimental.*, dispose, ...). Поэтому адаптер ОБЯЗАН
 * пробрасывать ВСЕ хуки core, а не только config/event/startup/dispose —
 * иначе memory-инструменты (tool), санитайзер/confidential
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
import { createBootstrapAdapter, MaestroBootstrapPlugin } from "./core.js";

const adapter = createBootstrapAdapter(async (input) =>
  MaestroBootstrapPlugin({
    directory: process.cwd(),
    client: input?.client,
  }),
);

export default adapter;
