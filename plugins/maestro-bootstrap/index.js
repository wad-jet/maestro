/**
 * maestro-bootstrap — OpenCode V2 plugin entry point.
 *
 * V2 формат: Plugin.define({ id, setup(ctx) }) — создаёт плагин через контекст.
 *
 * Примечание: V2 плагин не поддерживает V1 format (function returning hooks).
 * Если OpenCode V1 — ошибка на этапе загрузки (ERR: expected Plugin.define).
 *
 * `@opencode/plugin` предоставляется рантаймом OpenCode V2. Если пакет
 * недоступен (plain node, тесты) — fallback identity: default export =
 * определение { id, setup } напрямую (валидная форма V2-дефиниции).
 */
import { createBootstrapPlugin } from "./core.js";

let Plugin;
try {
  ({ Plugin } = await import("@opencode/plugin"));
} catch {
  Plugin = { define: (def) => def };
}

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
