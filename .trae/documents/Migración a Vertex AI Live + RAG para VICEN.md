Copia y pega ESTE PROMPT en tu agente del IDE y dile que lo ejecute end-to-end (editar código, crear/borrar ficheros, compilar y validar):

***

OBJETIVO
Implementar Gemini Live sobre Vertex AI (WebSocket BidiGenerateContent) con RAG nativo (VertexRagStore) siguiendo las guías:

* docs/VERTEX AI GEMINI LIVE API.txt

* docs/RAG de Vertex AI en la API de Gemini Live.txt

Eliminar la implementación actual de “backup/knowledge injection” y cualquier caché local tipo cachedContents: quiero Vertex+RAG como fuente de knowledge.

RESTRICCIONES

* No añadas comentarios.

* Mantén TypeScript estricto y el estilo del repo.

* La app debe seguir funcionando en Electron (frontend + server local).

* No guardes secretos en repo.

PARTE A — Eliminar implementación actual de backup

1. Server: eliminar el endpoint REST de knowledge pack y su índice

* Archivo: server/src/index.ts

* Elimina:

  * tipos KnowledgePack/KnowledgeIndex y la variable knowledgeIndex

  * funciones normalizeTokens/readTextFileLimited/ensureKnowledgeIndex/bestMatch

  * endpoint GET /api/knowledge/pack

1. Client: eliminar cualquier fetch a /api/knowledge/pack y la inyección de manuales en systemInstruction.

* Archivo: client/src/services/gemini-live.ts

* Debe dejar de existir cualquier referencia a api/knowledge/pack y el bloque “## KNOWLEDGE (MANUALES Y GUÍAS)”.

1. Server: eliminar endpoint /api/gemini/cache si ya no se usa.

* Archivo: server/src/index.ts

* Elimina GET /api/gemini/cache

1. Server: revisar server/src/create-knowledge-cache.ts

* Si ya no se va a usar, bórralo y elimina sus referencias desde el repo.

PARTE B — Vertex AI Live como “bridge” en el server (porque browser no puede setear headers WS)
Necesitamos que la conexión WebSocket a Vertex AI se haga desde Node (server), y el cliente web/electron se conecte al server local.

1. Añadir un NUEVO WebSocket path en el server: /gemini

* Archivo: server/src/index.ts

* En httpServer.on('upgrade', enruta un tercer pathname:

  * /telemetry (ya existe)

  * / (ya existe)

  * /gemini  -> nuevo WebSocketServer noServer (geminiWss)

1. Implementar un módulo nuevo server/src/vertex-live-bridge.ts con una clase VertexLiveBridge
   Responsabilidad:

* Mantener 1 sesión Vertex Live por conexión WS local (o una sola sesión compartida si solo hay 1 cliente; elige la opción más simple y documenta en nombres de variables).

* Traducir mensajes del cliente local a llamadas de @google/genai live:

  * audio\_chunk: {type:'audio\_chunk', mimeType:'audio/pcm;rate=16000', data: base64}
    -> session.sendRealtimeInput({media:{mimeType, data}})

  * audio\_end: {type:'audio\_end'}
    -> session.sendRealtimeInput({audioStreamEnd:true})

  * text\_turn: {type:'text\_turn', text:string}
    -> session.sendClientContent({turns:\[{role:'user',parts:\[{text}]}], turnComplete:true})

* Reenviar respuestas del modelo al cliente local:

  * Si llega audio: envía {type:'model\_audio', mimeType:'audio/pcm;rate=24000', data: base64}

  * Si llega texto: envía {type:'model\_text', text}

  * Si llega turnComplete: envía {type:'model\_turn\_complete'}

  * Si llega toolCall: envía {type:'tool\_call', functionCalls:\[{id,name,args}]}

1. Conexión a Vertex AI usando @google/genai

* Dependencias: ya existe @google/genai.

* Inicializa en Node:

  * const ai = new GoogleGenAI({ vertexai: true, project: process.env.VERTEX\_PROJECT\_ID, location: process.env.VERTEX\_LOCATION });

  * Autenticación por ADC/service account:

    * usar GOOGLE\_APPLICATION\_CREDENTIALS (ruta a JSON) o ADC local.

1. Modelo Vertex

* Modelo debe ser configurable por env:

  * VERTEX\_GEMINI\_LIVE\_MODEL

* Para Vertex, usa formato publisher:

  * publishers/google/models/<model>

* Default razonable: publishers/google/models/gemini-2.0-flash-live-preview-04-09 (si no existe en tu región, deja que sea override por env).

PARTE C — RAG nativo (VertexRagStore) en la configuración “setup”
Implementar RAG como Tool en LiveConnectConfig.tools.

1. Variables env requeridas (server-side)

* VERTEX\_PROJECT\_ID

* VERTEX\_LOCATION

* VERTEX\_RAG\_CORPUS\_ID

1. Construir el recurso del corpus
   ragCorpusName = `projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/ragCorpora/${VERTEX_RAG_CORPUS_ID}`

2. Configurar tools para live.connect

* Debe incluir retrieval con vertexRagStore:

  * ragResources: \[{ ragCorpus: ragCorpusName }]

  * similarityTopK: 5 (configurable)

  * vectorDistanceThreshold opcional

  * storeContext: false (por defecto)

1. Function calling

* Mantén los functionDeclarations que ya usas (tools actuales) en la misma configuración, además del retrieval.

* No elimines tus herramientas existentes; solo asegúrate de que puedan ejecutarse (ver Parte D).

PARTE D — Tool execution (para no perder features del ingeniero)
En el server, cuando Vertex envíe toolCall:

* Ejecuta tools en el server (no en el cliente) para mantener la arquitectura simple.

* Implementa estas tools mínimas:

  1. get\_session\_context: construir desde la última telemetría (usa la telemetría que ya guarda server/src/index.ts). Devuelve también timeRemaining/lapsRemaining/lapsTotal/tires.compound.
  2. get\_vehicle\_setup: devolver lastSetupData + info coche/circuito.
  3. get\_recent\_events: mantiene un buffer en server (20 eventos) alimentado por los eventos que ya maneja el server.
  4. request\_current\_setup: fuerza envío de setup si es posible (si no hay mecanismo, responde success:false con mensaje claro).
  5. configure\_pit\_stop / get\_pit\_status / send\_chat\_macro: reutiliza el canal existente PIT\_COMMAND/GET\_PIT\_STATUS con el pythonTelemetryWs (ya hay infraestructura en server/src/index.ts). Si no hay conexión python, responde success:false.
  6. compare\_laps: puedes devolver solo metadata usando endpoints /api/laps del server; si no quieres renderizar imagen en server, devuelve success:false con instrucción para usar UI (pero no rompas la sesión).

* Tras ejecutar, responde a Vertex con session.sendToolResponse({functionResponses:\[{id,name,response:{result}}]})

PARTE E — Cliente: reemplazar GeminiLiveService para usar el bridge local
En vez de conectar a Google directamente desde el navegador, el cliente debe conectarse a ws\://localhost:8080/gemini.

1. Archivo: client/src/services/gemini-live.ts

* Quita el uso directo de GoogleGenAI/live.connect en browser.

* Sustituye por WebSocket hacia el server local:

  * onopen: marca “connected”

  * onmessage: procesa model\_audio/model\_text/model\_turn\_complete/tool\_call

  * Para model\_audio: usa el pipeline actual playAudioChunk (audio 24k).

1. Envío audio

* Conserva tu AudioWorklet actual.

* En cada frame, envía al WS local {type:'audio\_chunk', mimeType:'audio/pcm;rate=16000', data: base64}.

* Al parar grabación, envía {type:'audio\_end'}.

1. Turnos de texto

* Si existe UI texto, envía {type:'text\_turn', text, turnComplete:true}.

1. turnComplete

* NO envíes nunca “clientContent vacío con turnComplete”.

* El cierre de turno de audio es SOLO audio\_end -> audioStreamEnd.

PARTE F — Config y validación

1. Añadir documentación breve en README o docs:

* Qué env vars hacen falta para Vertex:

  * GOOGLE\_APPLICATION\_CREDENTIALS

  * VERTEX\_PROJECT\_ID

  * VERTEX\_LOCATION

  * VERTEX\_RAG\_CORPUS\_ID

  * VERTEX\_GEMINI\_LIVE\_MODEL

1. Compilar y validar

* npx tsc -p tsconfig.json

* npm run client:build

* npm run server:build

* Arrancar en dev y validar:

  * Conecta el WS /gemini

  * Hablar por PTT: llega model\_audio

  * Hacer una pregunta que obligue a consultar manuales: verificar que el modelo usa RAG (si hay groundingMetadata en mensajes, loguéalo en server y reenvía al cliente como {type:'grounding', ...}).

ENTREGABLE

* App funcionando con Vertex Live desde el server y RAG habilitado por corpus.

* Sin endpoints/filtrado manual de knowledge.

***

Notas de implementación obligatorias (para que siga “oficial” según las guías):

* El endpoint WS Vertex debe ser el de BidiGenerateContent (LlmBidiService/BidiGenerateContent). Si usas @google/genai con vertexai:true, ya lo construye así.

* El tool de RAG debe estar en setup.tools como retrieval.vertexRagStore.ragResources\[].ragCorpus.

