/**
 * Общий tool-shim: `tool()` / `tool.schema` (zero-dep).
 *
 * При наличии `@opencode-ai/plugin` (целевой opencode-runtime, peer-зависимость)
 * использует нативный tool + zod; при его отсутствии (тестовая среда) —
 * identity-fallback + минимальный zod-совместимый schema-builder. Дублирует
 * `memory/index.js` → вынесен для переиспользания (memory-модуль на него
 * не мигрируем — из-за стабильности).
 */

let native;
try {
  native = await import("@opencode-ai/plugin");
} catch {
  native = null;
}

const isFn = (v) => typeof v === "function";

const makeSchema = () => {
  const base = {
    optional: () => base,
    nullable: () => base,
    describe: () => base,
    array: () => base,
  };
  return {
    string: () => base,
    number: () => base,
    boolean: () => base,
    object: () => base,
    literal: () => base,
    enum: () => base,
    union: () => base,
    record: () => base,
    any: () => base,
    unknown: () => base,
    array: () => base,
  };
};

const makeTool = (def) => def;

export const tool =
  native?.tool &&
  isFn(native.tool) &&
  native.schema &&
  isFn(native.schema.string)
    ? native.tool
    : Object.assign(makeTool, { schema: makeSchema() });
