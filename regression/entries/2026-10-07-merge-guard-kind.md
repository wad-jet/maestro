---
title: "Merge-guard kind (5.6.1) - deny-сообщение для git merge и kind в логах: строка, не объект"
date: 2026-10-07
type: bugfix
severity: low
scope: plugins/maestro-bootstrap
fixed: true
---

# Merge-guard kind (5.6.1)

## Суть

Дефект 5.6.0 в ветке сообщения/лога merge-guard: при deny `git merge`
команды показывалось «git push (mainline) заблокирован» вместо «git merge
заблокирован» (в ternary сравнивался объект `detected` со строкой
`"merge"` - сравнение всегда false, обе ветки уводились в push-текст); в
лог `merge_guard` записывался объект `"kind":{"kind":"merge"}` вместо
строки `"kind":"merge"`. Класс бага: унаследованный ассерт эншипнил баг -
тест на merge-deny ожидал именно багованный push-текст (ассерт копировал
фактическое поведение, а не требуемый). Поведение гарда (deny) при этом
работало корректно - дефект в тексте сообщения и в форме `kind` в логе,
без влияния на блокировку.

## Сценарии воспроизведения/проверки

- a) `npm test` -> 383/0 (merge-guard.test.js в `scripts.test`)
- b) `node --test plugins/maestro-bootstrap/merge-guard.test.js` -> 30/0
- c) текстовые ассерты обеих веток сообщения: merge-тесты
  `/merge-guard:deny.*git merge/`, push-тест
  `/merge-guard:deny.*git push \(mainline\)/`
- d) `node --check plugins/maestro-bootstrap/core.js`
- e) ручной (новая сессия, плагин 5.6.1): `git merge` без маркера -> deny с
  текстом «git merge заблокирован», в логе `"kind":"merge"` строкой
- f) версии 5.6.1 синхронны: `grep "5.6.1" package.json
  docs/project-context.md AGENTS.md docs/roadmap.md` -> совпадения во всех
  4 файлах

## Изменённые файлы

- `plugins/maestro-bootstrap/core.js` - extract `const kind =
  detected.kind` (строка) для deny-сообщения и лога `merge_guard`
  (`ee98a06`); отступы блока (`de4842f`)
- `plugins/maestro-bootstrap/merge-guard.test.js` - текстовые ассерты обеих
  веток deny-сообщения (merge/push-mainline), починка stale-теста,
  ожидавшего багованный push-текст для merge (`ee98a06`, `49b41be`);
  индентация + лишняя пустая строка в конце файла (`de4842f`, `2b4f728`)
- `manual_docs/overview/changelog.md` - секция 5.6.1
- `regression/entries/2026-10-07-merge-guard-kind.md` - этот entry
- версия 5.6.1: `package.json`, `package-lock.json`,
  `docs/project-context.md`, `AGENTS.md` (~1210 строк), `docs/roadmap.md`
  (Текущая версия)

## Версия

5.6.1 (коммиты ветки `ee98a06`, `de4842f`, `49b41be`, `2b4f728` + этот
docs/bump-коммит)

Спека-файл не создавалась: короткий дизайн auto-ai багфикса (defect-разбор
в сессии, gate-10 контекст — этот entry; прецедент patch-багфикса без
spec-коммита — 5.3.1).
