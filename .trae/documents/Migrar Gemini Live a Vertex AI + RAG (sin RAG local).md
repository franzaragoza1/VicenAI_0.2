## Objetivo
- Dejar de usar Google GenAI con API key desde el navegador.
- Pasar Gemini Live a Vertex AI en el servidor, habilitando RAG con Vertex RAG Corpus (variables ya en .env.local).
- Eliminar cualquier sistema de “RAG/local knowledge” previo (cache/endpoint local) y quedarse solo con RAG en la nube.

## Arquitectura Resultante
- **Frontend (client)**: solo captura audio/manda texto, ejecuta tools (telemetría, compare_laps, pit, chat) y reproduce audio.
- **Backend (server)**: mantiene una sesión Live en **Vertex AI** y actúa de puente por WebSocket.
- **RAG**: únicamente vía `vertexRagStore` apuntando a `projects/<id>/locations/<loc>/ragCorpora/<corpus>`.

## Cambios en Servidor (Node)
1. **Cargar .env.local en runtime**
   - Añadir un loader ligero (sin dependencias nuevas) que lea `.env.local`/`.env` y pueble `process.env`.
   - Invocarlo al inicio de [index.ts](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/server/src/index.ts) antes de crear el bridge.

2. **Activar el WebSocket /gemini**
   - Actualmente existe `geminiWss` pero no se usa y `VertexLiveBridge` está sin instanciar.
   - Instanciar el bridge con `geminiWss` para que `ws://localhost:8080/gemini` quede operativo.

3. **Ajustar VertexLiveBridge para handshake “setup”**
   - Cambiar [vertex-live-bridge.ts](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/server/src/vertex-live-bridge.ts) para:
     - **No** conectarse a Vertex inmediatamente al conectar el cliente.
     - Esperar un primer mensaje `type: "setup"` con (mínimo) `initialContext` y/o `systemInstruction`.
     - Crear la sesión `vertexAi.live.connect(...)` usando:
       - `process.env.VERTEX_PROJECT_ID`, `process.env.VERTEX_LOCATION`, `process.env.VERTEX_RAG_CORPUS_ID`, `process.env.VERTEX_GEMINI_LIVE_MODEL`.
       - `tools: [ { retrieval: { vertexRagStore: ... } }, { functionDeclarations: ... } ]`.

4. **Forward de Tool Calling hacia el cliente (para no perder features)**
   - En vez de ejecutar tools en el servidor (ahora hay stubs), el bridge hará passthrough:
     - Cuando Vertex envíe `toolCall.functionCalls`, el servidor manda al cliente: `{ type: "tool_call", functionCalls: [...] }`.
     - El cliente responde: `{ type: "tool_response", functionResponses: [...] }`.
     - El servidor hace `session.sendToolResponse(...)`.
   - Esto mantiene funcionando `compare_laps` (imagen), `configure_pit_stop`, `get_session_context`, etc. sin reimplementar en Node.

5. **Ampliar protocolo cliente→servidor**
   - Mantener audio streaming (`audio_chunk`, `audio_end`).
   - Añadir envío genérico de contenido multimodal para casos como `compare_laps`:
     - Mensaje `type: "client_content"` con payload equivalente a `sendClientContent`.

## Cambios en Cliente (React)
1. **Eliminar dependencia de API key en el navegador**
   - En [App.tsx](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/App.tsx) quitar el guard que exige `VITE_GEMINI_API_KEY` y dejar que el servicio conecte siempre.

2. **Refactor de GeminiLiveService para usar el bridge**
   - En [gemini-live.ts](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts):
     - Sustituir `this.client.live.connect(...)` por un `WebSocket` a `ws://localhost:8080/gemini`.
     - En `connect()`:
       - Abrir WS.
       - Enviar `setup` con `initialContext` + `systemInstruction` (reutilizando el prompt actual para no romper comportamiento).
     - Donde hoy se llama:
       - `this.session.sendRealtimeInput(...)` → enviar `audio_chunk`/`audio_end` al servidor.
       - `this.session.sendClientContent(...)` (vía `sendAndLog`) → enviar `client_content` al servidor.
       - `this.session.sendToolResponse(...)` → enviar `tool_response` al servidor.
     - Reemplazar `handleMessage(LiveServerMessage)` por un handler de mensajes del bridge:
       - `model_audio` → `playAudioChunk()`.
       - `model_text` → `onTranscriptUpdate()` + logging.
       - `model_turn_complete` → cerrar speaking state.
       - `tool_call` → reutilizar `handleToolCall()` pero con envío de respuesta al servidor.
       - `grounding` → log (útil para verificar que el RAG de Vertex está activo).

3. **Mantener WS actual de comandos**
   - No tocar el WS raíz `ws://localhost:8080/` usado para PTT/commands; solo se añade `/gemini`.

## Eliminar “RAG local / knowledge cache”
- Quitar del servidor:
  - Endpoint `/api/knowledge/pack` y todo su indexado local de `knowledge/` en [index.ts](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/server/src/index.ts).
  - Endpoint `/api/gemini/cache`.
  - Script/feature de caches en [create-knowledge-cache.ts](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/server/src/create-knowledge-cache.ts) y cualquier referencia asociada.
- Mantener intacto lo que no es RAG (telemetría, laps, PTT, etc.).

## Verificación (después de aplicar cambios)
- Levantar `npm run dev`.
- Comprobar:
  - Conexión WS `/gemini` estable y audio de salida 24kHz.
  - Tool calling sigue funcionando (p. ej. `compare_laps`, `configure_pit_stop`).
  - RAG: aparecen mensajes `type: "grounding"` cuando el modelo cite chunks del corpus.
  - No hay lecturas de `VITE_GEMINI_API_KEY` requeridas en el frontend.

## Notas de Auth (importante)
- Vertex AI Live en servidor requiere credenciales (ADC): `gcloud auth application-default login` o `GOOGLE_APPLICATION_CREDENTIALS` (service account). La API key del navegador deja de ser necesaria.