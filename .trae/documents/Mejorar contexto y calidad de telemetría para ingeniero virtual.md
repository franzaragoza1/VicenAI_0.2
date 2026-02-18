Copia y pega este prompt en Sonnet 4.5 (IDE). No implementes SimHub. No añadas comentarios nuevos.

---

Eres un asistente senior en este repo (Electron+React+Node+Python). Tu tarea es terminar de alinear los updates de contexto enviados a Gemini para que:
- usen el nuevo formato rico basado en `buildCompactContext()`
- NO incluyan fuel/combustible en ningún mensaje enviado a Gemini
- no haya strings `undefined`/`null` en lo enviado
- se mantengan los updates (no desactivar timers), solo corregir el contenido

IMPORTANTE: Antes de tocar texto/plantillas, lee y respeta el esquema real en:
- `client/src/types/telemetry.types.ts` (campos reales)
- `client/src/utils/telemetry-sanitizer.ts` (cómo quedan sanitizados)
Si algún campo que yo mencione no existe, NO lo inventes: usa el real del tipo o adapta el código.

1) Verificar qué ya está hecho (no reescribirlo si ya está bien)
- Confirmar que `telemetry-sanitizer.ts` ya usa:
  - `data.position.class` para inClass
  - `data.simulator` en raíz
  - `fuel.maxLtr` / `fuel.estimatedLapsRemaining`
- Confirmar que en `gemini-live.ts` existe `buildCompactContext(t: TelemetryData)` con:
  - `[CONTEXTO - {simulador}]`
  - `Sesión: ...`
  - `PACING:YES/NO`
  - `SESSION LAST LAP`
  - `SESSION BEST LAP` calculada desde standings (`getSessionBestLap`)
  - `RELATIVO (±4)` solo en Race

2) Hacer que *TODOS* los context updates usen el formato nuevo
Actualmente hay dos caminos:
- `sendContextUpdate()` (usa `buildCompactContext`) → `context_update`
- `startContextUpdates()` (usa `buildRichContextMessage`) → `context_update_periodic`

Acción:
- Cambiar `startContextUpdates()` para que el `message` sea el resultado de `buildCompactContext(this.currentTelemetry)`.
- Dejar el timer y la cadencia igual (no desactivar updates), solo cambiar el builder.
- `buildRichContextMessage()` debe:
  - o eliminarse si ya no se usa,
  - o convertirse en wrapper que devuelva `buildCompactContext(this.currentTelemetry)`.

3) Eliminar fuel/combustible de *cualquier mensaje enviado a Gemini*
Objetivo: ningún `sendAndLog()` debe contener texto relacionado con fuel.

Buscar en `client/src/services/gemini-live.ts` y corregir:
- `checkCriticalAlerts()`:
  - eliminar por completo las ramas `fuel_*` (no enviar alertas fuel_low/fuel_critical).
  - mantener otras alertas (p.ej. daño/incidentes) si existen.
- `formatAlertMessage()`:
  - eliminar casos `fuel_critical` y `fuel_low`.
- `updateSimHubTelemetry()`:
  - NO tocar SimHub salvo para asegurar que no se generan alertas de fuel.
  - Si el método existe con fuel alerts, dejarlo inerte o quitar esas ramas.
- `sendRaceSnapshot()` / `formatSnapshotForGemini()`:
  - eliminar cualquier línea `Fuel:` o condiciones que añadan fuel al texto.
- `formatContextMessage()` (CompetitionContext):
  - eliminar la línea que añade `Combustible: ...`.
- `injectTestEvent()`:
  - eliminar el test `fuel_warning` y su listado.

4) Asegurar “no undefined/null” en strings enviados
- Cualquier nombre debe resolverse como: `userName || name || '?'`.
- Cualquier número opcional debe renderizarse como `?` si no es válido.

5) Mantener documentación consistente
- Revisar `CONTEXT_IMPROVEMENTS_SUMMARY.md` y `CONTEXT_FORMAT_REFERENCE.md`.
- Si tras los cambios quedan referencias a fuel en la documentación o en ejemplos, eliminarlas.
- Asegurar que las funciones que la doc menciona existen (p.ej. `buildCompactContext`, `getLeaderInfo`, `getRelativeStandings`, `getSessionBestLap`, `getPaceAnalysis`, `isPacingActive`). Si falta alguna, actualizar doc o implementar la función real (sin comentarios).

6) Verificación mínima
Sin arrancar Electron si no hace falta:
- Buscar en el repo occurrences de `Fuel:` / `Combustible:` / `fuel_critical` / `fuel_low` dentro de strings que se manden con `sendAndLog()`.
- Confirmar que `startContextUpdates()` ahora manda el formato de `buildCompactContext`.
- Confirmar que los logs del tipo `context_update_periodic` ya no incluyen ninguna línea de fuel.

ENTREGA
- Devuelve lista de archivos modificados.
- Incluye 1 ejemplo del contexto real generado (RACE) y 1 ejemplo (PRACTICE/QUALY) sin fuel y sin undefined.

---

Nota: no elimines los updates; el objetivo es que el contenido sea correcto y consistente.