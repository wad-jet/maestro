# Implementation Plan: самопроверка устаревания maestro-update.sh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `maestro-update.sh` при запуске (read-only, до мутаций) сравнивает собственное содержимое с целевой версией и при расхождении предлагает HITL-гейт: самообновить + re-exec / продолжить / стоп.

**Architecture:** Новый шаг 2a между существующими шагами 2 (fetch целевого источника в `$TMP_DIR`) и 3 (merge-add). Извлечение целевого скрипта — единый `git show` (raw blob, без autocrlf) с обработкой кода возврата; сравнение — `cmp -s` в `case` (0/1/2); самообновление — temp+`mv`, `rm -rf "$TMP_DIR"`, `exec env MAESTRO_UPDATE_SELF_UPDATED=1` (guard терминации). Без доп. сетевых вызовов, без версионных констант.

**Tech Stack:** bash 3.2+ (macOS), `set -euo pipefail`, git, cmp; без python (проверка — bash-only).

**Spec:** `docs/superpowers/specs/2026-09-04-update-self-version-check-design.md`

## Global Constraints

- bash 3.2+ (macOS); скрипт работает под `set -euo pipefail` — все команды, которые могут вернуть ненулевой код, — в `if`/`||`/`case`.
- Конвенция вывода: только `say`/`info`/`warn`/`die`; сообщения на русском.
- Новые флаги не добавляются (YAGNI, spec решение 5).
- Шаги 1, 3, 3a, 4, 5, 6 `maestro-update.sh` не меняются.
- `maestro-install.sh` не затрагивается (spec решение 7).
- Запуск по scratch-копии скрипта, НЕ по файлу из working tree репо (self-modification затрёт непоммиченные правки).
- Scratch-прогоны изолируются: `XDG_CONFIG_HOME="$S/xdg" XDG_CACHE_HOME="$S/xdg-cache"` (иначе шаг 4 чистит реальный глобальный кэш плагина, шаг 5 может затронуть глобальный конфиг).
- Тесты плагина: `node --test plugins/maestro-bootstrap/index.test.js` (173/173) — sanity после каждого кодового коммита.

---

### Task 1: Шаг 2a в `maestro-update.sh`

**Files:**
- Modify: `maestro-update.sh` (после строки 20 — константы; после строки 79 — шаг 2a)

**Interfaces:**
- Consumes: `$TMP_DIR` (mktemp + trap, строка 19), `$PIN` (парсинг флагов), `$TARGET_VERSION` (шаг 2), хелперы `info/warn/die/say`, `$REPO_URL`.
- Produces: `SCRIPT_PATH`, `ORIG_ARGS` (используются только внутри шага 2a); env-маркер `MAESTRO_UPDATE_SELF_UPDATED=1` (читается самим же скриптом в re-exec).

- [ ] **Step 1: добавить константы самопроверки (после строки 20, до `say()`)**

В `maestro-update.sh`, после блока:

```bash
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t maestro-update)"
trap 'rm -rf "$TMP_DIR"' EXIT
```

вставить:

```bash
SCRIPT_PATH="${BASH_SOURCE[0]}"
ORIG_ARGS=("$@")   # сохранить до парсинга флагов — для re-exec после самообновления
```

- [ ] **Step 2: вставить шаг 2a (после `info "целевая версия: $TARGET_VERSION"`, до комментария `# --- 3. Merge-add`)**

```bash
# --- 2a. Самопроверка версии скрипта -----------------------------------------

if [ "${MAESTRO_UPDATE_SELF_UPDATED:-}" != "1" ]; then
  info "проверяю актуальность maestro-update.sh..."
  TARGET_SCRIPT="$TMP_DIR/update-target.sh"
  git_show_ok=1
  if [[ -n "$PIN" ]]; then
    git -C "$TMP_DIR" show "$PIN:maestro-update.sh" > "$TARGET_SCRIPT" 2>/dev/null || git_show_ok=0
  else
    git -C "$TMP_DIR" show "HEAD:maestro-update.sh" > "$TARGET_SCRIPT" 2>/dev/null || git_show_ok=0
  fi
  if [ "$git_show_ok" -eq 0 ] || [ ! -s "$TARGET_SCRIPT" ]; then
    rm -f "$TARGET_SCRIPT"
    info "maestro-update.sh отсутствует в целевой версии — самопроверка пропущена"
  else
    cmp_rc=0
    cmp -s "$SCRIPT_PATH" "$TARGET_SCRIPT" || cmp_rc=$?
    case "$cmp_rc" in
      0)
        info "maestro-update.sh актуален"
        ;;
      2)
        warn "нечитаемый файл для сравнения — самопроверка пропущена"
        ;;
      *)
        if [ ! -t 0 ]; then
          die "самобновление недоступно в неинтерактивном режиме; обновите вручную: $REPO_URL (maestro-update.sh) и повторите"
        fi
        say ""
        say "[maestro-update] maestro-update.sh отличается от целевой версии ($TARGET_VERSION)."
        say "  (a) Самообновить скрипт и перезапустить (рекомендую)"
        say "  (b) Продолжить текущим скриптом"
        say "  (c) Стоп"
        while :; do
          printf '[maestro-update] выбор (a/b/c): '
          read -r choice || die "ответ не получен — остановлено"
          case "$choice" in
            a|b|c) break ;;
            *) info "введите a, b или c" ;;
          esac
        done
        case "$choice" in
          a)
            SELF_TMP="$SCRIPT_PATH.tmp.$$"
            if ! cp "$TARGET_SCRIPT" "$SELF_TMP"; then
              rm -f "$SELF_TMP"
              die "не удалось записать новый maestro-update.sh ($SCRIPT_PATH не writable?)"
            fi
            if ! mv "$SELF_TMP" "$SCRIPT_PATH"; then
              rm -f "$SELF_TMP"
              die "не удалось заменить maestro-update.sh"
            fi
            rm -rf "$TMP_DIR"
            exec env MAESTRO_UPDATE_SELF_UPDATED=1 bash "$SCRIPT_PATH" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
            ;;
          b)
            warn "продолжаю текущим maestro-update.sh (расхождение не устранено)"
            ;;
          c)
            warn "останавливаюсь (выбор пользователя)"
            exit 1
            ;;
        esac
        ;;
    esac
  fi
fi
```

- [ ] **Step 3: синтаксис**

Run: `bash -n maestro-update.sh`
Expected: exit 0.

- [ ] **Step 4: scratch-среда (один раз)**

```bash
S=$(mktemp -d) && cd "$S"
cp <repo>/maestro-update.sh .
cp <repo>/maestro-install/agpack.yml agpack.yml
echo '{"name":"scratch","version":"1.0.0"}' > package.json
mkdir -p .opencode && echo '{}' > .opencode/opencode.json
mkdir -p xdg xdg-cache
```

(`<repo>` — корень авторского репо; все дальнейшие прогоны — в `$S` с
`XDG_CONFIG_HOME="$S/xdg" XDG_CACHE_HOME="$S/xdg-cache"`.)

- [ ] **Step 5: сценарий identity — нет гейта**

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-update.sh -o "$S/maestro-update.sh"
cd "$S" && XDG_CONFIG_HOME="$S/xdg" XDG_CACHE_HOME="$S/xdg-cache" bash maestro-update.sh < /dev/null
```

Expected: в выводе `maestro-update.sh актуален`, гейт не показан, exit 0,
обновление продолжается до «Готово». (pre-merge: main-скрипт == локальный).

- [ ] **Step 6: сценарий non-tty при расхождении — die, файл не тронут**

```bash
cd "$S" && cp maestro-update.sh maestro-update.sh.bak
echo "# local edit" >> maestro-update.sh
XDG_CONFIG_HOME="$S/xdg" XDG_CACHE_HOME="$S/xdg-cache" bash maestro-update.sh < /dev/null; echo "exit=$?"
diff maestro-update.sh maestro-update.sh.bak && echo "FILE UNTOUCHED"
```

Expected: `ОШИБКА: самобновление недоступно в неинтерактивном режиме...`,
`exit=1`, `FILE UNTOUCHED`.

- [ ] **Step 7: сценарий (a) — самообновление + re-exec (tty, интерактивно)**

```bash
cd "$S" && echo "# local edit" >> maestro-update.sh
XDG_CONFIG_HOME="$S/xdg" XDG_CACHE_HOME="$S/xdg-cache" bash maestro-update.sh
```

Expected: гейт показан с версией; ввод `a` → файл перезаписан, re-exec
(выйдет повторный блок «Готово»), exit 0; после прогона:
`curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-update.sh | diff - maestro-update.sh`
→ идентичен main (pre-merge это downgrade-путь: main ещё без self-check).
Остатков `maestro-update.sh.tmp.*` в `$S` нет.

- [ ] **Step 8: сценарии (b) и (c), невалидный ввод**

Повторно добавить `# local edit 2` в `$S/maestro-update.sh`, запустить в tty:
- ввод `x` → `введите a, b или c`, повторный запрос;
- ввод `b` → `ВНИМАНИЕ: продолжаю текущим maestro-update.sh (расхождение не устранено)`,
  обновление продолжается до «Готово», exit 0;
- новый прогон: ввод `c` → `останавливаюсь (выбор пользователя)`, exit 1.

- [ ] **Step 9: EOF в гейте**

[Manual] tty (интерактивно или `script -q /dev/null bash maestro-update.sh`):
в гейте — Ctrl-D → `ОШИБКА: ответ не получен — остановлено`, exit 1, файл не тронут.

- [ ] **Step 10: сценарии `--pin` (после push ветки в origin)**

[Manual] `FEATURE_SHA=$(git rev-parse HEAD)` (после `git push origin feature/...`):
- `--pin $FEATURE_SHA` + локальный скрипт == скрипт пина → `актуален`, гейта нет.
- `--pin $FEATURE_SHA` + `echo "# diff" >> maestro-update.sh` → гейт; ввод `a`
  → re-exec нового скрипта → в выводе `самопроверка пропущена (скрипт только
  что самообновлён)` (guard), обновление продолжается (pre-merge проверка I3).
- `--pin <sha до 2026-08-30>` (коммит без `maestro-update.sh`, напр.
  `$(git rev-list --max-parents=0 origin/main | tail -1)`) →
  `maestro-update.sh отсутствует в целевой версии — самопроверка пропущена`,
  локальный файл не тронут, `update-target.sh` пустым не остаётся.

- [ ] **Step 11: тесты плагина (sanity)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: 173/173 pass.

- [ ] **Step 12: commit**

```bash
git add maestro-update.sh
git commit -m "feat(update): самопроверка версии maestro-update.sh (content-diff + HITL-гейт)"
```

---

### Task 2: Regression entry

**Files:**
- Create: `regression/entries/2026-09-04-update-self-version-check.md`

**Interfaces:**
- Consumes: Task 1 (поведение для сценариев); формат — `regression/entries/2026-09-04-install-agpack-canon.md`.

- [ ] **Step 1: создать entry**

Содержимое (полностью):

````markdown
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
````

- [ ] **Step 2: commit**

```bash
git add regression/entries/2026-09-04-update-self-version-check.md
git commit -m "docs(regression): entry update-self-version-check"
```

---

### Task 3: Синхронизация документации

**Files:**
- Modify: `manual_docs/how-to/update-maestro.md` (секция после примечания «Скрипт уже загружен…», строки ~52–57)
- Modify: `manual_docs/overview/changelog.md` (секция `[2026-09-04]`)
- Modify: `README.md` (секция «Обновление maestro», строки ~88–91)

**Interfaces:**
- Consumes: Task 1 (фактическое поведение: сообщения, варианты гейта).

- [ ] **Step 1: `manual_docs/how-to/update-maestro.md`**

После блока «> Скрипт `maestro-update.sh` уже загружен в проект при первичной
установке…curl…» (строки ~52–57) вставить секцию:

```markdown
### Самопроверка версии скрипта

`maestro-update.sh` при запуске (до любых изменений) сравнивает собственное
содержимое со скриптом целевой версии (через `git show` из уже полученного
источника — без доп. сетевых вызовов). Сравнивается **содержимое**, не
семантическая версия: при `--pin` — со скриптом закреплённого коммита.

При расхождении:

```
[maestro-update] maestro-update.sh отличается от целевой версии (X.Y.Z).
  (a) Самообновить скрипт и перезапустить (рекомендую)
  (b) Продолжить текущим скриптом
  (c) Стоп
```

- **(a)** перезаписывает локальный скрипт содержимым целевой версии и
  перезапускает его (с теми же аргументами); повторный показ гейта в том же
  запуске исключён (маркер `MAESTRO_UPDATE_SELF_UPDATED`).
- Пустой/невалидный ввод — повторный запрос; Ctrl-D (EOF) — останов.
- **Неинтерактивный режим** (stdin не tty) при расхождении — ошибка с
  инструкцией обновить скрипт вручную; молчаливых самообновлений нет.
- Запуск по symlink: самообновление заменяет symlink, а не его цель.
```

И актуализировать само примечание: в последнюю его строку добавить:
«скрипт при каждом запуске сам проверяет собственную актуальность (см.
«Самопроверка версии скрипта» ниже).»

- [ ] **Step 2: `README.md`**

В bullet «**Рекомендуемый способ — `maestro-update.sh`:**» (строки ~88–90)
добавить в конец: «перед обновлением скрипт сам проверяет собственную
актуальность и при расхождении предлагает самообновиться (интерактивно).»

- [ ] **Step 3: `manual_docs/overview/changelog.md`**

В секцию `## [2026-09-04]` (после записи про install-agpack-canon) добавить:

```markdown
- **`maestro-update.sh`: самопроверка устаревания.** При запуске (до мутаций)
  скрипт сравнивает собственное содержимое со скриптом целевой версии
  (`git show` из уже полученного источника; при `--pin` — пин-коммита).
  Расхождение → HITL-гейт: (a) самообновить и перезапустить (атомарно,
  env-маркер против повторного цикла), (b) продолжить текущим, (c) стоп.
  Non-tty при расхождении — ошибка с инструкцией (fail-safe).
```

- [ ] **Step 4: проверочный grep (нет противоречий)**

Run: `rg -n 'самообновл|самопроверк' README.md manual_docs/ regression/entries/2026-09-04-update-self-version-check.md`
Expected: упоминания согласованы с фактическими сообщениями скрипта из Task 1.

- [ ] **Step 5: commit**

```bash
git add manual_docs/how-to/update-maestro.md manual_docs/overview/changelog.md README.md
git commit -m "docs: sync update-maestro/README/changelog for script self-check"
```
