## Cotejo con el documento (Vertex RAG + Live)

* Verifico que el patrón de sesión Live es el mismo: primero se envía un mensaje `setup` con `model`, `generation_config`/`config` y `tools`, y después se envían turnos (`client_content`). En este repo eso ya ocurre vía `client.live.connect(...)` en [gemini-live.ts:L2031-L2242](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2031-L2242), donde `model` + `config.tools` se convierten internamente en el `setup`.

* El documento de Vertex RAG pone `tools` dentro del `setup` (para `retrieval`). Nuestra integración de telemetría ya hace lo mismo con `functionDeclarations` en [gemini-live.ts:L2039-L2041](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2039-L2041). Esto es compatible con caching: *caching no sustituye tools; coexisten en el setup*.

* Diferencia importante: el documento es **Vertex AI** (endpoint `...aiplatform.googleapis.com` + Bearer token + `vertexai=True`), mientras tu app actual usa **Gemini API** con API key (`@google/genai` en frontend). El “shape” del setup coincide, pero cambia la autenticación/endpoint.

## Implementación del gestor de caché (Backend)

* Añadir un módulo/script Node (aprovechando que el repo ya depende de `@google/genai`) que:

  * Lea todos los `.txt` de `./knowledge/**`.

  * Construya `contents` como `[{ role: 'user', parts: [{ text: '...manuales...' }] }]` (formato `Content/Part` del API de caching).

  * Cree el recurso con `ai.caches.create({ model: 'models/gemini-live-2.5-flash-preview-native-audio-09-2025' (o el más reciente compatible), config: { contents, displayName, systemInstruction opcional, ttl: '3600s' } })`.

  * Devuelva/imprima `cache.name` (formato `cachedContents/...`).

  * Persistencia de “recuperación de ID”: guardar `name` + `expireTime` en un JSON local (p.ej. `data/gemini-cache.json`) y, al relanzar, hacer `ai.caches.get({name})` para reutilizar si no expiró; si expiró o falla, recrear.

## Integración crítica con Live API (Regla de Oro)

* Modificar el setup actual del Live WS en [gemini-live.ts:L2031-L2080](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2031-L2080):

  * Mantener **idéntica** la lista de `tools`/`functionDeclarations` existente.

  * Cambiar **solo** el campo `model`:

    * Si hay cache ID disponible (`cachedContents/...`), usarlo como `model`.

    * Si no hay cache ID, usar el modelo base.

  * Asegurar que `responseModalities: [AUDIO]` permanece en el mismo setup.

## Cableado del cache ID hacia el cliente

* Opción recomendada (segura):

  * El script backend usa `GEMINI_API_KEY` (server-side) para crear cache.

  * El frontend obtiene el `cachedContents/...` por una de estas vías:

    * (A) variable de entorno en build: `VITE_GEMINI_CACHED_CONTENT_NAME=cachedContents/...`.

    * (B) endpoint backend `GET /api/gemini/cache` que lee `data/gemini-cache.json` y devuelve `{ name }`.

  * En ambos casos el cliente **no** necesita reenviar manuales por frame/turno: solo referencia la caché.

## Verificación

* Añadir una prueba manual reproducible:

  * Ejecutar script de caché y confirmar que retorna `cachedContents/...`.

  * Conectar Live y verificar que el setup usa `model=cachedContents/...` sin romper tool calling (hacer una llamada de telemetría y confirmar `toolCall` sigue entrando por [gemini-live.ts:L2625-L2762](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2625-L2762)).

  * Verificar que el audio sigue saliendo y que no se está inyectando el corpus en cada turno.

