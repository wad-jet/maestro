---
description: Проверить сабагент design — доступность, agent.design из opencode.json, trusted-статус в maestro.json
agent: design
---
Проверь две вещи:

1. Прочитай opencode.json в корне проекта. Найди свой ключ agent.design.

2. Прочитай maestro.json в корне проекта. Проверь, что ты отмечен как
   trusted (в секции `trust` ключ `design` со значением `true`).

Верни ТОЛЬКО три строки:
model: <значение agent.design.model>
temperature: <значение agent.design.temperature>
trusted: <true | false | MISSING — если design не указан в секции trust maestro.json>