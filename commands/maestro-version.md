---
description: Показать версию плагина maestro-bootstrap (проектный .maestro/plugin-version; fallback — глобальный)
---

# /maestro-version

Покажи пользователю фактическую версию плагина `maestro-bootstrap`.

## Действия

1. Прочитай проектный `.maestro/plugin-version` (фактическая версия загруженного
   плагина) через `read`.
2. Если проектный `.maestro/plugin-version` отсутствует или пуст — прочитай глобальный
   `~/.config/opencode/.maestro/plugin-version` через `read`
   (если `XDG_CONFIG_HOME` задан — `$XDG_CONFIG_HOME/opencode/.maestro/plugin-version`).
   Глобальный файл пишут `maestro-install.sh --global` / `maestro-update.sh --global`
   (фактическая версия задеплоенного коммита).
3. Если оба файла отсутствуют или пусты — сообщи:
   "Плагин maestro-bootstrap не инициализирован или версия неизвестна."
   (проектный файл пишется только при успешной инициализации плагина — признак сбоя init).
4. Иначе сообщи:
   "Подключён плагин maestro-bootstrap версии `<версия>`."

Все сообщения пользователю — только на русском языке.
