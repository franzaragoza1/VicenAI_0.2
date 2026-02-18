/**
 * Spotter Audio Service
 *
 * Reproduce archivos MP3 pre-grabados de alertas críticas del Spotter.
 * Solo archivos locales - NO conexión a API externa.
 */

// 🎯 SINGLETON - Instancia global del servicio
let spotterInstance: SpotterAudioService | null = null;

/**
 * Obtiene la instancia singleton del SpotterAudioService
 * Crea una nueva si no existe
 */
export function getSpotterService(): SpotterAudioService {
  if (!spotterInstance) {
    spotterInstance = new SpotterAudioService();
  }
  return spotterInstance;
}

export class SpotterAudioService {

  private audioContext: AudioContext | null = null;
  private audioQueue: Array<{ buffer: AudioBuffer; priority: number }> = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentPriority: number = 0;
  private readonly MAX_QUEUE_SIZE = 3; // Máximo 3 audios en cola para evitar acumulación

  // FX2: open/close click para mensajes del spotter
  private fxSpotter: AudioBuffer | null = null;

  // STATICFX: estática de fondo durante transmisión
  private fxStatic: AudioBuffer | null = null;
  private staticSource: AudioBufferSourceNode | null = null;
  private staticGain: GainNode | null = null;

  // 🎭 Manifest de variantes (clave → array de archivos)
  private spotterManifest: Record<string, string[]> = {};
  private manifestLoaded = false;

  // 🎯 Mapa de frases pre-generadas (texto normalizado → filename base)
  private readonly localAudioMap = new Map<string, string>([
    // Spotter básico (CRÍTICO - Máximo énfasis en audio)
    ["coche a la izquierda", "car_left"],
    ["coche a la derecha", "car_right"],
    ["tres en paralelo", "three_wide"],
    ["libre", "clear"],
    ["libre por todos lados", "clear_all_around"],
    ["libre a la izquierda", "clear_left"],
    ["libre a la derecha", "clear_right"],

    // Still there - Left
    ["sigue a la izquierda", "still_left_1"],
    ["aun en la izquierda", "still_left_2"],
    ["continua en la izquierda", "still_left_3"],

    // Still there - Right
    ["sigue a la derecha", "still_right_1"],
    ["aun en la derecha", "still_right_2"],
    ["continua en la derecha", "still_right_3"],

    // Still there - Three Wide
    ["aun tres en paralelo", "still_three_wide_1"],
    ["sigue cada uno a un lado", "still_three_wide_2"],
    ["se mantiene a los lados", "still_three_wide_3"],

    // Banderas (Urgencia media-alta)
    ["bandera azul", "blue_flag"],
    ["amarilla", "yellow_flag"],
    ["verde", "green_flag"],
    ["última vuelta", "white_flag"],
    ["bandera a cuadros", "checkered_flag"],

    // Pit / Estrategia (Instrucciones claras)
    ["box en esta vuelta", "pbox"],
    ["box esta vuelta", "pbox_this_lap"],
    ["box próxima vuelta", "pbox_next_lap"],
    ["quédate fuera", "stay_out"],
    ["entrada a boxes", "pit_entry"],
    ["salida de boxes", "pit_exit"],

    // Comandos tácticos (Motivación + Urgencia)
    ["empuja ahora", "push"],
    ["empuja fuerte", "push_hard"],
    ["ahorra combustible", "save_fuel"],
    ["cuida los neumáticos", "manage_tires"],
    ["vuelta rápida", "fast_lap"],

    // Alertas críticas (MÁXIMA URGENCIA)
    ["daños detectados", "damage"],
    ["combustible bajo", "low_fuel"],
    ["combustible justo para última vuelta", "last_lap_fuel"],
    ["combustible crítico", "fuel_critical"],

    // Clima (Advertencia)
    ["lluvia aproximándose", "rain_incoming"],
    ["pista secándose", "track_drying"],

    // Posición (Información neutra)
    ["líder", "leader"],
    ["posición dos", "p2"],
    ["posición tres", "p3"],
    ["última posición", "last_place"],

    // Tiempo / Pace (Feedback)
    ["más rápido que el líder", "faster_than_leader"],
    ["perdiendo tiempo", "losing_time"],
    ["buen ritmo", "good_pace"],

    // Extras útiles (Motivación)
    ["buen trabajo", "nice_work"],
    ["mantén el ritmo", "keep_it_up"],
    ["concéntrate", "focus"],
    ["recibido", "copy"],
  ]);

  constructor() {
    // Constructor sin log verbose
  }



  /**
   * Inicializa el AudioContext (debe llamarse tras interacción del usuario)
   */
  public async initialize(): Promise<void> {
    if (this.audioContext) return;

    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    try {
      const spotterResponse = await fetch("/audio/spotter/spotter-manifest.json");
      if (spotterResponse.ok) {
        const spotterData = await spotterResponse.json();
        if (spotterData.variants && Object.keys(spotterData.variants).length > 0) {
          this.spotterManifest = spotterData.variants;
          this.manifestLoaded = true;
          const totalVariants = Object.values(this.spotterManifest).reduce((sum, arr) => sum + arr.length, 0);
          console.log(`[SpotterAudio] ✅ Manifest: ${Object.keys(this.spotterManifest).length} keys, ${totalVariants} files`);
          return;
        }
      }
    } catch (error) {
      // Fallback to manifest.json
    }

    try {
      const mainResponse = await fetch("/audio/spotter/manifest.json");
      if (!mainResponse.ok) {
        throw new Error(`HTTP ${mainResponse.status}`);
      }
      
      const mainData = await mainResponse.json();
      if (!mainData.files || !Array.isArray(mainData.files)) {
        throw new Error("Invalid manifest structure");
      }

      const variantsMap: Record<string, string[]> = {};
      for (const file of mainData.files) {
        const filename = file.filename;
        const match = filename.match(/^(.+?)(_v\d+)\.mp3$/);
        if (match) {
          const baseKey = match[1];
          if (!variantsMap[baseKey]) {
            variantsMap[baseKey] = [];
          }
          variantsMap[baseKey].push(filename);
        }
      }

      this.spotterManifest = variantsMap;
      this.manifestLoaded = true;
      console.log(`[SpotterAudio] ✅ Manifest (fallback): ${Object.keys(this.spotterManifest).length} keys`);
    } catch (error) {
      console.warn("[SpotterAudio] No manifest found");
    }

    // Cargar FX2 y STATICFX en segundo plano (opcionales)
    fetch('/audio/FX/FX2.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => this.audioContext!.decodeAudioData(ab))
      .then(buf => { this.fxSpotter = buf; })
      .catch(() => {});

    fetch('/audio/FX/STATICFX.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => this.audioContext!.decodeAudioData(ab))
      .then(buf => { this.fxStatic = buf; })
      .catch(() => {});
  }

  /**
   * 🎯 Normaliza texto para búsqueda (elimina puntuación, minúsculas)
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[¡!¿?,.\-:;()]/g, "")
      .trim();
  }

  /**
   * 🎭 Verifica si existe audio pregrabado para una clave
   */
  public hasSpotterPhrase(key: string): boolean {
    if (!this.manifestLoaded) {
      return false;
    }
    return this.spotterManifest[key] !== undefined && this.spotterManifest[key].length > 0;
  }

  /**
   * 🎭 Obtiene una variante aleatoria de un audio pre-generado
   * NOTA: Los archivos en spotter-manifest.json YA incluyen la extensión .mp3
   */
  private getRandomVariant(key: string): string | null {
    if (!this.manifestLoaded || !this.spotterManifest[key]) {
      console.warn(`[SpotterAudio] ⚠️ No variants found for key: "${key}" (manifestLoaded: ${this.manifestLoaded})`);
      return null;
    }

    const variants = this.spotterManifest[key];
    if (variants.length === 0) {
      console.warn(`[SpotterAudio] ⚠️ Empty variants array for key: "${key}"`);
      return null;
    }

    const randomIndex = Math.floor(Math.random() * variants.length);
    const selectedFile = variants[randomIndex];
    
    // Los archivos en el manifest YA incluyen .mp3, quitamos la extensión
    const fileWithoutExt = selectedFile.replace(/\.mp3$/, "");
    return fileWithoutExt;
  }

  /**
   * 🔍 Intenta descubrir variantes de archivos (fallback cuando manifest falla)
   * Busca archivos como: key_v1.mp3, key_v2.mp3, key_v3.mp3, key_v4.mp3
   */
  private async discoverVariants(baseKey: string): Promise<string | null> {
    // Intentar cargar variantes comunes (_v1 a _v5)
    const variantSuffixes = ['_v1', '_v2', '_v3', '_v4', '_v5'];
    const availableVariants: string[] = [];

    for (const suffix of variantSuffixes) {
      const variantKey = baseKey + suffix;
      const url = `/audio/spotter/${variantKey}.mp3`;
      
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
          availableVariants.push(variantKey);
        }
      } catch (error) {
        // Archivo no existe, continuar
      }
    }

    if (availableVariants.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableVariants.length);
      return availableVariants[randomIndex];
    }
    return null;
  }

  /**
   * 🎯 Reproduce archivo local
   */
  private async playLocalFile(
    filename: string,
    priority: number = 5,
  ): Promise<void> {
    if (!this.audioContext) {
      console.error('[SpotterAudio] ❌ AudioContext not initialized');
      throw new Error('AudioContext not initialized');
    }

    try {
      const url = `/audio/spotter/${filename}.mp3`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load: ${filename}.mp3 (HTTP ${response.status})`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      if (arrayBuffer.byteLength < 2000) {
        throw new Error(`File too small: ${arrayBuffer.byteLength} bytes (probably 404 page)`);
      }
      
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.enqueueAudio(audioBuffer, priority);
    } catch (error) {
      console.error(`[SpotterAudio] ❌ Failed to load: ${filename}.mp3`, error);
      console.error(`[SpotterAudio] 💡 Full path attempted: /audio/spotter/${filename}.mp3`);
      throw error;
    }
  }



  /**
   * 🎯 Reproduce una frase del spotter usando el sistema de claves
   */
  public async playSpotterPhrase(key: string): Promise<void> {
    if (!this.audioContext) {
      console.error("[SpotterAudio] ❌ AudioContext not initialized");
      throw new Error("AudioContext not initialized. Call initialize() first.");
    }

    try {
      let filename = this.getRandomVariant(key);

      if (!filename) {
        filename = await this.discoverVariants(key);
      }

      if (!filename) {
        console.error(`[SpotterAudio] No audio for key: "${key}"`);
        throw new Error(`No audio file found for spotter key: ${key}`);
      }

      await this.playLocalFile(filename, 10);
    } catch (error) {
      console.error(`[SpotterAudio] ❌ Playback failed for key: "${key}"`, error);
      throw error;
    }
  }

  /**
   * Añade audio a la cola de reproducción
   */
  private enqueueAudio(buffer: AudioBuffer, priority: number): void {
    // Si hay audio reproduciéndose con menor prioridad, interrumpirlo
    if (this.isPlaying && this.currentPriority < priority) {
      this.stop();
      this.audioQueue = this.audioQueue.filter(item => item.priority >= priority);
    }

    // Limitar tamaño de la cola
    if (this.audioQueue.length >= this.MAX_QUEUE_SIZE) {
      const minPriorityIndex = this.audioQueue.reduce(
        (minIdx, item, idx, arr) => (item.priority < arr[minIdx].priority ? idx : minIdx),
        0
      );
      this.audioQueue.splice(minPriorityIndex, 1);
    }

    this.audioQueue.push({ buffer, priority });
    this.audioQueue.sort((a, b) => b.priority - a.priority);

    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Arranca STATICFX en loop bajo la voz del spotter
   */
  private startStatic(atTime: number): void {
    if (!this.fxStatic || !this.audioContext) return;
    this.stopStatic();

    this.staticGain = this.audioContext.createGain();
    this.staticGain.gain.setValueAtTime(0, atTime);
    this.staticGain.gain.linearRampToValueAtTime(0.07, atTime + 0.05);
    this.staticGain.connect(this.audioContext.destination);

    this.staticSource = this.audioContext.createBufferSource();
    this.staticSource.buffer = this.fxStatic;
    this.staticSource.loop = true;
    this.staticSource.connect(this.staticGain);
    this.staticSource.start(atTime);
  }

  /**
   * Para STATICFX con fade rápido
   */
  private stopStatic(): void {
    if (!this.staticSource || !this.staticGain || !this.audioContext) return;
    const t = this.audioContext.currentTime;
    this.staticGain.gain.cancelScheduledValues(t);
    this.staticGain.gain.setValueAtTime(this.staticGain.gain.value, t);
    this.staticGain.gain.linearRampToValueAtTime(0, t + 0.08);
    const src = this.staticSource;
    setTimeout(() => { try { src.stop(); } catch { /* ignore */ } }, 120);
    this.staticSource = null;
    this.staticGain = null;
  }

  /**
   * Toca FX2 (click de apertura/cierre del spotter) en un offset de tiempo
   */
  private playFX2(atTime: number, gain: number = 0.36): void {
    if (!this.fxSpotter || !this.audioContext) return;
    const g = this.audioContext.createGain();
    g.gain.value = gain;
    g.connect(this.audioContext.destination);
    const src = this.audioContext.createBufferSource();
    src.buffer = this.fxSpotter;
    src.connect(g);
    src.start(atTime);
  }

  /**
   * Reproduce el siguiente audio en la cola
   */
  private playNext(): void {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    const { buffer, priority } = this.audioQueue.shift()!;
    this.currentPriority = priority;
    this.isPlaying = true;

    const ctx = this.audioContext!;
    const now = ctx.currentTime;

    // FX2 open click + static al inicio
    const startDelay = this.fxSpotter ? Math.min(this.fxSpotter.duration, 0.08) : 0;
    this.playFX2(now);
    this.startStatic(now + startDelay * 0.5);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // 🔊 Aplicar cadena de efectos de radio
    try {
      const outputNode = this.createRadioEffectChain(source);
      outputNode.connect(ctx.destination);
    } catch (error) {
      console.error("[SpotterAudio] Error creating radio effects, using direct connection:", error);
      source.connect(ctx.destination);
    }

    source.onended = () => {
      this.currentSource = null;
      // Static fade out + FX2 close click al final
      this.stopStatic();
      this.playFX2(ctx.currentTime + 0.05);
      this.playNext();
    };

    this.currentSource = source;
    source.start(now + startDelay);
  }

  /**
   * Detiene la reproducción actual
   */
  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Ignorar errores si ya se detuvo
      }
      this.currentSource = null;
    }
    this.stopStatic();
    this.isPlaying = false;
  }

  /**
   * Limpia la cola de audio
   */
  public clearQueue(): void {
    this.audioQueue = [];
    this.stop();
  }

  /**
   * Verifica si hay audio reproduciéndose
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Crea una cadena de efectos para simular audio de radio de carreras
   * @param source - Nodo fuente de audio
   * @returns El último nodo de la cadena (para conectar al destino)
   */
  private createRadioEffectChain(source: AudioBufferSourceNode): AudioNode {
    if (!this.audioContext) {
      throw new Error("AudioContext not initialized");
    }

    // ✨ SINCRONIZADO CON GEMINI LIVE - Estilo radio F1
    // Parámetros idénticos para que Spotter e Ingeniero suenen igual

    // 1. High-pass filter: Elimina graves profundos
    const highpassFilter = this.audioContext.createBiquadFilter();
    highpassFilter.type = "highpass";
    highpassFilter.frequency.value = 350; // Igual que Gemini
    highpassFilter.Q.value = 0.5; // Menos pendiente para naturalidad

    // 2. Low-pass filter: Elimina agudos (F1 radio style)
    const lowpassFilter = this.audioContext.createBiquadFilter();
    lowpassFilter.type = "lowpass";
    lowpassFilter.frequency.value = 3000; // Más estrecho para sonido más "radio"
    lowpassFilter.Q.value = 0.5;

    // 3. WaveShaper: Distorsión analógica moderada (estilo F1)
    const distortion = this.audioContext.createWaveShaper();
    const curve = this.makeDistortionCurve(30);
    // @ts-ignore - TypeScript strict type checking for ArrayBuffer vs ArrayBufferLike
    distortion.curve = curve; // Más distorsión para radio característico
    distortion.oversample = "2x";

    // 4. Compressor: Moderado (no extremo)
    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -30; // Menos sensible
    compressor.knee.value = 40;
    compressor.ratio.value = 4; // Más natural que 12
    compressor.attack.value = 0.01; // 10ms
    compressor.release.value = 0.25; // 250ms

    // 5. Gain: Más bajo que Gemini para spotter en segundo plano
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.8; // Spotter más bajo (Gemini usa 1.2)

    // Conectar la cadena en serie
    source.connect(highpassFilter);
    highpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(distortion);
    distortion.connect(compressor);
    compressor.connect(gainNode);

    // Retornar el último nodo de la cadena
    return gainNode;
  }

  /**
   * Genera una curva de distorsión sigmoide suave
   * @param amount - Cantidad de distorsión (valores más altos = más distorsión)
   * @returns Float32Array con la curva de transferencia
   */
  private makeDistortionCurve(amount: number): Float32Array {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Fórmula sigmoide suave para distorsión analógica
      curve[i] =
        ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }

    return curve as Float32Array;
  }
}
