---
description: Проверить все сабагенты maestro — доступность, agent.<name> из opencode.json, trusted-статус design/sanitizer в maestro.json
---
Проверь все 7 сабагентов maestro: `design`, `haiku`, `sonnet`, `opus`, `fable`,
`code-reviewer`, `sanitizer`.

Для каждого агента:

1. Прочитай opencode.json в корне проекта. Найди ключ `agent.<name>`.

2. Для `design` и `sanitizer` дополнительно прочитай maestro.json в корне
   проекта. Проверь, что агент отмечен как trusted (в секции `trust` ключ со
   значением `true`).

Верни ТОЛЬКО сводную таблицу для всех 7 агентов:

| Агент | model | temperature | trusted |
|---|---|---|---|
| design | <модель> | <temp> | <true | false | MISSING> |
| haiku | ... | ... | — |
| sonnet | ... | ... | — |
| opus | ... | ... | — |
| fable | ... | ... | — |
| code-reviewer | ... | ... | — |
| sanitizer | ... | ... | <true | false | MISSING> |

Правила заполнения:

- Значения `model` и `temperature` берутся из `agent.<name>.model` и
  `agent.<name>.temperature` в `opencode.json`. Если ключа нет (например,
  агент выбран на `auto` и ключ не пишется) — ставь **`MISSING`**, а не пусто.
- `trusted` заполняется только для `design` и `sanitizer` (из `maestro.json →
  trust`); для остальных агентов — «—».
- `MISSING` для `trusted` — если агент не указан в секции `trust` maestro.json
  (design/sanitizer).
