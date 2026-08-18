---
description: Проверить сабагент sanitizer — доступность, agent.sanitizer из opencode.json, trusted-статус в trust-config.json
agent: sanitizer
---
Проверь две вещи:

1. Прочитай opencode.json в корне проекта. Найди свой ключ agent.sanitizer.

2. Прочитай trust-config.json в корне проекта. Проверь, что ты отмечен как
   trusted (ключ `sanitizer` со значением `true`).

Верни ТОЛЬКО три строки:
model: <значение agent.sanitizer.model>
temperature: <значение agent.sanitizer.temperature>
trusted: <true | false | MISSING — если sanitizer не указан в trust-config.json>