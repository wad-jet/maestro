---
description: Регрессионный прогон по реестру рисков (regression/, в git) — smoke/full/release/purge
---

# @regression

Прогон регрессии по реестру рисков. Команда standalone — НЕ часть pipeline
шага 15. Дизайн: `docs/regression-flow.md`; секция «Regression Registry» в SKILL.md.

## Триггеры

```
@regression smoke                     # HIGH: active + verified, статусы не меняет
@regression smoke active              # HIGH: только active, статусы не меняет
@regression full                      # всё: active + verified
@regression full active               # всё: только active
@regression full --timeout 300        # глобальный timeout (дефолт 120с)
@regression release                   # ВСЕ verified → released (строгий гейт)
@regression purge [days=30]           # ротация архива (HITL)
@regression purge preview             # только список, ничего не удаляет
```

## Подготовка

1. `REGISTRY_DIR="$(git rev-parse --show-toplevel)/regression"`.
   Если `entries/` отсутствует или пуста → «Регрессия не требуется — нет
   записей», выход без HITL.
2. Если файл повреждён/не парсится → пропустить только его + HITL:
   (a) показать содержимое — (b) исключить.

## Флоу прогона

1. **Агрегация:** прочитать `entries/*.md`, отфильтровать по режиму
   (дефолт — active + verified; суффикс `active` — только active).
2. **Дедупликация по `run:`+`workdir:` (composite key):** одинаковая пара из
   разных entry → один запуск, результат атрибутируется обоим. Разные
   команды на один файл → разные запуски. `path` — локатор, не ключ.
3. **Сводка + HITL:** «Регрессия: N активных, M verified, P модулей под
   риском». Если verified с `last_full_pass` старше 90 дней → строка
   «stale: K» + HITL: (a) переверифицировать — (b) отменить — (c) игнорировать.
   HITL: (a) запустить — (b) отмена.
4. **Исполнение:** для каждого automated-сценария выполнить `run:` в
   `workdir:` под `timeout` (дефолт 120с; `--timeout <сек>` глобально;
   `timeout: <сек>` в сценарии). Результат по exit code; `!=0` → fail +
   capture output; истечение → fail + пометка `timeout`.
5. **Сценарий без `run:`** → HITL: (a) сгенерировать команду по
   `stack-detection.md` — (b) запустить весь suite сервиса
   (TEST_COMMAND/E2E_COMMAND из project-context) — (c) исключить.

## Статус-эффекты (только для `full`)

- Все automated-сценарии записи pass:
  - active → `status: verified`, `last_full_pass: <дата>` (запись остаётся в `entries/`)
  - verified → refresh `last_full_pass`
- Любой сценарий записи fail → **демоция** verified → active,
  `last_full_pass` очищается
- `smoke` статусы НЕ меняет никогда
- Частичный fail → перезапустить только упавшие сценарии; запись в verified
  не переходит
- Fail → HITL: (a) fix → перезапустить — (b) известная issue — (c) отмена
- Отчёт → `.maestro/last-run.md` (per-worktree, перезаписывается)

**Авто-коммит статусов (реестр в git):** каждая статус-мутация коммитится:
`git add regression/entries/<feature>.md && git commit -m "chore(regression): <feature> verified"`
— только конкретный entry-путь, НЕ `git add -A`. При неудачном коммите
(нет git identity и т.п.) → оставить файл dirty + предупредить в отчёте.
История статусов остаётся в VCS.

**Manual-сценарии ([Manual]):** отдельный блок-чеклист в отчёте и HITL
«Проверь вручную: ... (a) проверено — (b) не проверял». НЕ блокируют release.

## Release (строгий гейт)

- **Все** записи в `entries/` со `status: verified` → HITL: список →
  подтверждение → `git mv entries/X.md released/X.md`, `status: released`,
  `released: <дата>` + авто-коммит: `git add regression/released/X.md && git commit -m "chore(regression): release <feature>"`
  (после `git mv` файл уже в `released/`, правило «конкретный путь, не `git add -A`» — см. выше).
- Есть НЕ verified (active) → релиз НЕ выполняется, жёсткий выход с
  подсветкой блокеров: «НЕ verified: <feature> (причина)».
  HITL-«прогнать full» НЕ предлагается. Селективного релиза нет.
- В выводе — предупреждение о неподтверждённых manual-проверках (не блокирует).

## Purge (ротация архива)

- Трогает ТОЛЬКО `released/`. `entries/` не трогается никогда.
- Возраст от поля `released:`, `today - released >= days` (дефолт 30).
- `purge preview` — список по возрасту, без удаления.
- `purge [days]` — показать распределение + список → выбор порога →
  подтверждение → `git rm` + авто-коммит
  (`chore(regression): purge N released-записей`). Удаление необратимо
  (но остаётся в VCS-истории) — HITL обязателен.

## Внешняя отмена вне pipeline

Реестр — обычные файлы в git: `git mv entries/X.md released/X.md` вручную
(документированный ход, статус выставить `cancelled` при необходимости;
закоммитить `regression/released/X.md` + `regression/cancelled-features.md`).
