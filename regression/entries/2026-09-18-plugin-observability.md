# Regression — наблюдаемость плагина (2026-09-18)

- **version:** 1
- **feature:** feature/plugin-observability
- **added:** 2026-09-18
- **status:** active
- **risk:** LOW
- **scenarios:**
  - **Адаптер форвардит все хуки:** (plugins):
    - run: node --test plugins/maestro-bootstrap/index.test.js → 174 pass
    - run: node -e "import('./plugins/maestro-bootstrap/index.js').then(m=>console.log(Object.keys(m)))" → [default]
  - **fail-soft каркас:** init-сбой → {config,event,startup,dispose}, повторный вызов ретраит
  - **memory-report fallback:** (команда):
    - run: memory.enabled:false → «Память выключена»
    - run: enabled+sqlite+tool недоступен → упрощённый HTML с плашкой
    - run: enabled+qdrant/pgvector+tool недоступен → «Плагин недоступен»
  - **Гейт 0 warn:** init-версия < кэш-версия → warn, не STOP
