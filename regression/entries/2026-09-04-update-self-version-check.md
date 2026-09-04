---
version: 1
feature: update-self-version-check
added: 2026-09-04
status: active
risk: MEDIUM
---

# maestro-update.sh: самопроверка устаревания

## Суть

`maestro-update.sh` после шага 2 (read-only, до мутаций) сравнивает своё
содержимое с `maestro-update.sh` целевой версии (`git show`, raw blob) и при
расхождении поднимает HITL-гейт: (a) самообновить + re-exec (env-маркер
`MAESTRO_UPDATE_SELF_UPDATED=1` — guard терминации), (b) продолжить, (c) стоп.
Non-tty при расхождении — `die` (fail-safe). Self-modification → risk MEDIUM.

## Сценарии риска

### 1. Синтаксис

- `path`: `maestro-update.sh`
- `run`: `bash -n maestro-update.sh`
- `workdir`: корень репо
- Ожидание: exit 0.

### 2. Расхождение + самообновление (pre-merge, downgrade-путь)

- `path`: `maestro-update.sh` (шаг 2a)
- `run`: [Manual] scratch (вне репо, запуск КОПИИ скрипта, не файла репо;
  `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` в scratch): локальный скрипт отличается от
  main → гейт; (a) → файл перезаписан целевым, re-exec, обновление
  продолжается, exit 0, остатков `.tmp.$$` нет.
- `workdir`: scratch-каталог (вне репо)

### 3. Identity-путь

- `path`: `maestro-update.sh` (шаг 2a)
- `run`: [Manual] scratch: `--pin <sha фиче-ветки, pushed>` + локальный == пин →
  гейта нет, `info "maestro-update.sh актуален"`. Обязательный повторный прогон
  **post-merge** на main: идентичный → «актуален»; отличающийся → гейт; (a) →
  re-exec → `info "самопроверка пропущена (скрипт только что самообновлён)"`.
- `workdir`: scratch-каталог (вне репо)

### 4. `--pin` с расхождением и guard pre-merge

- `path`: `maestro-update.sh` (шаг 2a)
- `run`: [Manual] scratch: `--pin <sha>` (коммит отличается от локального) →
  гейт с версией пина; (b) → `warn` + продолжение; (c) → `warn` + exit 1.
  Guard: `--pin <фиче-sha>` + намеренно расходящийся локальный → (a) → re-exec
  → `info "самопроверка пропущена..."` (детерминированная проверка I3 pre-merge).
  Пин-коммит БЕЗ `maestro-update.sh` (до 2026-08-30) → `info ... пропущена`,
  локальный файл НЕ тронут (C1: пустого `update-target.sh` не остаётся).
- `workdir`: scratch-каталог (вне репо)

### 5. Non-tty при расхождении

- `path`: `maestro-update.sh` (шаг 2a)
- `run`: [Manual] scratch: `bash maestro-update.sh < /dev/null` при расхождении
  → `die` с URL; файл не тронут.
- `workdir`: scratch-каталог (вне репо)

### 6. Пустой ввод / EOF в гейте

- `path`: `maestro-update.sh` (шаг 2a)
- `run`: [Manual] scratch, реальный tty (`script -q /dev/null bash ...` или
  интерактивно): пустой Enter → `введите a, b или c` (повторный запрос);
  Ctrl-D → `die "ответ не получен — остановлено"`; файл не тронут.
- `workdir`: scratch-каталог (вне репо)

### 7. Тесты плагина (не затронут)

- `path`: `plugins/maestro-bootstrap/index.test.js`
- `run`: `node --test plugins/maestro-bootstrap/index.test.js`
- `workdir`: корень репо
- Ожидание: 173/173 pass.
