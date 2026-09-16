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
то же и больше: `read`+`edit`, deny confidential/секретов, реальный per-call ask.
`specs/native-permissions-rebalance.md` уже предписывает retire `access_policy`
(R3) и переход плагина к роли «sanitizer + observability, zero enforcement» (R9);
блокеры V1/V2 сняты (V1 подтверждён эмпирически в этом репо, V2 не требуется —
ask-семантику удаляем целиком).

## 2. Решение

**Полное удаление access_policy** из `maestro.json` и плагина; защита чувствительных
файлов (`maestro.json`, `.maestro/**`) переносится в **нативный deny** opencode.
Обратная совместимость не соблюдается (решение HITL).

Оставшиеся функции плагина — **не трогаем**:
- `confidential` (trusted-канал, built-in секреты) — остаётся;
- sanitizer (Ур.1/Ур.2 маскирование) — остаётся;
- audit-лог `confidential.access` — остаётся;
- observability (task-диспатчи, session.error/retry, empty_result) — остаётся.

## 3. Изменения

### 3.1. Плагин `plugins/maestro-bootstrap/core.js`

Удалить:
- `loadAccessPolicy` (~447) — загрузка секции из конфига;
- `resolveFileAccess` (~755) — матчинг deny>ask>allow;
- блок перехвата `read` в `tool.execute.before` (~1061–1085): `FILE_TOOLS`,
  `resolveFileAccess`, `auditLog.warn("access_policy.blocked")`, `err.accessPolicy`;
- обработку `err?.accessPolicy` в catch (~1130) — остаётся только `err?.confidential`;
- doc-комментарии про access_policy.

НЕ трогать: `confidential`-блок (~1005–1052), sanitizer, observability,
`isPluginMetaFile` (остаётся для `.maestro/plugin-version`).

### 3.2. Плагин `plugins/maestro-bootstrap/index.test.js`

- Удалить тесты: `resolveFileAccess` (allow/ask/deny/default), policy-матчинг,
  `access_policy (ИБ)` (чтение `maestro.json` блокируется), `access_policy.blocked`
  (audit-лог), «не дублируется в bootstrap».
- Обновить импорты (`resolveFileAccess`, `loadAccessPolicy` убрать из `import`).
- Убедиться, что confidential-тесты (trusted-канал, built-in секреты) остались.

### 3.3. Нативная компенсация (P6)

Канон нативных permissions (`skills/maestro-assistant/SKILL.md` → генерируется
`/maestro-setup` в `.opencode/opencode.json`), секции `read` и `edit`:

```
"maestro.json": "deny",
".maestro/*": "deny",
".maestro/plugin-version": "allow"
```

Порядок важен (last-match-wins): deny раньше, allow `.maestro/plugin-version`
после — чтобы `/maestro-version` (читает через `read`) продолжал работать.
Применить в этом репо `.opencode/opencode.json`.

Последствия:
- `/maestro-version` — работает (allow-исключение plugin-version);
- feedback-report читает `.maestro/logs/*` — остаётся на **bash** (штатный паттерн
  репо, зафиксировать в доке);
- untrusted-сабагенты не прочтут `maestro.json` (sanitizer_whitelist.patterns,
  confidential-конфиг) и `.maestro/**` (логи/отчёты) через `read`.

### 3.4. `maestro.json` (этот репо + канон)

Удалить секцию `access_policy` целиком. Итоговая структура: `trust`,
`confidential`, `sanitizer_whitelist`, `memory`.

### 3.5. Скиллы / команды / агенты

- `skills/maestro-assistant/SKILL.md`: убрать секцию `access_policy` из JSON-канона,
  правила вывода (`access_policy.allow`/`deny`), OP-4 (deny→allow), sync-правило I3
  (остаётся только confidential.paths ↔ нативные deny); обновить семантику секций.
- `skills/maestro-setup/SKILL.md` + `init-context.md`: убрать генерацию
  `access_policy`; добавить генерацию нативных deny `maestro.json`/`.maestro/**`
  (+ allow plugin-version).
- `skills/maestro-feedback-report/SKILL.md`: убрать `access_policy.blocked` из шага
  3b и шаблона отчёта.
- `skills/maestro-design/SKILL.md`: убрать упоминания.
- `agents/sanitizer.md`: убрать роль «генерирует/поддерживает секцию access_policy».
- `commands/maestro-setup.md`, `commands/maestro-assistant.md`: убрать упоминания.
- `maestro-sandbox.sh`, `.sandbox/maestro.json`: убрать access_policy.
- `README.md`: убрать access_policy из перечня.

### 3.6. Документация

- `SECURITY.md`: переписать **P6** — maestro.json защищается нативно (deny в
  `.opencode/opencode.json`), не плагином; убрать access_policy из контрмер (§4),
  обновить fail-open-постуру (§5), убрать access_policy из перечня enforcement-слоёв.
- `manual_docs/reference/config.md`: удалить секцию access_policy, «Разрешение
  конфликтов», упоминания в лог-таблице (`access_policy.blocked`), строку
  «маэстро.json остаётся за access_policy».
- `manual_docs/explanation/agents-and-trust.md`: переписать таблицу trust (убрать
  «skip access_policy»), убрать «trusted → skip», роль sanitizer «генерирует
  access_policy», P6-блок.
- `manual_docs/tutorials/setup-project.md`, `manual_docs/reference/commands.md`,
  `manual_docs/overview/changelog.md`: убрать упоминания; changelog — запись о фиче.
- `docs/project-context.md` §12: убрать access_policy.

### 3.7. `specs/*` и исторические файлы

НЕ трогаем (исторический архив; AGENTS.md запрещает новые файлы в `specs/`).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (176 − ~10
   удалённых тестов; confidential/sanitizer-тесты не пострадали).
2. `grep -rn "access_policy"` по живым файлам (не `specs/`, не `.maestro/`, не
   `.opencode/`, не исторические changelog) — 0 вхождений в плагине, скиллах,
   manual_docs, SECURITY.md, maestro.json, README.
3. В `.opencode/opencode.json` — deny `maestro.json`/`.maestro/*` + allow
   `.maestro/plugin-version` в `read`/`edit` (этот репо).
4. `/maestro-version` после рестарта читает `.maestro/plugin-version` (allow).
5. Read `maestro.json` через `read`-тул блокируется нативно (deny).
6. `maestro.json` в этом репо без секции `access_policy`.
7. Changelog + manual_docs синхронизированы (AGENTS.md sync-правило).

## 5. Regression

- Секция `access_policy` удаляется из конфига — **breaking change** конфигурации
  maestro (существующие проекты: плагин просто перестаёт читать секцию; нативный
  deny уже настроен Этапом A). Regression entry: MEDIUM.
- Плагин перестаёт блокировать `read` — поведение для untrusted становится
  fail-open по умолчанию для не-deny путей; компенсируется нативным deny.