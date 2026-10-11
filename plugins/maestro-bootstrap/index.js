/**
 * maestro-bootstrap — OpenCode V2 plugin entry point.
 *
 * V2 формат: Plugin.define({ id, setup(ctx) }) — создаёт плагин через контекст.
 *
 * Примечание: V2 плагин не поддерживает V1 format (function returning hooks).
 * Если OpenCode V1 — ошибка на этапе загрузки (ERR: expected Plugin.define).
 */
import { Plugin } from "@opencode/plugin";
import { createBootstrapPlugin } from "./core.js";

export default Plugin.define({
  id: "maestro-bootstrap",
  async setup(ctx) {
    try {
      await createBootstrapPlugin(ctx);
    } catch (err) {
      console.error("[maestro-bootstrap] setup failed:", err instanceof Error ? err.message : err);
      // Fail-soft: ошибка setup → плагин не загружается, сессия не ломается
    }
  },
});
