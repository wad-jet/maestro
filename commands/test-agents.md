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
| design | <значение agent.design.model> | <значение agent.design.temperature> | <true | false | MISSING> |
| haiku | ... | ... | — |
| sonnet | ... | ... | — |
| opus | ... | ... | — |
| fable | ... | ... | — |
| code-reviewer | ... | ... | — |
| sanitizer | ... | ... | <true | false | MISSING> |

- `trusted` заполняется только для `design` и `sanitizer`; для остальных — «—».
- `MISSING` — если агент не указан в секции `trust` maestro.json (design/sanitizer)
  или отсутствует ключ `agent.<name>` в opencode.json.