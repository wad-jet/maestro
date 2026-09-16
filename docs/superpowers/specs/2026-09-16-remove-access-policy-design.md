# Спека: удаление `access_policy` из maestro.json и логики плагина

- **Дата:** 2026-09-16
- **Ветка:** `feature/remove-access-policy`
- **Категория:** Архитектурная фича (5+ файлов, breaking change конфига, cross-layer: плагин + скиллы + доки + SECURITY)
- **Источник:** Волна P2.1 (ретроспектива `.maestro/feedback-reports`, отчёты 09-09…09-15), TODO п.89, `specs/native-permissions-rebalance.md` (R3/R9)

## 1. Проблема

`access_policy` в `maestro.json` дублирует нативный permission-слой opencode
(`permission.read`/`edit` в `.opencode/opencode.json`), но добавляет систематическое
трение: 24–155 блокировок `read` за сессию на легитимных pipeline-файлах (отчёты
09-09…09-15). Механика:

- плагин перехватывает только `read` (`core.js:1061`), применяется ко **всем**
  сессиям (включая trusted — расхождение с докой «trusted → skip»);
- приоритет «строжайшее побеждает» `deny > ask > allow` (`core.js:759`): ask-глоб
  `*.{md,mdx}` перекрывает allow-паттерны рабочих зон (`.superpowers/sdd/**`,
  `manual_docs/**`, `specs/**`);
- `ask` = выброс ошибки оркестратору (`core.js:1077`), а не диалог с пользователем;
- bash/glob/grep не покрываются (`core.js:1058`) — фактическая защита уже
  обходится через `bash cat`;
- stale-кэш политики до рестарта (HITL-разрешение не действует, отчёт 09-12).

Нативный слой (R1+R4/R2, Этап A уже реализован в `/maestro-setup`) покрывает всё
то же и больше: `read`+`edit`+`glob`+`grep`, deny confidential/секретов, реальный
per-call ask. `specs/native-permissions-rebalance.md` уже предписывает retire
`access_policy` (R3) и переход плагина к роли «sanitizer + observability, zero
enforcement» (R9); блокеры V1/V2 сняты (V1 подтверждён эмпирически в этом репо
— per-agent allow custodian/sanitizer поверх global deny работает в dogfooding,
отчёты 09-02/09-09; V2 не требуется — ask-семантику плагина удаляем целиком,
единственный новый нативный ask — edit `maestro.json`, поведение из сабагентов
оговаривается в §3.3).

## 2. Решение

**Полное удаление access_policy** из `maestro.json` и плагина; защита чувствительных
файлов (`maestro.json`, `.maestro/**`) переносится в **нативный permission-слой**
opencode (read/glob/grep deny + edit ask). Обратная совместимость не соблюдается
(решение HITL).

Оставшиеся функции плагина — **не трогаем**:
- `confidential` (trusted-канал, built-in секреты) — остаётся;
- sanitizer (Ур.1/Ур.2 маскирование) — остаётся;
- audit-лог `confidential.access` — остаётся;
- observability (task-диспатчи, session.error/retry, empty_result) — остаётся.

Отвергнутая альтернатива: R7 (`plugin-version` удалить целиком). Решение —
сохранить `.maestro/plugin-version` с нативным allow-исключением (нужен
`/maestro-version` и confidential-исключение `isPluginMetaFile`).

## 3. Изменения

### 3.1. Плагин `plugins/maestro-bootstrap/core.js`

Удалить:
- `loadAccessPolicy` (~447) — загрузка секции из конфига;
- `resolveFileAccess` (~755) — матчинг deny>ask>allow;
- `globMatch` (~587, используется только `resolveFileAccess` ~766) — мёртвый код
  после удаления; удалить вместе с doc-комментарием (~620);
- блок перехвата `read` в `tool.execute.before` (~1061–1085): `FILE_TOOLS`,
  `resolveFileAccess`, `auditLog.warn("access_policy.blocked")`, `err.accessPolicy`;
- обработку `err?.accessPolicy` в catch (~1130) — остаётся только `err?.confidential`;
- doc-комментарии про access_policy.

НЕ трогать: `confidential`-блок (~1005–1052), sanitizer, observability,
`isPluginMetaFile` (остаётся: confidential-исключение для `.maestro/plugin-version`,
`core.js:1020`).

Также: `plugins/maestro-bootstrap/index.js` — 3 комментария с access_policy
(L9, L38, L56; L38 — fail-open комментарий: переформулировать, access_policy
больше не часть fail-open-постуры).

### 3.2. Плагин `plugins/maestro-bootstrap/index.test.js`

- Удалить тесты (~13–14 шт.): describe «resolveFileAccess» (~617, 6 тестов:
  allow/ask/deny/default), hook-тесты access_policy (~699/706/714, 3), «access_policy
  (ИБ)» (чтение `maestro.json` блокируется, ~1565/1586/1609/1616/1765),
  «access_policy.blocked» (audit-лог + «не дублируется в bootstrap»).
- Обновить импорты: убрать `resolveFileAccess`, `loadAccessPolicy` из `import`.
- Почистить fixtures с access_policy: `loadMaestroConfig`-тест (~459/464, assert
  `access_policy.allow` — убрать assert), confidential-тесты (~1200/1206/1209,
  fixtures содержат access_policy — убрать секцию из fixture).
- Убедиться, что confidential-тесты (trusted-канал, built-in секреты) остались
  и зелёные.

### 3.3. Нативная компенсация (P6)

Канон нативных permissions (`skills/maestro-assistant/SKILL.md` → генерируется
`/maestro-setup` в `.opencode/opencode.json`):

**`read`:**
```
"maestro.json": "deny",
".maestro/**": "deny",
".maestro/plugin-version": "allow"
```
**`edit`:** `"maestro.json": "ask"` (НЕ deny). Нативный `ask` = реальный per-call
HITL: правка конфига легитимными писателями (пайплайн maestro, `/maestro-assistant`,
`/maestro-setup`, sync-правило I3) проходит подтверждение пользователя, а не
блокируется; untrusted-попытка правки конфига — нативный ask: в primary-сессии
это HITL-диалог; из сабагент-сессии — зависит от ask-сёрфасинга runtime (V2):
при отсутствии поддержки — блокировка с ошибкой (fail-closed, защита
сохраняется). `.maestro/**` в edit не трогаем — иначе ломаются штатные записи:
feedback-report — `.maestro/feedback-reports/`, regression — `.maestro/last-run.md`,
memory-report — `.maestro/memory-report-*.html`, логи плагина. Асимметрия
read vs glob/grep (allow-исключение `.maestro/plugin-version` только в read)
намеренна: штатным флоу glob/grep по `.maestro/**` не нужны (логи читаются
bash).

**`glob` / `grep`:** `"maestro.json": "deny"`, `".maestro/**": "deny"` (паритет
модели confidential, где покрыты read+edit+bash+glob+grep; иначе grep-тул,
возвращающий содержимое строк, обходит read-deny).

**`bash`:** опциональный 2-й эшелон `*cat*maestro.json*` по аналогии с
`*cat*confidential*` — решение HITL, в канон по умолчанию не включается
(residual risk фиксируется в SECURITY P6).

Порядок важен (last-match-wins): catch-all `"*": "allow"` первым, deny/ask раньше,
allow `.maestro/plugin-version` после deny. Применить в этом репо
`.opencode/opencode.json`.

**Последствия (чтение):**
- `/maestro-version` — работает (allow-исключение `.maestro/plugin-version`);
- untrusted-сабагенты не прочтут `maestro.json` и `.maestro/**` через `read`/`grep`/`glob`;
- **residual risk (I2):** bash `cat` остаётся доступен untrusted (паритет со старым
  access_policy). Фиксируется в SECURITY.md P6; опционально — bash-deny 2-го эшелона.

**Последствия (primary-потоки, C2):** глобальный deny действует и на primary.
Сегодня эти чтения и так блокируются плагином (ask) и обходятся через bash.
После фичи они блокируются нативно — обход через bash сохраняется. Чтобы не
оставлять error-retry цикл в командах с явным «через read»: команды/скиллы,
читающие `maestro.json`/`.maestro/**`, переводятся на явное bash-чтение (§3.5).

### 3.4. `maestro.json` (этот репо + канон)

Удалить секцию `access_policy` целиком. Итоговая структура (этот репо):
`trust`, `confidential`, `sanitizer_whitelist`, `memory`.

**Порядок применения (I6):** сначала §3.4 (удалить секцию из `maestro.json`),
затем §3.3 (нативный слой) — иначе реализатор заблокирует себе edit `maestro.json`
(нативный `edit ask` промптит до подтверждения).

### 3.5. Скиллы / команды / агенты

- `skills/maestro-assistant/SKILL.md`: убрать секцию `access_policy` из JSON-канона,
  правила вывода (`access_policy.allow`/`deny`), OP-4 (deny→allow); sync-правило I3
  остаётся (confidential.paths ↔ нативные deny) — правка maestro.json проходит
  нативный `edit ask`; обновить семантику секций; обновить канон нативных
  permissions (§3.3 правила); **чтение текущего `maestro.json` при консультации —
  через bash**.
- `skills/maestro-setup/SKILL.md` + `init-context.md`: убрать генерацию
  `access_policy`; добавить генерацию нативных правил §3.3 (read/glob/grep deny +
  edit ask + allow plugin-version); **чтение текущего конфига на существующем
  проекте (сравнение секций) — через bash**.
- `skills/maestro/SKILL.md` (~11 живых упоминаний access_policy: L23, 396, 964,
  1323–1334, 1343–1366, 1459, 1544–1556; плюс пласт «File access control»: L803,
  831, 870, 924 — гейт, L1210/1217 — таблица слоёв, L1559, L1580, L1705, L1950):
  убрать access_policy и «File access control»-гейт, переписать под нативный deny;
  шаг 0 — чтение `maestro.json` через bash (явная инструкция); HITL-опции
  «обновить конфиг и перезапустить» — проходят нативный `edit ask`.
- `skills/maestro/invariants.md` L34 (инвариант «read-блоки access_policy»):
  **правка — только явное HITL-решение** (правило AGENTS.md); предложение замены:
  «read-блоки нативного permission-слоя». Формулировка утверждается HITL.
- `skills/maestro-feedback-report/SKILL.md`: убрать `access_policy.blocked` из шага
  3b и шаблона отчёта; **добавить явные bash-инструкции** чтения логов
  (`.maestro/logs/*`) и maestro.json (L15/23/77/92/99 — «прочитай через bash`),
  запись отчёта — через write (edit-правил на `.maestro/**` нет, запись работает).
- `skills/maestro-design/SKILL.md`: убрать упоминания; чтение maestro.json/
  `.maestro/last-run.md` — через bash.
- `commands/maestro-design.md` L10–13 (проверка признаков init: project-context,
  maestro.json, `.maestro/last-run.md`): чтение — через bash.
- `agents/sanitizer.md`: убрать роль «генерирует/поддерживает секцию access_policy».
- `commands/maestro-setup.md`, `commands/maestro-assistant.md`,
  `commands/maestro-feedback-report.md` (L29), `commands/maestro-memory.md`,
  `commands/maestro-memory-report.md`: убрать упоминания; чтение
  maestro.json/.maestro — через bash (grep-driven: искать «через read»/«Прочитай»,
  не по номерам строк).
- `maestro-sandbox.sh` (L256–257: сценарий «секрет вне built-in закрывается через
  confidential.paths/**access_policy.deny**»): заменить опору на **confidential.paths**
  (I3-sync остаётся, сценарий конфиг-управляемый); убрать прочие упоминания.
- `.sandbox/maestro.json`: убрать access_policy.
- `README.md` (корневой): убрать access_policy из перечня.
- `AGENTS.md` (L51 «access-policy blocks»): убрать упоминание.
- `docs/testing/maestro-sandbox-checklist.md` (L41): убрать/заменить.

### 3.6. Документация

- `SECURITY.md`: переписать **P6** — maestro.json защищается нативно (read/glob/grep
  deny + edit ask в `.opencode/opencode.json`), не плагином; зафиксировать residual
  risk (bash `cat` паритет) и tamper-вопрос I3 (`.opencode/opencode.json`
  редактируем untrusted — parity с текущим); убрать access_policy из контрмер (§4),
  обновить fail-open-постуру (§5), убрать access_policy из перечня enforcement-слоёв.
- `manual_docs/reference/config.md`: удалить секцию access_policy, «Разрешение
  конфликтов», упоминания в лог-таблице (`access_policy.blocked`), строку
  «маэстро.json остаётся за access_policy» (L40).
- `manual_docs/explanation/agents-and-trust.md`: переписать таблицу trust (убрать
  «skip access_policy»), убрать «trusted → skip», роль sanitizer «генерирует
  access_policy», P6-блок, пласт «File access control» (L44/49/115).
- `manual_docs/reference/hitl-gates.md` L92 (гейт «File access control»):
  переписать под нативный deny (нет (a)/(b)-флоу через плагин; ask — нативный
  per-call).
- `manual_docs/tutorials/setup-project.md`, `manual_docs/reference/commands.md`,
  `manual_docs/overview/changelog.md`: убрать упоминания; changelog — запись о фиче
  + миграционная заметка («после обновления перезапустите `/maestro-setup`»).
- `docs/project-context.md` (упоминания L22, L75, L187, §12): убрать access_policy.
- `plugins/maestro-bootstrap/README.md` (~15 упоминаний: «File access control»,
  JSON-канон, лог-таблица `access_policy.blocked`): убрать.
- **Аудит парафразов «File access control»/«контроль доступа»:** после правок
  прогнать grep по `skills/`, `commands/`, `agents/`, `manual_docs/`, `SECURITY.md`
  и переписать все оставшиеся описания под нативный deny (наряду с AC2).

### 3.7. `specs/*` и исторические файлы

НЕ трогаем (исторический архив; AGENTS.md запрещает новые файлы в `specs/`).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (176 − ~14
   удалённых тестов; confidential/sanitizer-тесты не пострадали).
2. `grep -rn "access_policy"` по живым файлам — 0 вхождений в: плагине
   (`plugins/maestro-bootstrap/` кроме `specs/`-истории), скиллах (`skills/`),
   командах (`commands/`), агентах (`agents/`), `manual_docs/` (кроме
   исторических changelog-записей — они остаются), `SECURITY.md`, `maestro.json`,
   `README.md`, `AGENTS.md`, `docs/` (кроме `docs/superpowers/` исторических
   спеков/планов), `maestro-sandbox.sh`,
   `.sandbox/maestro.json`. Исключения: `specs/`, `docs/superpowers/`
   (исторические спеки/планы), `regression/entries/`, `TODO.md`, `.maestro/`,
   `.opencode/`.
   Второй паттерн: `grep -rnE "File access control|контрол[ьяе] доступа"` по тем же
   путям — 0 живых вхождений, кроме changelog-истории.
3. В `.opencode/opencode.json` (этот репо): read/glob/grep-deny
   `maestro.json`/`.maestro/**` + read-allow `.maestro/plugin-version`; edit
   `maestro.json: "ask"`.
4. `/maestro-version` после рестарта читает `.maestro/plugin-version` (allow).
5. Read `maestro.json` через `read`-тул блокируется нативно (deny); grep-тул по
   `maestro.json`/`.maestro/**` тоже блокируется.
6. `maestro.json` в этом репо без секции `access_policy`.
7. Changelog + manual_docs синхронизированы (AGENTS.md sync-правило), включая
   миграционную заметку `/maestro-setup`.
8. Штатные флоу не сломаны: `/maestro-feedback-report` пишет отчёт в
   `.maestro/feedback-reports/`, `@regression` — `.maestro/last-run.md`,
   `/maestro-memory-report` — `.maestro/memory-report-*.html` (запись через
   write/edit работает); правка `maestro.json` через `/maestro-assistant` /
   пайплайн / `/maestro-setup` проходит нативный `edit ask`-гейт (HITL);
   init-проверки `/maestro-design` и `/maestro-setup` на существующем проекте не
   падают на чтении конфига (bash).
9. Диспатч untrusted-сабагента с правкой `maestro.json` (edit) → ожидание
   ask-HITL **или** deny/error (fail-closed); НЕ auto-allow. (Проверка
   untrusted-edit пути, I-1.)

## 5. Regression

- Секция `access_policy` удаляется из конфига — **breaking change** конфигурации
  maestro. **Migration path (честно, C-2):** существующие проекты: confidential/
  секреты уже защищены Этапом A (`docs/confidential/*`, `*.env`, `*.pem`… — канон
  L307–318); `maestro.json`/`.maestro/**` — **без read-защиты до перезапуска
  `/maestro-setup` (task 3) или ручной правки `.opencode/opencode.json`**
  (скиллы и плагин доставляются раздельно — окно не ограничено). Мера:
  миграционная заметка в changelog + setup-project.md («после обновления
  перезапустите /maestro-setup»). **Кастомные правила `access_policy` сверх
  канона (I-2)** (deny на internal-доки, кастомные allow и т.п.) **не
  переносятся автоматически** — перенести вручную в нативные permissions
  `.opencode/opencode.json` (deny → read/glob/grep deny); дефолтные ask-зоны
  (docs/specs/manual_docs/config) теряются осознанно (цель фичи). Regression
  entry: **HIGH** (для пункта maestro.json/.maestro) + MEDIUM (для удаления
  секции).
- Плагин перестаёт блокировать `read` — поведение для untrusted становится
  fail-open по умолчанию для не-deny путей; компенсируется нативным deny
  (`maestro.json`, `.maestro/**`, confidential/секреты).
- **Известный tamper-вопрос (I3):** `.opencode/opencode.json` — единственный
  P6-слой после удаления — редактируем untrusted (edit `"*": "allow"`). Parity с
  текущим (maestro.json так же редактируем), фиксируется в SECURITY.md §5;
  отдельное усиление (edit-deny `.opencode/**`) — вне scope, follow-up.
- **Локальные зеркала `.opencode/skills/*`** после правок `skills/` устареют —
  регенерация/пере-установка для локальной разработки (заметка в changelog).
<!-- maestro:sanitize
status: CLEAN
date: 2026-09-16
hash: 2a40b2a80b001d65d6db54a190984f26a62eab8bb8fbe7cf0ab30a0fac992aca
-->
<!-- maestro:review
reviewer: opus
date: 2026-09-16
verdict: approve
hash: 2a40b2a80b001d65d6db54a190984f26a62eab8bb8fbe7cf0ab30a0fac992aca
-->
