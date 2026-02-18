/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Blob } from "@google/genai";

function encode(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // convert float32 -1 to 1 to int16 -32768 to 32767
    int16[i] = data[i] * 32768;
  }

  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: "audio/pcm;rate=16000",
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const buffer = ctx.createBuffer(
    numChannels,
    data.length / 2 / numChannels,
    sampleRate,
  );

  const dataInt16 = new Int16Array(data.buffer);
  const l = dataInt16.length;
  const dataFloat32 = new Float32Array(l);
  for (let i = 0; i < l; i++) {
    dataFloat32[i] = dataInt16[i] / 32768.0;
  }
  // Extract interleaved channels
  if (numChannels === 0) {
    buffer.copyToChannel(dataFloat32, 0);
  } else {
    for (let i = 0; i < numChannels; i++) {
      const channel = dataFloat32.filter(
        (_, index) => index % numChannels === i,
      );
      buffer.copyToChannel(channel, i);
    }
  }

  return buffer;
}

/**
 * 🎙️ Formatea segundos a texto natural para TTS
 * Ejemplos:
 *   54.234 → "54 punto 2 segundos"
 *   84.567 → "1 minuto 24 punto 6"
 *   125.890 → "2 minutos 5 punto 9"
 */
export function formatTimeForSpeech(seconds: number): string {
  if (!seconds || seconds === 0 || seconds > 9999) return "sin tiempo";

  const totalSeconds = Math.floor(seconds);
  const decimal = Math.round((seconds - totalSeconds) * 10); // Redondear a 1 dígito

  if (totalSeconds < 60) {
    // Menos de 1 minuto: "54 punto 2 segundos"
    return `${totalSeconds} punto ${decimal} segundos`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  // Más de 1 minuto: "1 minuto 24 punto 6" (sin "segundos" al final)
  const minuteText = minutes === 1 ? "minuto" : "minutos";
  return `${minutes} ${minuteText} ${remainingSeconds} punto ${decimal}`;
}

/**
 * 🎙️ Formatea milisegundos a texto natural para TTS
 * Convierte ms a segundos y usa formatTimeForSpeech
 */
export function formatMillisecondsForSpeech(ms: number): string {
  if (!ms || ms === 0 || ms > 999999) return "sin tiempo";
  return formatTimeForSpeech(ms / 1000);
}

/**
 * 🎙️ Formatea un delta de tiempo para TTS
 * Ejemplos:
 *   324 ms → "3 décimas más rápido"
 *   -150 ms → "1 décima más lento"
 *   50 ms → "5 centésimas más rápido"
 */
export function formatDeltaForSpeech(deltaMs: number): string {
  if (!deltaMs || Math.abs(deltaMs) < 10) return "mismo tiempo";

  const absDelta = Math.abs(deltaMs);
  const faster = deltaMs < 0; // Negativo = más rápido
  const direction = faster ? "más rápido" : "más lento";

  // Si es más de 1 segundo, hablar en segundos
  if (absDelta >= 1000) {
    const seconds = (absDelta / 1000).toFixed(1);
    return `${seconds.replace(".", " punto ")} segundos ${direction}`;
  }

  // Si es más de 100ms, hablar en décimas
  if (absDelta >= 100) {
    const tenths = Math.round(absDelta / 100);
    const tenthsText = tenths === 1 ? "décima" : "décimas";
    return `${tenths} ${tenthsText} ${direction}`;
  }

  // Menos de 100ms, hablar en centésimas
  const hundredths = Math.round(absDelta / 10);
  const hundredthsText = hundredths === 1 ? "centésima" : "centésimas";
  return `${hundredths} ${hundredthsText} ${direction}`;
}

export { createBlob, decode, decodeAudioData, encode };
