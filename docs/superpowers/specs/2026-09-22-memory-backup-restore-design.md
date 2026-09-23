# Spec: Backup/Restore данных memory layer (v1, sqlite)

**Дата:** 2026-09-22
**Ветка:** `feature/memory-backup-restore`
**Версия:** 4.6.1 → 4.7.0 (minor)
**Основание:** TODO #101 + роадмап Волна 1 (`docs/roadmap.md`) + ИБ-гейты C3;
доп. анализ дизайна — opus (2026-09-22, вердикт Revise → учтено: tool-вход обязателен).

## 1. Контекст и проблема

Memory layer хранит командное знание проекта (одна запись на сессию: summary,
decisions, artifacts[]) в sqlite (default-бэкенд). Сегодня:

- Потеря данных (повреждение/удаление файла БД, смена машины) необратима.
- `memory_export` выгружает JSONL, но: путь задаёт пользователь, нет retention,
  нет naming-конвенции, нет gitignore-warn, **не делает повторной маскировки**
  (записи маскируются на момент записи в БД — расширение `confidential.paths`
  постфактум не отражается в экспорте).
- `memory_import` умеет восстанавливать (атомарная валидация + `maskEntry`),
  но нет UX-обёртки и управляемого каталога бэкапов.

## 2. Цели / Non-goals

**Цели (v1, sqlite-only):**
1. Детерминированный бэкап в управляемый каталог (конфиг `memory.backup`),
   double-masking по текущему confidential-набору.
2. Восстановление: merge-upsert (дефолт) и replace (аварийный, двойной гейт).
3. Аварийный канал без opencode: CLI (ручной запуск пользователем).
4. Гигиена: retention, gitignore-warn, манифест, docs «только приватные репо».

**Non-goals (v1):** бэкап qdrant/pgvector (guard «sqlite-only» с понятной ошибкой);
авто-бэкап/периодичность; физическая копия `.db` (запрещена: нет re-mask,
WAL-состояние); кросс-проектный restore.

## 3. Артефакты

| Артефакт | Роль |
|---|---|
| `plugins/maestro-bootstrap/memory/backup.js` | вся логика: чистые функции `runBackup`/`runRestore`/`listBackups` с инжектируемыми storage/конфигом; **без side-effects при импорте**; переиспользует `loadMemoryConfig`/`resolveEffectiveKey` (config.js), storage-слой, `maskEntry` |
| Tool `memory_backup` | `action: backup \| restore \| list`; **permission `ask`** (обязательное правило: новые write/boundary-tools → ask в merge-config); штатный путь, нативный HITL-гейт на операцию |
| CLI (ESM-обёртка `plugins/maestro-bootstrap/memory/backup-cli.js`) | тонкая, **без side-effects**, для ручного аварийного запуска вне opencode: `node <module_dir>/memory/backup-cli.js backup \| restore [--replace] \| list` |
| Команда `@maestro-memory-backup` | markdown, тонкая обёртка над **tool**: `list` → HITL-выбор → `backup`/`restore`; bash-вызов CLI в команде — **только показ инструкции** пользователю для ручного аварийного запуска (операцию через bash команда не исполняет) |

Паттерн — `memory_prune` (tool `action: list|delete` + команда). Прецедент
«команда без tool» не создаётся.

## 4. Формат бэкапа

- **Логический JSONL, полная схема v3** — field-list **= `SCAN_FIELDS`**
  (урок v5.2 F1/F3: экспорты, терявшие поля схемы, уже были) + тест на
  полноту полей.
- **Манифест** — отдельный файл `<name>.manifest.json` рядом с JSONL:
  `plugin_version`, `schema_fields[]`, `model_id`, `dim`, `key`/`namespace`,
  `ts`, `count`, `sha256` JSONL-тела, `storage.type`. JSONL-тело — чистый
  JSONL схемы v3 (совместим с `memory_import`); retention-паттерн
  `backup-<namespace>-*` покрывает **оба** файла пары (без orphan-манифестов).
- Имя файла: `backup-<namespace>-<ts>.jsonl`, где `<ts>` — **epoch-ms**
  (прецедент `memory_export`: `export-<key>-<ts>.jsonl`, `ts = Date.now()`) —
  кросс-платформенно (без `:` ISO для Windows/NTFS).
- **Fail-closed набор манифеста** (restore): несовпадение
  `storage.type`, `key`/`namespace`, `model_id`, `dim` или
  `schema_fields` (файл содержит поле, отсутствующее в текущей схеме —
  надмножество-проверка в обе стороны) → **отказ** (без partial restore).
  `plugin_version` — **warn-only** (аварийный restore после апгрейда плагина
  — основной сценарий, не блокируем).
- Restore: валидация **всех** строк (схема + `model_id`/`dim` — паритет
  `memory_import`) **до любых изменений**; сверка манифеста по набору выше.

## 5. Потоки

### 5.1 Backup

1. Preflight: память enabled, `storage.type === "sqlite"` (иначе понятная
   ошибка), конфиг резолвлен. 0 записей в БД → отказ с понятным сообщением
   («нет записей для бэкапа»), файл не создаётся.
   `memory.backup.path` (repo-relative) резолвится от git-корня
   (`git rev-parse --show-toplevel`); вне git — от cwd + предупреждение.
2. `scan` всех записей активного key → **`maskEntry` каждой по текущему
   confidential-набору** (+ `artifactConfidentialPatterns` для `artifacts[]`)
   → запись JSONL + манифест. Точка переиспользования — **import-механика**
   (`maskEntry`), не export (export не пере-маскирует).
3. **Gitignore-check:** `git check-ignore -q <путь-каталога>` (spawn, только
   CLI/код — **LLM warn не считает**): каталог не ignored → warn в stdout +
   audit-лог. Warn — **при каждом бэкапе** (а не только «при конфигурации»).
   Edge: не-git-репо → отдельное предупреждение «вне git-контроля»; git
   недоступен → документированный fallback по корневому `.gitignore` с
   пометкой ограничения.
4. **Retention:** после успешной записи удалить старые бэкапы этого проекта
   сверх `memory.backup.retention` — только по строгому паттерну имён
   `backup-<namespace>-*` (никогда «чистка каталога»).
5. Audit-лог: `memory:backup` (info: путь, count, sha256, warn-флаги).
   Для CLI-вызовов вне opencode — тот же daily-лог
   `.maestro/logs/maestro-bootstrap-<date>.log` (общий logDir-резолв);
   при недоступности лога → warn в stdout (операция не блокируется).

### 5.2 Restore

1. Выбор файла (tool-аргумент; в команде — через `list` + HITL-выбор).
2. Валидация всех строк + манифест (fail-closed).
3. Режим **merge (дефолт):** upsert по ключу `session_id`; `maskEntry` перед
   записью; embeddings из файла (совпадение `model_id`/`dim` обязательно);
   записи, отсутствующие в файле, не трогаются. Конфликт по ключу:
   **wins restore** (без сравнения `time_last` — осознанная перезапись).
   Вывод restore **репортит счёт**: N перезаписано / M добавлено / K
   пропущено (HITL-прозрачность отката свежих записей).
4. Режим **replace:** двойной гейт —
   - tool: нативный `permission: ask` + явный аргумент `replace: true`;
   - CLI: интерактивное подтверждение **вводом namespace**; не-tty → отказ с
     инструкцией; команда LLM-ом `--replace` не пробрасует (показывает
     инструкцию запустить CLI руками);
   - очистка бакета проекта — **только после** успешной валидации (паритет I-4).
5. Audit-лог: `memory:restore` (info: файл, count, режим, sha256).

## 6. Конфиг (`maestro.json → memory.backup`)

```json
"backup": {
  "path": ".maestro/memory/backup",
  "retention": 3
}
```

- `path` — строка, repo-relative (override). Дефолт закрыт строкой `.maestro/`
  в `.gitignore` → **по умолчанию бэкапы не коммитятся** (безопасный дефолт).
  Коммит в приватный репо = осознанная настройка (override пути или
  gitignore-исключение) — docs обязаны смоделировать этот переход.
- `retention` — целое > 0; `0`/`null` = без ограничений; default `3`.
- Валидация некорректных значений: soft fallback на дефолты + warn
  `memory:config_fallback` (паритет с другими ключами `memory.*`; память не
  отключается).
- После правки — OP-1 (перезапуск opencode).

## 7. Операционные ограничения

- **module_dir-гигиена:** в module_dir живёт только код (стирается при resync
  — `provision.js`); бэкапы/состояние туда не пишутся (запрет в spec).
- **Версионирование:** семантический дрейф закрывает манифест (§4); версия CLI
  — из module_dir `package.json`, сверяется с манифестом при restore
  (несовпадение `model_id`/`dim`/ключевых полей — fail-closed).
- **Конкуренция:** `SQLITE_BUSY` — понятная ошибка (busy_timeout 5000 уже
  есть); how-to: restore выполнять при закрытом opencode (документация, не
  enforcement).
- **Инжекционный контур:** restore-файл — недоверенный ввод: валидация строгая,
  `maskEntry` перед upsert, replace — двойной гейт (§5.2).

## 8. Security (C3 — обязательные требования)

1. Double-masking при бэкапе и при restore (`maskEntry`, текущий конфиг).
2. Gitignore-warn детерминированный (CLI/код, `git check-ignore`), при каждом
   бэкапе.
3. manual_docs: раздел «бэкапы — только в приватные репо» + модель
   «коммит = осознанная настройка».
4. Tool — permission `ask` (канон §5a SECURITY.md: write/boundary-tools → ask).
5. `restore --replace` — деструктивная boundary-операция: гейты §5.2.

## 9. Тесты (`npm run test:memory`)

1. `backup.js`: unit `runBackup`/`runRestore`/`listBackups` (моки storage,
   по образцу `mkMockStorage`).
2. Ассерты `maskEntry`-вызова при backup и restore.
3. Полнота полей JSONL против `SCAN_FIELDS`.
4. Манифест: генерация + валидация restore (несовпадение → отказ, без
   partial).
5. Gitignore-warn: мок spawn / fixture-репо (ignored / не-ignored / не-репо /
   git-недоступен → fallback по корневому `.gitignore`).
6. Retention: удаление только по паттерну проекта (JSONL + manifest-пара);
   `0`/`null` = off.
7. Replace-гейт: не-tty CLI → отказ; валидация до очистки.
8. **sqlite-only guard:** `storage.type` = qdrant/pgvector → понятная ошибка,
   ни одной записи не сделано.
9. **Пустой бэкап:** 0 записей → отказ, файл не создаётся.
10. CLI smoke через `child_process`.
11. `index.test.js`: строка `memory_backup` в ask-gate contract-тесте.

## 10. Документация (критерий приёмки, AGENTS.md)

- `manual_docs/reference/memory.md`: tool `memory_backup`, ключи `memory.backup.*`.
- Новый how-to: backup/restore — штатный путь (команда + tool) и аварийный
  (CLI вручную, в т.ч. с другой машины: bootstrap-последовательность
  install → первый запуск opencode → `npm install` в module_dir → CLI);
  раздел «только приватные репо»; restore при закрытом opencode; модель
  коммита бэкапов; restore устаревшего бэкапа в merge-режиме откатывает более
  свежие записи (для disaster recovery — replace); sha256 — детекция порчи,
  не защита от подделки (не подписан).
- `SECURITY.md §5a`: backup/restore — write/boundary-операции (ask-канон) +
  зеркала по правилу AGENTS.md: `manual_docs/explanation/agents-and-trust.md`,
  `manual_docs/reference/model-selection.md`.
- **Sync-точки permission-канона** (`memory_backup: "ask"`):
  `skills/maestro-setup/SKILL.md` (генератор merge-config для новых проектов —
  без правки свежие установки лишатся ask-гейта), `manual_docs/reference/config.md`
  (permission-блок), `manual_docs/how-to/enable-memory.md` (permission-список),
  `manual_docs/reference/commands.md` (новая команда), `AGENTS.md`
  (memory-строка), `plugins/maestro-bootstrap/README.md` (permission-список),
  канон `maestro-assistant` SKILL.md (`memory.backup` + `memory_backup` в
  списке ask-тулов).
- **Верификация (в DoD):** grep по `memory_prune` (референс-тул) по всем
  канон-файлам — каждая найденная точка должна содержать и `memory_backup`.

## 11. Acceptance criteria (DoD)

- [ ] Тесты §9 зелёные (`npm run test:memory` + `npm test`).
- [ ] Manual smoke: backup → list → restore (merge) → restore (replace, CLI
      руками) на временной БД.
- [ ] Docs §10 обновлены; changelog 4.7.0; regression entry
      (`regression/entries/2026-09-22-memory-backup-restore.md`).
- [ ] C3-требования §8 верифицированы (тесты + docs).
- [ ] `maestro.json` канон в maestro-assistant синхронен.


<!-- maestro:sanitize
status: CLEAN
date: 2026-09-22
reviewer: sanitizer
hash: 9cd016c0e2a08558f11ce9a28d254d2a85815a4cf0db268b7d979193a470a04c
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-22
verdict: approve
hash: bc8717359c1aea97e1dee126a9dc403448b0d94ee088b377d546b9dcc021a412
-->
