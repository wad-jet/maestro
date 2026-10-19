---
description: Проверить всех сабагентов maestro реальным диспатчем — каждой модели даётся тестовая задача
---
Проверь все 7 сабагентов maestro **реальным диспатчем**: `custodian`, `haiku`,
`sonnet`, `opus`, `fable`, `reviewer`, `sanitizer`.

Для каждого агента:

1. **Диспатчь** сабагент через `subagent` tool с параметром `agent="<name>"`.
   Из результата диспатча возьми `sessionID` child-сессии.

2. **Получи фактическую модель** (не конфиг, не self-report):
   - выполни `opencode session export <sessionID>` (fallback при сбое:
     `opencode export <sessionID>`);
   - извлеки `info.model` → объект `{providerID, id, variant?}`;
   - `Модель (факт)` = `<providerID>/<id>`; `Variant` = `<variant>` или
     `—` если поле отсутствует.
   - Если экспорт упал — оставь в обеих колонках «не получено»,
     статус остаётся OK (диспатч успешен).

3. Дай одинаковую тривиальную тестовую задачу:

   «Верни OK. Не используй инструменты.»

4. Зафиксируй результат.

Не читай конфиги (`maestro.json`, `opencode.json`) и не сверяйся с ними —
проверяется только реальная работа модели через диспатч.

Верни ТОЛЬКО сводную таблицу статусов:

| Агент | Статус | Модель (факт) | Variant | Причина |
|---|---|---|---|---|
| custodian | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| haiku | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| sonnet | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| opus | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| fable | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| reviewer | OK / FAIL | <providerID/id> | <variant> / — | <—> |
| sanitizer | OK / FAIL | <providerID/id> | <variant> / — | <—> |

Правила заполнения:

- **OK** — диспатч успешен, сабагент вернул ответ.
- **FAIL** — диспатч упал (недоступна/невалидная модель, ошибка провайдера,
  таймаут). В колонке «Причина» укажи текст ошибки диспатча.
- **Модель (факт)** — из `info.model.id` + `providerID` child-сессии.
  FAIL диспатча → `—`. Экспорт упал → `не получено`.
- **Variant** — из `info.model.variant`. Поле отсутствует у модели → `—`.
  FAIL диспатча → `—`.
- Если диспатч не удалось выполнить ни для одного агента — верни только
  таблицу с FAIL и причиной для каждого.

Почему в таблице нет Temperature — см. `manual_docs/reference/commands.md`, секция «/test-agents» (подпункт Temperature).

## Проверка инварианта confidential (после основной таблицы)

Проверь, что доступ к confidential не зависит от доступности модели
trusted-агента (см. `SECURITY.md` → P1/P3).

**Предусловие:** шаг выполняется в **target-приложении**, где существует
`docs/confidential/**` (создаётся `/maestro-setup`). Если пути нет — пропусти этот
шаг и укажи в сводке `confidential-invariant: skipped (нет docs/confidential)`.

Шаги:

1. Для каждого trusted-агента (`custodian`, `sanitizer`) — если в основной таблице
   он `OK`:
   - дай задачу «Прочитай `docs/confidential/<любой-файл>.md`. Верни OK.»
   - зафиксируй, что trusted-агент прочитал файл (это его право).
2. Затем **из primary-сессии** попытайся прочитать тот же файл
   (`docs/confidential/<тот-же-файл>.md`).
3. Зафиксируй результат: read из primary должен вернуть `confidential:deny`.

Добавь строку в сводку:

| Инвариант | Статус |
|---|---|
| confidential-invariant: primary deny при OK trusted-диспатча | PASS / FAIL / skipped |

Правила заполнения:

- **PASS** — trusted-агент прочитал confidential, а primary получил deny.
- **FAIL** — primary получил доступ к confidential (утечка) → СТОП, сообщи.
- **skipped** — нет `docs/confidential/**` в текущем проекте.

> Примечание: ветка «trusted-модель недоступна» (FAIL диспатча trusted) здесь
> намеренно не эмулируется — она воспроизводится только при фактической
> недоступности модели и детерминированно не тестируется (см. `SECURITY.md` → §6).
