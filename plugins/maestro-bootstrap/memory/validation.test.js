import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImportEntry } from "./validation.js";

const storage8 = { dim: 8, modelId: "test-model" };
const emb8 = [1, 2, 3, 4, 5, 6, 7, 8];

/** helper: базовая валидная запись v3 с dim=8 */
function baseEntry(overrides = {}) {
  return {
    session_id: "s1",
    key: "k1",
    origin_project_hash: "abc",
    title: "t",
    summary: "s",
    decisions: [],
    embedding: emb8.slice(),
    model_id: "test-model",
    author: "alice",
    time_first: 1,
    time_last: 2,
    version: 0,
    ...overrides,
  };
}

test("validateImportEntry: валидная запись → null", () => {
  const e = baseEntry();
  assert.equal(validateImportEntry(e, storage8, "k1"), null);
});

test("validateImportEntry: чужой key → причина", () => {
  const e = baseEntry({ key: "other-key" });
  assert.match(validateImportEntry(e, storage8, "k1"), /key/);
});

test("validateImportEntry: чужой model_id → причина", () => {
  const e = baseEntry({ model_id: "other" });
  assert.match(validateImportEntry(e, storage8, "k1"), /model_id/);
});

test("validateImportEntry: dim-несовпадение → причина", () => {
  const e = baseEntry({ embedding: [1, 2, 3] });
  assert.match(validateImportEntry(e, storage8, "k1"), /размерн|dim/);
});

test("validateImportEntry: отсутствует required поле → причина", () => {
  const e = baseEntry();
  delete e.title;
  assert.match(validateImportEntry(e, storage8, "k1"), /отсутствует поле/);
});

test("validateImportEntry: не-объект → причина", () => {
  assert.match(validateImportEntry(null, storage8, "k1"), /не объект/);
  assert.match(validateImportEntry("x", storage8, "k1"), /не объект/);
});

test("validateImportEntry: decisions не массив → причина", () => {
  const e = baseEntry({ decisions: "not-array" });
  assert.match(validateImportEntry(e, storage8, "k1"), /decisions/);
});

test("validateImportEntry: embedding не массив → причина", () => {
  const e = baseEntry({ embedding: "not-array" });
  assert.match(validateImportEntry(e, storage8, "k1"), /embedding не массив/);
});

test("validateImportEntry: embedding содержит нечисловые/неконечные → причина", () => {
  const badEmb = emb8.map((v) => v);
  badEmb[0] = NaN;
  const e = baseEntry({ embedding: badEmb });
  assert.match(validateImportEntry(e, storage8, "k1"), /embedding.*нечисл|неконечн/);
});

test("validateImportEntry: time_first не число → причина", () => {
  const e = baseEntry({ time_first: "1" });
  assert.match(validateImportEntry(e, storage8, "k1"), /time_first/);
});

test("validateImportEntry: artifacts: больше 8 → причина", () => {
  const e = baseEntry({ artifacts: Array(9).fill("a/b.md") });
  assert.match(validateImportEntry(e, storage8, "k1"), /больше 8/);
});

test("validateImportEntry: artifacts: ведущий / → причина", () => {
  const e = baseEntry({ artifacts: ["/foo.md"] });
  assert.match(validateImportEntry(e, storage8, "k1"), /ведущий \//);
});

test("validateImportEntry: artifacts: ..-сегмент → причина", () => {
  const e = baseEntry({ artifacts: ["../foo.md"] });
  assert.match(validateImportEntry(e, storage8, "k1"), /\.\.-сегмент/);
});

test("validateImportEntry: artifacts: control chars → причина", () => {
  const e = baseEntry({ artifacts: ["foo\t.md"] });
  assert.match(validateImportEntry(e, storage8, "k1"), /control chars/);
});

test("validateImportEntry: artifacts: backslash → причина", () => {
  const e = baseEntry({ artifacts: ["foo\\bar.md"] });
  assert.match(validateImportEntry(e, storage8, "k1"), /backslash/);
});

test("validateImportEntry: artifacts: drive-letter → причина", () => {
  const e = baseEntry({ artifacts: ["C:/foo.md"] });
  assert.match(validateImportEntry(e, storage8, "k1"), /drive-letter/);
});

test("validateImportEntry: artifacts опционален → без artifacts null", () => {
  const e = baseEntry({ artifacts: undefined });
  assert.equal(validateImportEntry(e, storage8, "k1"), null);
});
