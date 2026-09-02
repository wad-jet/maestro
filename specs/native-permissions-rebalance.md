# Перераспределение ответственности безопасности: нативные permissions OpenCode vs плагин `maestro-bootstrap`

## Статус

- Дата: 2026-09-02. Версия: 2. Тип: **spec** (proposal, не план реализации).
- Репо: `maestro-agent` (authoring).
- Основано на: независимом исследовании `SECURITY-COMPARISON.md` (§5 «Избыточность и
  комплементарность») + верификации доков OpenCode (Permissions / Agents / Policies,
  2026-09-02) + аудите текущих инструкций maestro по нативным permissions.
- v2: добавлено расщепление на фазы A/B (решение HITL 2026-09-02, §5).

## 1. Проблематика

Сравнение в `SECURITY-COMPARISON.md` §5 выявило, что часть контрмер плагина
`maestro-bootstrap` дублирует нативный permission-слой OpenCode, а часть — остаётся
уникальной. Дополнительно обнаружен главный пробел: **нативные permissions не
настраиваются на этапе инициализации проекта** (`/maestro-new`, `@maestro-init`
задают только `plugin` + модели `agent.*.model`), поэтому fail-open риск плагина
(отсутствие/отключение → потеря файловой защиты) не подстрахован нативным
fail-closed бастионом ядра OpenCode.

## 2. Новые факты исследования (F1–F7)

Источники: OpenCode Agents/Permissions/Policies docs (дата проверки 2026-09-02),
аудит `skills/maestro-new/SKILL.md`, `skills/maestro-assistant/SKILL.md`,
`commands/maestro-init.md`, `manual_docs/reference/config.md`,
`manual_docs/explanation/agents-and-trust.md`.

- **F1.** Дока OpenCode Agents: *«Agent permissions are merged with the global
  config, and agent rules take precedence»*. Значит нативно выражается
  **allow-внутри-deny**: глобально `permission.read: {"docs/confidential/*": "deny"}` +
  `agent.custodian.permission.read: {"docs/confidential/*": "allow"}` → custodian
  читает, остальные (включая primary) — нет. **Опровергает** утверждение
  SECURITY-COMPARISON.md §5.2/§5.5 «per-agent rules не дают allow-внутри-deny».
  (Оговорка: точная granular-семантика мержа требует runtime-верификации — V1.)
- **F2.** Нативный `edit` gates `write`/`edit`/`apply_patch`; `read` gates `read` —
  полное покрытие `read`/`write`/`edit` из confidential-секции плагина.
- **F3.** `task`-permission (glob по `subagent_type`) — maestro **уже использует
  нативно**: `task: deny` во frontmatter всех сабагентов (один уровень
  вложенности). Caveat из доки: пользователь всегда может вызвать сабагента
  напрямую через `@`, даже при `task: deny`.
- **F4 (главный пробел).** `/maestro-new` и `@maestro-init` **не настраивают
  нативные permissions** (только `plugin` + модели). «2-й эшелон» (bash deny для
  confidential) — рекомендация в `manual_docs/explanation/agents-and-trust.md`, не
  часть init. Fail-open риск плагина не подстрахован на этапе установки.
- **F5.** Канон `maestro-assistant` не содержит native-permission-канона — assistant
  не может последовательно настраивать/чинить нативный слой.
- **F6.** Нативный `ask` промптит пользователя напрямую (настоящий per-call HITL) —
  vs плагиновый паттерн «error → оркестратор решает».
- **F7.** Семантика паттернов OpenCode: `*` **пересекает `/`** (в отличие от
  сегментной `confGlobMatch`), **last-match-wins**, `~`/`$HOME`-expansion, нативный
  `doom_loop`-guard (ask по умолчанию) — в maestro не документированы.

## 3. Рекомендации (R1–R10)

### R1 (high) — Нативный fail-closed baseline при init

`/maestro-new` / `@maestro-init` пишут в merge-config нативные deny:
`permission.read` + `permission.edit` для `docs/confidential/*` + built-in паттернов
(`.env`, `*.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`; `.env.example` —
allow, паритет с ядром). Файловая защита `read`/`edit` перестаёт зависеть от
наличия плагина (fail-closed в ядре). **Placement (I4, review):** deny для
`docs/confidential/*` — только в project `.opencode/opencode.json` (не должен
влиять на не-maestro проекты); глобально — максимум паритет built-in секретов.

### R2 (high) — Trusted-исключения нативно

**Расщеплено (Spec Review C1, 2026-09-02):**
- **Конфигурационная половина (Этап A):** `agent.custodian`/`agent.sanitizer`
  получают per-agent `permission.read`/`glob`/`grep: {"docs/confidential/*": "allow"}`
  (agent rules take precedence). **Необходимо** — нативный глобальный deny R1
  применяется ко всем агентам, включая trusted, а плагин не может override нативный
  deny (иначе trusted-канал ломается между фазами). Плюс `agents/custodian.md`,
  `agents/sanitizer.md` frontmatter. Enforcement плагина остаётся defense-in-depth.
- **Половина «удаление enforcement» (Этап B, после V1):** из плагина уходят
  `resolveIsTrustedSubagent`, `sessionTrustCache`, `confGlobMatch` для доступа.

### R3 (high) — Retire `access_policy` → native `permission.read`

Дублирование снято; нативный `ask` даёт настоящий HITL без посредника-оркестратора.
Перевод правил (deny>ask>allow → last-match-wins с catch-all первым) — в канон
maestro-assistant.

### R4 (medium) — 2-й эшелон из рекомендации в обязанность

Bash deny-паттерны (`*cat*confidential*` и т.п.) + `glob`/`grep` deny для
confidential — писать при init, не только документировать. **Реализация (уточнено
при review):** только точечные deny, без глобального `"*": "ask"` для bash (иначе
каждый bash-вызов — per-call HITL); `glob`/`grep` матчат аргумент-паттерн, не
пути-результаты — эвристический слой, не абсолютный барьер.

### R5 (medium) — Policies для P4

`experimental.policies` (`provider.use`) enforce'ит P4 (trusted-агенты на
изолированных моделях): deny внешних провайдеров / allow только одобренных — в ядре,
в отличие от merge-конфига моделей (не enforced). **Ограничение (I1, review):**
policies глобальны (на инстанс), не per-agent — это enforce **глобального**
allowlist, совместимого с P4, а не «trusted-локальные / untrusted-внешние».
Кросс-проверка на init: allowlist ⊇ провайдеры всех выбранных `agent.*.model`.

### R6 (medium) — Native-permission канон в maestro-assistant

Глобальные deny, per-agent exceptions, правило порядка (last-match-wins), перевод
`access_policy`, семантика `*`-кросс-`/`, 2-й эшелон, **sync-правило двойного
источника (I3, review)**: изменение `confidential.paths` зеркалируется в нативные
deny и per-agent allow и наоборот (иначе дрейф).

### R7 (low) — `plugin-version` → кандидат на удаление

Утилитарный механизм; низкая ценность, дублирует информацию о версии.

### R8 (low) — Документировать `doom_loop` и caveat про `@`-invocation

Пользователь может запустить `@custodian` напрямую (при `task: deny` у остальных) —
приемлемо (человек = источник доверия), но должно быть осознано и описано.

### R9 — Итоговая роль плагина: observability + sanitizer, ноль enforcement

Остаётся: sanitizer Ур.1 (task-промпты), SEC-4 (title), аудит-лог (неблокирующее
наблюдение confidential-access), empty-result, session.error. Gate 0 (P5) остаётся
нужным для sanitizer; файловая защита от плагина больше не зависит.

### R10 — Синхронизация доков (по правилу AGENTS.md)

`SECURITY.md` (§4 контрмеры, §5 — пункт fail-open смягчается),
`SECURITY-COMPARISON.md` §5 (корректировка F1), `manual_docs/`
(`agents-and-trust.md`, `config.md`, `model-selection.md`), changelog.

## 4. Точки верификации (V1–V4)

- **V1.** Merge-семантика granular-правил agent-vs-global (allow-паттерн агента
  против deny-паттерна глобала). Заявлена в доке («agent rules take precedence»);
  **runtime-верификация** — в синтетическом fixture-проекте (реальных
  confidential-данных не требуется; попытка 2026-09-02 заблокирована
  недоступностью провайдера — **pending**). Нужна **до** подтверждения Этапа A
  (trusted-исключения нативно); при провале — fallback: скоупить нативный
  confidential-deny из Этапа A, положившись на плагин.
- **V2.** Как surfac'ятся `ask`-промпты из сабагент-сессий в TUI — не ломает ли
  pipeline-поток (до реализации R3).
- **V3.** Перевод `docs/confidential/**` → `docs/confidential/*` (opencode-семантика:
  `*` пересекает `/`).
- **V4.** last-match-wins при автогенерации правил — порядок критичен.

## 5. Расщепление фаз (scope split, решение HITL 2026-09-02)

R1–R10 реализуются **в две фазы** из-за V1-блокера (merge-семантика нативных
granular-правил не верифицирована в рантайме; проверка невозможна в authoring-репо —
в целевом приложении `/maestro` нет `docs/confidential`).

### Этап A (текущий) — skill-инструкции + канон + docs, **ноль изменений кода плагина**

| Рекомендация | Суть | Файлы |
|---|---|---|
| R1 (high) | Нативный deny-baseline (read/edit) при init | `skills/maestro-new/SKILL.md`, `skills/maestro-assistant/SKILL.md` |
| R2-конфиг (high) | Per-agent trusted-исключения (`custodian`/`sanitizer` read/glob/grep allow) — необходимо поверх глобального deny | `agents/custodian.md`, `agents/sanitizer.md`, `skills/maestro-new/SKILL.md`, `skills/maestro-assistant/SKILL.md` |
| R4 (medium) | 2-й эшелон (bash/glob/grep deny) при init | `skills/maestro-new/SKILL.md`, `skills/maestro-assistant/SKILL.md` |
| R5 (medium) | `experimental.policies` (provider.use) для P4 | `skills/maestro-new/SKILL.md`, `skills/maestro-assistant/SKILL.md`, `manual_docs/reference/model-selection.md` |
| R6 (medium) | Native-permission канон в maestro-assistant | `skills/maestro-assistant/SKILL.md` |
| R8 (low) | Документировать doom_loop + @-invocation caveat | `manual_docs/` |
| R10 | Синхронизация доков | `SECURITY.md`, `SECURITY-COMPARISON.md`, `manual_docs/` (config, agents-and-trust, model-selection, changelog) |

**Критерий этапа A:** покрывает F4 (init не настраивает нативные permissions), F5
(нет native-канона) и C1 (trusted-канал не ломается нативным deny — через
R2-конфиг); не затрагивает `core.js`/`index.js`.

### Этап B (после V1) — код плагина + trusted-исключения нативно

| Рекомендация | Суть | Причина отложки |
|---|---|---|
| R2-enforcement (high) | Из плагина уходит confidential-enforcement (resolveIsTrustedSubagent, sessionTrustCache, confGlobMatch) | Зависит от V1 (merge agent-vs-global); конфиг-половина уже в Этапе A |
| R3 (high) | Retire `access_policy` → native `permission.read` | Зависит от V1 и V2 (ask в TUI из сабагентов) |
| R7 (low) | Удалить `plugin-version` | Завязан на `/maestro-version` и SECURITY.md P6; код плагина |
| R9 | Плагин → observability + sanitizer, zero enforcement | Зависит от R2/R3 (enforcement уходит только после переноса нативно) |

Этап B требует runtime-верификации V1 (и V2) в целевом приложении.

## 6. Порядок миграции (Этап A)

R1+R4 → R5 → R6 → R8 → R10.

Влияние на инварианты `SECURITY.md` P1–P6 (в т.ч. P6 по `plugin-version`) — на этапе
реализации (не в этом spec).

## 7. Затрагиваемые файлы (Этап A)

- `skills/maestro-new/SKILL.md` — R1 (baseline), R2-конфиг (trusted-исключения), R4 (2-й эшелон), R5 (policies).
- `skills/maestro-assistant/SKILL.md` — R1/R2-конфиг/R4/R5 (init-канон), R6 (native-канон + sync-правило).
- `agents/custodian.md`, `agents/sanitizer.md` — per-agent `read`/`glob`/`grep` allow для confidential (R2-конфиг).
- `manual_docs/reference/model-selection.md` — R5.
- `manual_docs/reference/config.md`, `manual_docs/explanation/agents-and-trust.md` — R8, R10, R2-конфиг.
- `manual_docs/overview/changelog.md` — R10.
- `SECURITY.md` — R10 (§4 контрмеры, §5 ограничения — fail-open смягчается нативным baseline; R2-конфиг).
- `SECURITY-COMPARISON.md` — R10 (отметка о scope split + R2-конфиг).

Этап B файлы (не трогаются в этапе A): `plugins/maestro-bootstrap/core.js`, `index.js`.

## 8. Источники

- OpenCode Permissions: https://opencode.ai/docs/permissions/
- OpenCode Agents: https://opencode.ai/docs/agents/
- OpenCode Policies: https://opencode.ai/docs/ru/policies/
- Внутренний стандарт ИБ: `SECURITY.md`
- Сравнение: `SECURITY-COMPARISON.md`
- Реализация плагина: `plugins/maestro-bootstrap/core.js`, `plugins/maestro-bootstrap/index.js`