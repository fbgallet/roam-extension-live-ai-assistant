/**
 * Live (streaming) voice transcription through the OpenAI Realtime API.
 *
 * Unlike `transcribeAudio()` — which records a whole vocal note, then uploads it
 * to the /audio/transcriptions endpoint — this opens a WebSocket transcription
 * session, streams the microphone to it, and writes the transcript into the
 * currently focused Roam block as the user speaks. If the user presses Enter or
 * clicks in another block while dictating, the next words go to the new focused
 * block: the target is resolved at each flush, never captured once at start.
 *
 * Cost warning: a live model is billed per minute of streamed microphone audio
 * (gpt-live-transcribe: ~$0.017/min, ~4x the price of transcribing a recorded
 * note), whether or not anyone is speaking — hence the explicit start/stop.
 */

import {
  OPENAI_API_KEY,
  isLiveTranscriptionEnabled,
  liveSilenceTimeout,
  liveVoiceSensitivity,
  liveTranscriptionDelay,
  liveTranscriptionModel,
  whisperPrompt,
} from "..";
import { AppToaster } from "../components/Toaster";
import {
  getBlockContentByUid,
  insertBlockInCurrentView,
  isExistingBlock,
} from "../utils/roamAPI";
import {
  getTranscriptionLanguages,
  parseTranscriptionKeywords,
} from "./multimodalAI";
import { liveTranscriptionModels } from "./modelsInfo";

// GA Realtime endpoint. No `?model=` here: a model in the url is taken as the
// model of a REALTIME (voice agent) session, which refuses a transcription
// model — the transcription model belongs to `audio.input.transcription.model`.
// The session is instead bound to the ephemeral credentials created below with
// `session.type: "transcription"` (the beta `?intent=transcription` shape is now
// refused with "beta_api_shape_disabled").
const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
// How long the API may take to accept the session before giving up.
const SESSION_READY_TIMEOUT_MS = 8000;
// Delay left, after the session is created, for a rejection of our
// configuration to come back before considering the session usable.
const SESSION_UPDATE_GRACE_MS = 1500;
// Sample rate expected by the Realtime API for raw PCM input.
const SAMPLE_RATE = 24000;
// Samples per ScriptProcessor callback (~170ms at 24kHz): small enough to keep
// latency low, large enough to avoid flooding the socket with tiny frames.
const CHUNK_SIZE = 4096;
// Roam writes are batched: a delta arrives per word or so, and one transaction
// per word would flicker the editor and fight the user's caret.
const FLUSH_INTERVAL_MS = 400;
// How long to keep the socket open after stopping, to collect the transcript of
// the last utterance before closing.
const FINAL_EVENTS_DELAY_MS = 1500;

// Silence auto-pause. A live session is billed per minute of streamed audio,
// whether or not anyone speaks, so the microphone stops being sent after this
// much silence — the socket stays open, so speaking again resumes instantly,
// without a new session.
export const LIVE_SILENCE_TIMEOUTS = {
  Never: 0,
  "5 sec.": 5000,
  "10 sec.": 10000,
  "30 sec.": 30000,
  "1 min.": 60000,
  "2 min.": 120000,
};
/**
 * Coming back from a pause takes an actual voice, not just a sound. Loudness
 * and duration alone can't do it — typing is both loud and continuous — so the
 * deciding criterion is PERIODICITY: vocal cords produce a periodic wave, and
 * nothing on a desk does. A chunk counts as speech when it is, together:
 *  - `margin` times above the measured ambient noise (and never under `minRms`),
 *    so the gate adapts to the microphone and to the room;
 *  - periodic in the human pitch range (`minVoiced`, see voicedness()) — this is
 *    what a keystroke, a click or a door can't fake, whatever their loudness;
 *  - lasting `sustainMs`, to ignore a lone burst.
 */
export const LIVE_VOICE_SENSITIVITY = {
  // Loudness only, as the name says: the only setting where a whisper — which
  // has no pitch at all, being pure breath — can reopen the microphone.
  "High (any sound)": {
    margin: 2,
    minRms: 0.003,
    minVoiced: 0,
    strongVoiced: 0,
    maxCrest: 99,
    sustainMs: 100,
  },
  Medium: {
    margin: 3,
    minRms: 0.009,
    minVoiced: 0.5,
    strongVoiced: 0.72,
    maxCrest: 5,
    sustainMs: 250,
  },
  "Low (ignore noise)": {
    margin: 5,
    minRms: 0.015,
    minVoiced: 0.6,
    strongVoiced: 0.8,
    maxCrest: 3.5,
    sustainMs: 450,
  },
};
// Ceiling on the measured ambient level: however noisy the room, the gate must
// never become unreachable for a normal voice.
const MAX_NOISE_FLOOR = 0.02;
// Duration of one captured chunk, used to convert `sustainMs` into a number of
// consecutive chunks.
const CHUNK_MS = (CHUNK_SIZE / SAMPLE_RATE) * 1000;
// Chunks kept while muted, and re-sent on resume: the beginning of a word is
// what confirms it IS a word, so it must not be the part that gets cut off.
const PREFIX_CHUNKS = 3;

const isSocketOpen = (ws) => ws && ws.readyState === WebSocket.OPEN;

// Is Roam the window the user is actually in? `hasFocus()` is the right signal
// here: another window on top leaves the tab visible, but the user isn't
// looking at their blocks anymore.
const isRoamFocused = () =>
  typeof document.hasFocus !== "function" || document.hasFocus();

// Whether to offer live transcription at all. The setting is on by default —
// it only reveals a button, nothing is streamed nor billed before a click — but
// the feature runs on OpenAI's Realtime API only: without that key, the button
// could do nothing but fail, so it isn't shown.
export const isLiveTranscriptionAvailable = () =>
  !!isLiveTranscriptionEnabled && !!OPENAI_API_KEY;

// Only a live model can drive a continuously streaming session: the file
// transcription models (gpt-transcribe…) transcribe a committed turn, which is
// a different workflow. Never fall back to the file transcription setting.
const getLiveModel = () =>
  liveTranscriptionModels.includes(liveTranscriptionModel)
    ? liveTranscriptionModel
    : liveTranscriptionModels[0];

class LiveTranscriptionSession {
  constructor() {
    this.active = false;
    this.starting = false;
    this.stopping = false;
    this.sessionReady = false;
    // Settlers of the pending openSocket() promise, called by the session
    // acceptance / rejection events.
    this.resolveReady = null;
    this.rejectReady = null;
    this.createdGraceTimer = null;
    // Where the transcript is written: null = the focused Roam block.
    this.sink = null;
    // Silence gate state (see shouldSendChunk).
    this.paused = false;
    // Manual mute while an answer is streaming (chat mode).
    this.responsePaused = false;
    this.lastVoiceAt = 0;
    // When a key was last pressed, to keep keystrokes from reopening the gate.
    this.lastKeyAt = 0;
    this.onKeyDown = () => {
      this.lastKeyAt = performance.now();
    };
    // Measured ambient level, and how many consecutive chunks looked like a
    // voice, both used by the gate to decide when to resume (shouldSendChunk).
    this.noiseFloor = 0;
    this.voiceStreak = 0;
    this.sawVoiced = false;
    this.prefixBuffer = [];
    this.audioSentSinceCommit = false;
    this.ws = null;
    this.mediaStream = null;
    this.audioCtx = null;
    this.sourceNode = null;
    this.processor = null;
    this.flushTimer = null;
    // Text received but not yet written to Roam, as {itemId, text} segments.
    this.pending = [];
    // Per Realtime item: where its text was written, to reconcile the final
    // transcript with the deltas already inserted.
    this.items = new Map();
    // Items that produced at least one delta, so a final transcript is not
    // written twice when the text went to a sink (nothing is tracked there).
    this.deltasSeen = new Set();
    this.targetUid = null;
    // All Roam writes go through this promise chain, so that two flushes (or a
    // flush and a reconciliation) never read the same block content at once.
    this.queue = Promise.resolve();
    this.listeners = new Set();
  }

  isActive() {
    return this.active;
  }

  // `paused` means the session is open but the microphone isn't streamed
  // (silence gate, or an answer being generated), so the UI can tell
  // "listening" from "waiting for a word".
  getState() {
    return {
      active: this.active,
      paused: this.active && (this.paused || this.responsePaused),
      // Opening a session takes about a second (microphone, ephemeral key,
      // socket, session acceptance): the UI has to say so, or the user starts
      // dictating into a microphone that isn't streaming yet.
      connecting: this.starting,
    };
  }

  // Let the UI (recorder button) follow the session state.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.error(e);
      }
    });
  }

  async toggle(options) {
    if (this.active) await this.stop();
    else await this.start(options);
  }

  /**
   * @param {object} [options]
   * @param {{append: (text: string) => void}} [options.sink] - where the
   *   transcript goes. By default it is written in the focused Roam block; a
   *   sink redirects it elsewhere (the chat input, for instance), and then the
   *   caller owns the text — no block is created and nothing is reconciled.
   * @param {string} [options.targetUid] - block to write in until another one
   *   takes the focus. Clicking the button takes the focus away from the block
   *   being edited, so the caller can capture it beforehand and pass it here,
   *   rather than letting the first words land in a new block.
   */
  async start({ sink, targetUid } = {}) {
    // `active` is only set once everything is up, so a second click during the
    // connection would open a second microphone and a second billed session.
    if (this.active || this.starting) return;
    this.starting = true;
    this.sink = sink || null;
    this.targetUid = targetUid || null;
    this.notify();
    try {
      await this.connect();
    } finally {
      this.starting = false;
      if (!this.active) this.sink = null;
      this.notify();
    }
  }

  // Mute the microphone without closing the session, while an answer is being
  // generated (chat mode): the words dictated meanwhile would land in an input
  // the user has just emptied, and would be billed for nothing.
  pauseForResponse() {
    if (!this.active || this.responsePaused) return;
    this.responsePaused = true;
    this.voiceStreak = 0;
    this.commitTurn();
    // Whatever was dictated but not yet written belongs to the message just
    // sent: the user validated what they saw, not what is still in flight.
    this.pending = [];
    this.items.clear();
    this.deltasSeen.clear();
    this.notify();
  }

  // The end of an answer doesn't put the microphone back on the air: it hands
  // it over to the silence gate, still muted. Nothing is streamed — nor billed
  // — until the user actually speaks again, whatever the silence setting.
  resumeAfterResponse() {
    if (!this.active || !this.responsePaused) return;
    this.responsePaused = false;
    this.paused = true;
    this.lastVoiceAt = performance.now();
    this.notify();
  }

  async connect() {
    if (!OPENAI_API_KEY) {
      AppToaster.show({
        message:
          "Live transcription requires an OpenAI API key. Add it in Live AI settings.",
        intent: "warning",
        timeout: 8000,
      });
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (error) {
      console.error(error);
      AppToaster.show({
        message: `Microphone not available for live transcription: ${error.message}`,
        intent: "warning",
        timeout: 8000,
      });
      return;
    }

    this.sessionReady = false;
    try {
      await this.connectSession();
    } catch (error) {
      console.error(error);
      this.closeSocket();
      this.releaseMicrophone();
      AppToaster.show({
        message: `Live transcription connection failed: ${error.message}`,
        intent: "warning",
        timeout: 10000,
      });
      return;
    }

    this.paused = false;
    this.responsePaused = false;
    this.lastVoiceAt = 0;
    this.lastKeyAt = 0;
    // Measured ambient level, and how many consecutive chunks looked like a
    // voice, both used by the gate to decide when to resume (shouldSendChunk).
    this.noiseFloor = 0;
    this.voiceStreak = 0;
    this.sawVoiced = false;
    this.prefixBuffer = [];
    this.audioSentSinceCommit = false;
    try {
      await this.startAudioCapture();
    } catch (error) {
      // The capture pipeline registers a listener and holds the microphone from
      // its first line: failing here without undoing it would leave both behind
      // for a session that never starts.
      console.error(error);
      this.stopAudioCapture();
      this.closeSocket();
      this.releaseMicrophone();
      AppToaster.show({
        message: `Live transcription could not capture the microphone: ${error.message}`,
        intent: "warning",
        timeout: 10000,
      });
      return;
    }
    this.flushTimer = setInterval(
      () => this.scheduleFlush(),
      FLUSH_INTERVAL_MS,
    );
    this.active = true;
    this.stopping = false;
    this.notify();

    // Only when writing in Roam blocks: with a sink, the transcript goes to a
    // visible input whose own button carries the warning, and "inserted in the
    // focused block" would simply be false.
    if (!this.sink)
      AppToaster.show({
        message: `🎙️ Live transcription is running (${liveTranscriptionModel}): your words are inserted in the focused block. Remember to stop it, it is billed per minute of streamed audio (~$1/hour). It pauses after 10 seconds of silence by default.`,
        timeout: 8000,
      });
  }

  async stop() {
    if (!this.active) {
      // No session running, but a failed or half-opened start may have left the
      // keyboard listener, the microphone or the socket behind — and unloading
      // the extension doesn't unload Roam's document, so a stray listener would
      // outlive it. Every call below is a no-op when there is nothing to undo.
      this.stopAudioCapture();
      this.releaseMicrophone();
      this.closeSocket();
      return;
    }
    this.stopping = true;
    this.active = false;
    this.notify();

    // Stop capturing first, so nothing more is appended to the input buffer,
    // then ask the API to transcribe what has been sent but not yet committed.
    this.stopAudioCapture();
    if (isSocketOpen(this.ws) && this.audioSentSinceCommit) {
      this.commitTurn();
      await new Promise((resolve) =>
        setTimeout(resolve, FINAL_EVENTS_DELAY_MS),
      );
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.scheduleFlush();

    this.closeSocket();
    this.releaseMicrophone();
    this.items.clear();
    this.deltasSeen.clear();
    this.targetUid = null;
    const hadSink = !!this.sink;
    this.sink = null;
    this.responsePaused = false;
    this.stopping = false;

    if (!hadSink)
      AppToaster.show({ message: "Live transcription stopped.", timeout: 3000 });
  }

  // ==================== Realtime session ====================

  async connectSession() {
    const session = this.getSessionConfig().session;
    // A browser client connects with short-lived credentials rather than the API
    // key. They are minted here — there is no server in this extension, and the
    // key is already in the browser — carrying the session configuration: this
    // is what makes the socket a transcription session, since the url can't say
    // it. Connecting with the raw key instead gives an unconfigured session that
    // the API refuses ("missing_model", then "invalid_model"), so there is no
    // point falling back to it.
    let token;
    try {
      token = await createClientSecret(session);
    } catch (error) {
      throw new Error(
        `the transcription session could not be created (${error.message})`,
      );
    }
    await this.openSocket(REALTIME_URL, token);
  }

  // Resolves only once the API has ACCEPTED the session, not merely when the
  // socket is open: a rejected session (unsupported shape, unavailable model)
  // answers with an `error` event on an otherwise healthy connection.
  openSocket(url, token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (action, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(this.createdGraceTimer);
        this.resolveReady = null;
        this.rejectReady = null;
        action(arg);
      };
      const timer = setTimeout(
        () => settle(reject, new Error("no answer from the Realtime API")),
        SESSION_READY_TIMEOUT_MS,
      );
      this.resolveReady = () => settle(resolve);
      this.rejectReady = (error) => settle(reject, error);

      // Browsers can't set headers on a WebSocket, so the Realtime API takes the
      // credentials as a subprotocol instead.
      const ws = new WebSocket(url, [
        "realtime",
        "openai-insecure-api-key." + token,
      ]);
      this.ws = ws;

      ws.onopen = () => ws.send(JSON.stringify(this.getSessionConfig()));
      ws.onerror = (event) => {
        console.error("Live transcription socket error:", event);
        if (!settled) settle(reject, new Error("connection refused"));
        else if (this.active) this.handleSocketFailure();
      };
      ws.onclose = () => {
        if (!settled) settle(reject, new Error("connection closed"));
        else if (this.active) this.handleSocketFailure();
      };
      ws.onmessage = (event) => this.handleServerEvent(event);
    });
  }

  getSessionConfig() {
    const transcription = {
      model: getLiveModel(),
      prompt:
        "A personal voice note dictated by a single speaker into their note-taking app.",
      delay: liveTranscriptionDelay || "low",
    };
    // Same user settings as the file transcription: the vocabulary list becomes
    // `keywords`, the transcription language `languages`.
    const keywords = parseTranscriptionKeywords(whisperPrompt);
    if (keywords.length) transcription.keywords = keywords;
    const languages = getTranscriptionLanguages();
    if (languages) transcription.languages = languages;

    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            transcription,
            // The live model refuses turn detection ("Turn detection is not
            // supported for this transcription model"): it streams deltas as
            // speech arrives, without waiting for utterance boundaries. Turns
            // are only closed by the explicit commit sent on stop, to flush the
            // tail of the recording.
            turn_detection: null,
            noise_reduction: { type: "near_field" },
          },
        },
      },
    };
  }

  handleServerEvent(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    switch (message.type) {
      case "session.created":
      case "transcription_session.created":
        // The socket is up, but this is not yet the answer to our
        // session.update: leave a moment for a rejection of the configuration
        // to arrive, rather than declaring the session ready right away.
        this.createdGraceTimer = setTimeout(
          () => this.resolveReady && this.resolveReady(),
          SESSION_UPDATE_GRACE_MS,
        );
        break;
      case "session.updated":
      case "transcription_session.updated":
        // The API accepted our configuration: from here on, errors are
        // per-utterance and shouldn't bring the session down.
        this.sessionReady = true;
        if (this.resolveReady) this.resolveReady();
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (message.delta) this.pushText(message.item_id, message.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.completeItem(message.item_id, message.transcript);
        break;
      case "conversation.item.input_audio_transcription.failed":
        console.warn("Live transcription failed for an utterance:", message);
        break;
      case "error":
        // An empty commit on stop is expected (nothing was said since the last
        // utterance) and must not be reported as a failure.
        if (this.stopping) {
          console.log(
            "Error while stopping live transcription:",
            message.error,
          );
          break;
        }
        console.error("Live transcription error:", message.error);
        // Rejected before the session was accepted: let connectSession() try
        // the next endpoint instead of streaming — and billing — a microphone
        // whose audio will never be transcribed.
        if (!this.sessionReady) {
          if (this.rejectReady)
            this.rejectReady(
              new Error(message.error?.message || "session rejected"),
            );
          else if (this.active) this.teardown();
          break;
        }
        AppToaster.show({
          message: `Live transcription error: ${
            message.error?.message || "unknown error"
          }`,
          intent: "warning",
          timeout: 10000,
        });
        break;
      default:
        break;
    }
  }

  // The socket dropped while transcribing: tear everything down rather than
  // leaving the microphone open and the button lit with nothing behind it.
  handleSocketFailure() {
    AppToaster.show({
      message: "Live transcription connection lost, session stopped.",
      intent: "warning",
      timeout: 8000,
    });
    this.teardown();
  }

  // Immediate shutdown (on failure): unlike stop(), it doesn't wait for the
  // transcript of the last utterance — there is nothing left to wait for.
  teardown() {
    this.stopping = true;
    this.active = false;
    this.notify();
    this.stopAudioCapture();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.scheduleFlush();
    this.closeSocket();
    this.releaseMicrophone();
    this.sink = null;
    this.responsePaused = false;
    this.stopping = false;
  }

  closeSocket() {
    if (!this.ws) return;
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;
    try {
      this.ws.close();
    } catch (e) {
      console.log(e.message);
    }
    this.ws = null;
  }

  // ==================== Microphone capture ====================

  async startAudioCapture() {
    document.addEventListener("keydown", this.onKeyDown, true);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    // Ask for the API's rate directly; when the browser refuses it (some Safari
    // versions), audio is resampled in the callback below.
    this.audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE });
    // An AudioContext created outside of a user gesture starts suspended: its
    // callbacks would never fire and the session would stream nothing while
    // still being billed.
    if (this.audioCtx.state === "suspended") {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("AudioContext could not be resumed:", e.message);
      }
    }
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioCtx.createScriptProcessor(CHUNK_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!isSocketOpen(this.ws)) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleTo(
        input,
        this.audioCtx.sampleRate,
        SAMPLE_RATE,
      );
      const chunk = floatTo16BitPCM(resampled);
      if (!this.shouldSendChunk(resampled, chunk)) return;
      this.sendAudio(chunk);
    };
    this.sourceNode.connect(this.processor);
    // A ScriptProcessorNode only runs when connected to a destination. Its
    // output buffer is left untouched (silence), so nothing is played back.
    this.processor.connect(this.audioCtx.destination);
  }

  sendAudio(chunk) {
    this.ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: bytesToBase64(chunk),
      }),
    );
    this.audioSentSinceCommit = true;
  }

  // Close the current audio turn. Turn detection being unsupported by the live
  // model, this is what produces the `completed` event carrying the final
  // transcript — and it keeps a silence from splicing two unrelated sentences
  // into one. Committing nothing is an error, hence the guard.
  commitTurn() {
    if (!isSocketOpen(this.ws) || !this.audioSentSinceCommit) return;
    this.audioSentSinceCommit = false;
    try {
      this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch (e) {
      console.log("Live transcription commit skipped:", e.message);
    }
  }

  /**
   * Silence gate, called for every captured chunk. Streaming silence costs as
   * much as streaming speech, so the audio stops being sent after the
   * configured silence, and starts again on the first word — the session itself
   * is never interrupted, so there is nothing to reconnect.
   * @returns {boolean} whether this chunk is to be sent
   */
  shouldSendChunk(samples, chunk) {
    // Muted for an answer in progress: only the caller resumes it.
    if (this.responsePaused) {
      this.bufferPrefix(chunk);
      return false;
    }

    const config =
      LIVE_VOICE_SENSITIVITY[liveVoiceSensitivity] ||
      LIVE_VOICE_SENSITIVITY.Medium;
    const rms = rmsOf(samples);
    const timeout = LIVE_SILENCE_TIMEOUTS[liveSilenceTimeout] ?? 0;
    const now = performance.now();
    const level = Math.max(config.minRms, this.noiseFloor * config.margin);
    const isLoud = rms >= level;

    // A noise in the room must not put the microphone back on the air while
    // Roam doesn't have the focus: the text would be dictated into a block the
    // user isn't even looking at — and billed — without any visible sign.
    if (this.paused && !isRoamFocused()) {
      this.voiceStreak = 0;
      this.sawVoiced = false;
      this.bufferPrefix(chunk);
      return false;
    }

    if (this.paused) {
      // The ambient level is measured while muted, but ONLY on quiet chunks:
      // feeding it the loud ones would raise the floor as the user speaks, and
      // the threshold would run away from the very voice meant to cross it.
      if (!isLoud)
        this.noiseFloor = Math.min(
          MAX_NOISE_FLOOR,
          this.noiseFloor ? this.noiseFloor * 0.9 + rms * 0.1 : rms,
        );

      // Every chunk of the streak must look like a voice on BOTH counts —
      // periodic like vocal cords, and sustained rather than struck. Counting
      // loud chunks and voiced chunks separately let a noise burst provide the
      // loudness while its own ringing tail provided the periodicity.
      const voiced = isLoud ? voicedness(samples, SAMPLE_RATE) : 0;
      // A key was just pressed: this chunk may contain its sound, so it has to
      // be convincingly voiced to count, not merely periodic enough. The
      // microphone is never shut for that — otherwise dictating while typing,
      // or right after a burst of typing, would be impossible.
      const afterKeystroke = now - this.lastKeyAt < KEYSTROKE_ECHO_MS;
      const voicedBar = afterKeystroke ? config.strongVoiced : config.minVoiced;
      const isVoiceLike =
        isLoud &&
        voiced >= voicedBar &&
        envelopeCrest(samples) <= config.maxCrest;
      if (isVoiceLike) {
        this.voiceStreak += 1;
        // …and one of them at least must be convincingly voiced, not merely
        // periodic enough: that is where a real voice separates from a tail.
        if (voiced >= config.strongVoiced) this.sawVoiced = true;
      } else {
        // Decay instead of reset: a stop consonant or the gap between two words
        // shouldn't cancel the words around it.
        this.voiceStreak = Math.max(0, this.voiceStreak - 1);
        if (!this.voiceStreak) this.sawVoiced = false;
      }
      const confirmed =
        this.sawVoiced && this.voiceStreak * CHUNK_MS >= config.sustainMs;
      if (!confirmed) {
        this.logGateRejection(rms, level, samples);
        this.bufferPrefix(chunk);
        return false;
      }
      console.log(
        `[Live transcription] resumed — rms ${rms.toFixed(
          4,
        )}, voicedness ${voicedness(samples, SAMPLE_RATE).toFixed(
          2,
        )}, crest ${envelopeCrest(samples).toFixed(1)}`,
      );
      this.paused = false;
      this.voiceStreak = 0;
      this.sawVoiced = false;
      this.lastVoiceAt = now;
      this.notify();
    } else {
      // Leaving Roam stops the streaming at once: the words would be dictated
      // into a block that is no longer on screen, and billed all the while.
      if (!isRoamFocused()) {
        this.mute(rms, chunk, "Roam lost the focus");
        return false;
      }
      // Once talking, plain loudness is enough to stay on the air: only a real
      // silence, held for the whole timeout, mutes the microphone again.
      if (isLoud || !this.lastVoiceAt) this.lastVoiceAt = now;
      if (timeout && !isLoud && now - this.lastVoiceAt >= timeout) {
        this.mute(rms, chunk, `${liveSilenceTimeout} of silence`);
        return false;
      }
    }

    // Resuming: the first syllables are in the buffered chunks, and they are
    // precisely what identified this as speech — send them before the current one.
    if (this.prefixBuffer.length) {
      this.prefixBuffer.forEach((buffered) => this.sendAudio(buffered));
      this.prefixBuffer = [];
    }
    return true;
  }

  // The gate depends on the microphone, its gain and the room: no threshold can
  // be right for everyone a priori. So every rejected chunk that was loud
  // enough to be a candidate is reported (at most once a second), to be able to
  // tell an over-strict level from an over-strict voicing or duration criterion.
  logGateRejection(rms, level, samples) {
    if (rms < level * 0.5) return;
    const now = performance.now();
    if (now - (this.lastGateLogAt || 0) < 1000) return;
    this.lastGateLogAt = now;
    const config =
      LIVE_VOICE_SENSITIVITY[liveVoiceSensitivity] ||
      LIVE_VOICE_SENSITIVITY.Medium;
    console.log(
      `[Live transcription] still paused — rms ${rms.toFixed(
        4,
      )} (threshold ${level.toFixed(4)}, ambient ${this.noiseFloor.toFixed(
        4,
      )}), voicedness ${voicedness(samples, SAMPLE_RATE).toFixed(2)} (min ${
        config.minVoiced
      }, strong ${config.strongVoiced}), crest ${envelopeCrest(samples).toFixed(
        1,
      )} (max ${config.maxCrest}), streak ${this.voiceStreak}/${Math.ceil(
        config.sustainMs / CHUNK_MS,
      )}, strongly voiced ${!!this.sawVoiced}${
        performance.now() - this.lastKeyAt < KEYSTROKE_ECHO_MS
          ? " [just typed: strong bar]"
          : ""
      }`,
    );
  }

  // Stop streaming the microphone, keeping the session open: the current turn
  // is closed so its transcript comes back, and the ambient level is re-seeded
  // for the gate that now guards the way back.
  mute(rms, chunk, reason) {
    this.paused = true;
    this.voiceStreak = 0;
    this.sawVoiced = false;
    this.noiseFloor = rms;
    this.bufferPrefix(chunk);
    this.commitTurn();
    this.notify();
    console.log(
      `[Live transcription] paused (${reason}) — not billed until you speak again.`,
    );
  }

  // Rolling buffer of the last chunks captured while muted.
  bufferPrefix(chunk) {
    this.prefixBuffer.push(chunk);
    if (this.prefixBuffer.length > PREFIX_CHUNKS) this.prefixBuffer.shift();
  }

  stopAudioCapture() {
    document.removeEventListener("keydown", this.onKeyDown, true);
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch (e) {}
      this.processor = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (e) {}
      this.audioCtx = null;
    }
  }

  releaseMicrophone() {
    if (!this.mediaStream) return;
    this.mediaStream.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  // ==================== Insertion in Roam ====================

  // Deltas are queued per utterance (item): two of them can be pending at once,
  // and each has to keep its own id for the final reconciliation.
  pushText(itemId, text) {
    // Tail of what was already sent for transcription when the microphone was
    // muted: it belongs to the message just validated, not to the next one.
    if (this.responsePaused) return;
    this.deltasSeen.add(itemId);
    const last = this.pending[this.pending.length - 1];
    if (last && last.itemId === itemId) last.text += text;
    else this.pending.push({ itemId, text });
  }

  scheduleFlush() {
    return this.enqueue(() => this.flush());
  }

  enqueue(task) {
    this.queue = this.queue.then(task).catch((e) => {
      console.error("Live transcription insertion failed:", e);
    });
    return this.queue;
  }

  async flush() {
    while (this.pending.length) {
      const { itemId, text } = this.pending.shift();
      if (this.sink) {
        await this.sink.append(text);
        continue;
      }
      const uid = await this.resolveTargetUid();
      if (!uid) return;
      await this.appendToBlock(uid, text, itemId);
    }
  }

  // The insertion point follows the user: whatever block is focused when the
  // text is written receives it. Without focus, the last used block is kept
  // (the user clicked away), and as a last resort a new block is created.
  async resolveTargetUid() {
    const focusedUid =
      window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"] || null;
    if (focusedUid) {
      this.targetUid = focusedUid;
      return focusedUid;
    }
    if (this.targetUid && isExistingBlock(this.targetUid))
      return this.targetUid;
    this.targetUid = await insertBlockInCurrentView("");
    return this.targetUid;
  }

  async appendToBlock(uid, text, itemId) {
    const current = getBlockContentByUid(uid) || "";
    // Deltas usually come with their own leading space: only one separator is
    // wanted between what is already there and what is dictated.
    const chunk = /\s$/.test(current) ? text.replace(/^\s+/, "") : text;
    if (!chunk) return;
    const separator =
      current && !/^\s/.test(chunk) && !/\s$/.test(current) ? " " : "";
    const newContent = current + separator + chunk;
    await window.roamAlphaAPI.updateBlock({
      block: { uid, string: newContent },
    });
    this.restoreCaret(uid, newContent.length);

    if (!itemId) return;
    const item = this.items.get(itemId);
    if (!item) {
      this.items.set(itemId, {
        uid,
        start: current.length + separator.length,
        written: chunk,
      });
    } else if (item.uid !== uid) {
      // The user moved to another block in the middle of an utterance: its text
      // is split across blocks and can't be reconciled as one span anymore.
      item.split = true;
    } else {
      item.written += separator + chunk;
    }
  }

  // Keep the caret at the end of the dictated text, so the user can go on
  // typing or press Enter to continue in a new block.
  restoreCaret(uid, position) {
    const focused = window.roamAlphaAPI.ui.getFocusedBlock();
    if (!focused || focused["block-uid"] !== uid) return;
    try {
      window.roamAlphaAPI.ui.setBlockFocusAndSelection({
        location: focused,
        selection: { start: position },
      });
    } catch (e) {
      console.log(e.message);
    }
  }

  // The `completed` event carries the final (possibly corrected) transcript of
  // an utterance. Replace the text streamed so far when it still is where we
  // wrote it — if the user edited or moved it in the meantime, leave it alone.
  completeItem(itemId, transcript) {
    if (this.responsePaused) return;
    this.enqueue(async () => {
      await this.flush();
      // With a sink, the text belongs to the caller as soon as it is handed
      // over (it may already have been edited or sent): only the deltas are
      // written, never rewritten.
      if (this.sink) {
        if (transcript && !this.deltasSeen.has(itemId))
          await this.sink.append(transcript);
        this.deltasSeen.delete(itemId);
        return;
      }
      const item = this.items.get(itemId);
      if (!transcript) {
        this.items.delete(itemId);
        return;
      }
      if (!item) {
        // No delta was received (e.g. a high `delay` setting): insert the whole
        // transcript as if it were one.
        const uid = await this.resolveTargetUid();
        if (uid) await this.appendToBlock(uid, transcript, itemId);
        this.items.delete(itemId);
        return;
      }
      this.items.delete(itemId);
      if (item.split) return;
      // Align with how the deltas were inserted, to not reintroduce the leading
      // space that appendToBlock stripped.
      const finalText = /^\s/.test(item.written)
        ? transcript
        : transcript.replace(/^\s+/, "");
      if (finalText === item.written) return;
      const content = getBlockContentByUid(item.uid);
      if (!content) return;
      const index = content.indexOf(item.written, Math.max(0, item.start - 10));
      if (index === -1) return;
      const newContent =
        content.slice(0, index) +
        finalText +
        content.slice(index + item.written.length);
      if (newContent === content) return;
      await window.roamAlphaAPI.updateBlock({
        block: { uid: item.uid, string: newContent },
      });
      this.restoreCaret(item.uid, index + finalText.length);
    });
  }
}

// Ephemeral credentials for the WebSocket connection, created with the session
// already configured (`session.type: "transcription"`), so the socket is a
// transcription session from the start.
async function createClientSecret(session) {
  console.log("Live transcription session requested :>> ", session);
  const response = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session }),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    let message = body;
    try {
      message = JSON.parse(body)?.error?.message || body;
    } catch (e) {}
    throw new Error(`${response.status} — ${message}`.trim());
  }
  const data = JSON.parse(body);
  if (!data?.value) throw new Error("no client secret returned");
  return data.value;
}

// ==================== Audio helpers ====================

// Linear resampling, only used when the browser refuses an AudioContext at the
// API's rate (no anti-aliasing filter: speech quality is unaffected in practice).
function resampleTo(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    output[i] =
      input[index] + (input[next] - input[index]) * (position - index);
  }
  return output;
}

// Root-mean-square amplitude (0..1) of a chunk, used as a cheap voice detector.
function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

// Human pitch range searched for periodicity, in Hz.
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 350;
// The signal is averaged by this factor before the search: it acts as a crude
// low-pass (pitch lives well below 3kHz) and divides the cost by ~16.
const PITCH_DECIMATION = 4;
// One-pole high-pass coefficient (~80Hz at the decimated rate), to drop the
// rumble that would otherwise dominate the correlation.
const RUMBLE_FILTER = 0.93;
// Correlation under which the autocorrelation is considered to have left its
// trivial lag-0 value, so that what follows can be read as a real pitch peak.
const CORRELATION_DIP = 0.3;
// Sub-windows (~10ms each) used to measure how uneven a chunk's loudness is.
const ENVELOPE_WINDOWS = 16;
// How long a captured chunk may still carry the sound of a key that was just
// pressed. Within that window the bar is raised (see shouldSendChunk) rather
// than the microphone being shut: muting while typing would forbid dictating
// and typing at once, and typing continuously would forbid dictating at all.
const KEYSTROKE_ECHO_MS = 250;

/**
 * How periodic a chunk is in the human pitch range: the best normalized
 * autocorrelation over the lags matching 70–350 Hz, in 0..1.
 *
 * This is what tells a voice from everything else on a desk at equal loudness:
 * vocal cords repeat a waveform dozens of times per chunk (~0.6–0.95 here),
 * while a keystroke, a click or a chair are impulsive and don't repeat (<0.3).
 * Loudness and duration can't do it — typing is both loud and continuous.
 * Caveat: a whisper has no pitch either, and only crosses the lowest setting.
 */
function voicedness(samples, sampleRate) {
  const rate = sampleRate / PITCH_DECIMATION;
  const length = Math.floor(samples.length / PITCH_DECIMATION);
  const minLag = Math.floor(rate / MAX_PITCH_HZ);
  const maxLag = Math.floor(rate / MIN_PITCH_HZ);
  if (length <= maxLag + 1) return 0;

  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < PITCH_DECIMATION; j++)
      sum += samples[i * PITCH_DECIMATION + j];
    signal[i] = sum / PITCH_DECIMATION;
  }
  // One-pole high-pass (~80Hz): desk rumble and handling noise sit below the
  // pitch range but dominate the correlation if left in.
  let previousIn = 0;
  let previousOut = 0;
  for (let i = 0; i < length; i++) {
    const out = RUMBLE_FILTER * (previousOut + signal[i] - previousIn);
    previousIn = signal[i];
    previousOut = out;
    signal[i] = out;
  }

  const correlationAt = (lag) => {
    let corr = 0;
    let energy = 0;
    let laggedEnergy = 0;
    for (let i = 0; i + lag < length; i++) {
      corr += signal[i] * signal[i + lag];
      energy += signal[i] * signal[i];
      laggedEnergy += signal[i + lag] * signal[i + lag];
    }
    const norm = Math.sqrt(energy * laggedEnergy);
    return norm ? corr / norm : 0;
  };

  // A real pitch shows up as a PEAK, so the correlation must first fall away
  // from its trivial value at lag 0. Without this, any slowly varying signal
  // scores ~1 at the shortest lags and passes for a voice.
  let dipLag = 0;
  for (let lag = 2; lag <= maxLag; lag++) {
    if (correlationAt(lag) < CORRELATION_DIP) {
      dipLag = lag;
      break;
    }
  }
  if (!dipLag) return 0;

  let best = 0;
  for (let lag = Math.max(minLag, dipLag); lag <= maxLag; lag++)
    best = Math.max(best, correlationAt(lag));
  return best;
}

/**
 * How uneven the loudness is inside a chunk: loudest tenth of it over the
 * median. A vowel is sustained (~1.5–2.5); a keystroke is a spike followed by
 * silence, so it stays high (>5) even when its ringing makes it look periodic.
 * This is what separates a struck object from a voice when both resonate.
 */
function envelopeCrest(samples) {
  const size = Math.floor(samples.length / ENVELOPE_WINDOWS);
  if (size < 8) return 1;
  const levels = [];
  for (let w = 0; w < ENVELOPE_WINDOWS; w++) {
    let sum = 0;
    for (let i = w * size; i < (w + 1) * size; i++) sum += samples[i] ** 2;
    levels.push(Math.sqrt(sum / size));
  }
  levels.sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)];
  return median > 0 ? levels[levels.length - 1] / median : 99;
}

function floatTo16BitPCM(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const liveTranscription = new LiveTranscriptionSession();

export const toggleLiveTranscription = () => liveTranscription.toggle();
export const stopLiveTranscription = () => liveTranscription.stop();
export const isLiveTranscriptionActive = () => liveTranscription.isActive();
