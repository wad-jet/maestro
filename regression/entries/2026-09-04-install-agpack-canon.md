---
version: 1
feature: install-agpack-canon
added: 2026-09-04
status: active
risk: MEDIUM
---

# maestro-install.sh: единый источник maestro-install/agpack.yml

## Суть

`maestro-install.sh` больше не встраивает содержимое `agpack.yml` heredoc-ом,
а скачивает его из канона `maestro-install/agpack.yml` репозитория через
`fetch`-хелпер (curl/wget). Тот же источник, что читает `maestro-update.sh` при
merge-add. Меняется поведение первичной установки: требуется сеть и curl/wget.

## Сценарии риска

### 1. Синтаксис скриптов

- `path`: `maestro-install.sh`, `maestro-update.sh`
- `run`: `bash -n maestro-install.sh maestro-update.sh`
- `workdir`: корень репо
- Ожидание: exit 0.

### 2. Прогон первичной установки (scratch) — скачивание канона

- `path`: `maestro-install.sh` (шаг 3)
- `run`: [Manual] на scratch-каталоге (вне репо): `bash /path/maestro-install.sh` →
  создаётся `agpack.yml`; содержимое идентично `maestro-install/agpack.yml`;
  `agpack sync` проходит; вывод шага 7 сообщает «создан из канона».
- `workdir`: scratch-каталог (вне репо)

### 3. Идемпотентность при существующем agpack.yml

- `path`: `maestro-install.sh` (шаг 3)
- `run`: [Manual] на scratch-каталоге с уже существующим `agpack.yml`:
  повторный `bash /path/maestro-install.sh` → «agpack.yml уже существует»,
  существующий файл не перезаписан.
- `workdir`: scratch-каталог (вне репо)

### 4. Отсутствие сети/curl — понятная ошибка

- `path`: `maestro-install.sh` (шаг 3)
- `run`: [Manual] на scratch-каталоге с отключённым curl/wget (или без сети):
  `bash /path/maestro-install.sh` → `die` с инструкцией скачать `agpack.yml` вручную.
- `workdir`: scratch-каталог (вне репо)

### 5. Тесты плагина (не затронут)

- `path`: `plugins/maestro-bootstrap/index.test.js`
- `run`: `node --test plugins/maestro-bootstrap/index.test.js`
- `workdir`: корень репо
- Ожидание: 173/173 pass.

### 6. Контрольный grep по устаревшим формулировкам

- `path`: `maestro-install.sh`, `manual_docs/` (кроме истории changelog)
- `run`: `rg -n 'справочная копия|встроено в|самодостаточн' maestro-install.sh manual_docs/ 2>/dev/null`
- `workdir`: корень репо
- Ожидание: 0 совпадений в актуальных (не-исторических) разделах; допускаются
  исторические упоминания в `manual_docs/overview/changelog.md` (секции прошлых
  версий 2.0.0/2.1.0).