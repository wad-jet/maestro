/**
 * Общий RRF-хелпер (Reciprocal Rank Fusion) для гибридного поиска.
 *
 * Объединяет косин-ранжированный векторный список и один или несколько
 * текстовых (FTS) списков в единый ранжированный результат. Каждый источник
 * вносит вклад 1/(K + rank), где rank — позиция (0-based) в своём списке.
 * Итоговая сортировка — по сумме вкладов (rrf) по убыванию.
 *
 * @param {Array<{entry, score}>} vectorHits — косин-ранжированный список
 *   (уже отфильтрован по min_score, отсортирован по score desc).
 * @param {Array<Array<{session_id}>>} textHitLists — по-ключевые текстовые
 *   списки, best-first.
 * @param {Object} [opts]
 * @param {number} [opts.K=60] — константа сглаживания RRF.
 * @param {Function} [opts.fetchEntry] — async (session_id) => entry; вызывается
 *   только для text-only хитов (нет entry в vectorHits).
 * @returns {Promise<Array<{entry, score, rrf}>>} — сортировка по rrf desc;
 *   text-only хит получает score: 0.5.
 */
export async function fuseRrf(vectorHits, textHitLists, { K = 60, fetchEntry } = {}) {
  const merged = new Map(); // session_id -> { rrf, entry, score }
  vectorHits.forEach((h, i) => {
    const cur = merged.get(h.entry.session_id) || { rrf: 0, entry: h.entry, score: h.score };
    cur.rrf += 1 / (K + i + 1);
    merged.set(h.entry.session_id, cur);
  });
  for (const list of textHitLists) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const cur = merged.get(r.session_id) || { rrf: 0, entry: null, score: 0.5 };
      cur.rrf += 1 / (K + i + 1);
      if (!cur.entry) {
        cur.entry = fetchEntry ? await fetchEntry(r.session_id) : { session_id: r.session_id };
        cur.score = 0.5; // text-only хит: низкий display score
      }
      merged.set(r.session_id, cur);
    }
  }
  return [...merged.values()]
    .filter((m) => m.entry)
    .sort((a, b) => b.rrf - a.rrf)
    .map(({ entry, score, rrf }) => ({ entry, score, rrf }));
}
