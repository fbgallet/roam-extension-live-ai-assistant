import { speechLanguage } from ".";

let stream;

export async function getMediaRecorderStream(audioChunk) {
  const options = {
    audio: true,
    mimeType: "audio/webm",
  };
  stream = await navigator.mediaDevices.getUserMedia(options);
  const mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      // save the data
      audioChunk.push(e.data);
    }
  };
  return mediaRecorder;
}

export function closeStream() {
  stream.getTracks().forEach((track) => {
    track.stop();
    track.enabled = false;
  });
  const audioContext = new AudioContext();
  audioContext.close;
  const microphone = audioContext.createMediaStreamSource(stream);
  microphone.disconnect;
}

export function getSpeechRecognitionAPI() {
  // Speech recognition settings
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = new SpeechRecognition();
  mic.continuous = true;
  mic.interimResults = true;
  // console.log(speechLanguage);
  if (speechLanguage !== "Browser default") mic.lang = speechLanguage;
  mic.maxAlternatives = 1;
  return mic;
}

export const webLangCodes = [
  "Browser default",
  "ar-SA", // Arabic (Saudi Arabia)
  "ca-ES", // Catalan (Spain)
  "de-DE", // German (Germany)
  "el-GR", // Greek (Greece)
  "en-AU", // English (Australia)
  "en-CA", // English (Canada)
  "en-IN", // English (India)
  "en-IE", // English (Ireland)
  "en-NZ", // English (New Zealand)
  "en-ZA", // English (South Africa)
  "en-GB", // English (United Kingdom)
  "en-US", // English (United States)
  "es-ES", // Spanish (Spain)
  "fr-CA", // French (Canada)
  "fr-FR", // French (France)
  "id-ID", // Indonesian (Indonesia)
  "it-IT", // Italian (Italy)
  "iw-IL", // Hebrew (Israel)
  "hi-IN", // Hindi (India)
  "hu-HU", // Hungarian (Hungary)
  "ja-JP", // Japanese (Japan)
  "ko-KR", // Korean (South Korea)
  "nl-BE", // Dutch (Belgium)
  "nl-NL", // Dutch (Netherlands)
  "no-NO", // Norwegian (Norway)
  "pl-PL", // Polish (Poland)
  "pt-BR", // Portuguese (Brazil)
  "pt-PT", // Portuguese (Portugal)
  "ru-RU", // Russian (Russia)
  "sv-SE", // Swedish (Sweden)
  "zh-CN", // Chinese (China)
  "zh-HK", // Chinese (Hong Kong)
  "zh-TW", // Chinese (Taiwan)
];

export const webAPIlanguages = [
  "en-US",
  "es-ES",
  "fr-FR",
  "de-DE",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "ru-RU",
  "zh-CN",
  "zh-TW",
  "da-DK",
  "fi-FI",
  "nb-NO",
  "sv-SE",
  "tr-TR",
  "ca-ES",
  "hu-HU",
];
