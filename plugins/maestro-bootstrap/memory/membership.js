/**
 * Членство записи памяти в контексте (spec §6.1). Таблица сверху вниз,
 * первое совпадение:
 *   1. merged = 1 → general
 *   2. merged = 0 AND head ∈ mainlineSet → general (окно pull→init;
 *      «раз доказано — general»)
 *   3. merged = 0 AND head ∈ expSet → experience («⚠️ не в main»)
 *   4. merged = 0 AND head != '' AND head ∉ ancestorSet AND head ∉ mainlineSet
 *      → не в контексте
 *   5. head = '' → unattributed (только scope: project)
 * expSet = ancestorSet \ mainlineSet (правило 2 уже отсекло mainlineSet,
 * поэтому правило 3 сводится к head ∈ ancestorSet).
 *
 * @param {Array<{session_id: string, merged: number, head: string}>} candidates
 * @param {{ ancestorSet: Set<string>, mainlineSet: Set<string> }} sets
 * @returns {{ inContext: Set<string>, experience: Set<string>, dead: Set<string>, unknown: Set<string> }}
 *   inContext — session_id записей general+experience (допустимы в branch-scope);
 *   experience — session_id записей experience (для аннотации «⚠️ не в main»);
 *   dead — session_id записей merged=0, head != '' и head ∉ ancestorSet/mainlineSet
 *     («не в контексте»; тир dead в stats);
 *   unknown — session_id записей merged=0, head='' (unattributed; тир unknown в stats).
 */
export function applyBranchScope(candidates, { ancestorSet, mainlineSet }) {
  const inContext = new Set();
  const experience = new Set();
  const dead = new Set();
  const unknown = new Set();
  for (const c of candidates) {
    const head = c.head ?? "";
    if (c.merged === 1) { inContext.add(c.session_id); continue; }
    if (head !== "" && mainlineSet.has(head)) { inContext.add(c.session_id); continue; }
    if (head !== "" && ancestorSet.has(head)) { inContext.add(c.session_id); experience.add(c.session_id); continue; }
    if (head === "") { unknown.add(c.session_id); continue; }
    dead.add(c.session_id);
  }
  return { inContext, experience, dead, unknown };
}

/**
 * Вычисление наборов членства per-recall (кэш — один recall). Fail-soft:
 * revList null → наборы пусты → recall = merged=1 only (caller логирует).
 * mainline unresolved → mainlineSet = ∅ (НЕ fail-soft — окно pull→init).
 *
 * @param {{ revList: Function, detectMainline: Function, root: string,
 *   mainlineOverride?: string | null }} opts
 * @returns {{ ancestorSet: Set<string>, mainlineSet: Set<string>, failSoft: boolean }}
 */
export function computeBranchSets({ revList, detectMainline, root, mainlineOverride = null }) {
  const ancestorSet = revList(root, "HEAD");
  const mainline = detectMainline(root, { override: mainlineOverride });
  const mainlineSet = mainline ? revList(root, mainline.name) : new Set();
  const failSoft = ancestorSet === null || (mainline !== null && mainlineSet === null);
  return {
    ancestorSet: failSoft ? new Set() : ancestorSet,
    mainlineSet: failSoft ? new Set() : mainlineSet,
    failSoft,
  };
}