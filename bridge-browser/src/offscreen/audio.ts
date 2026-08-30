const PLAY_ATTENTION_SOUND = "PLAY_ATTENTION_SOUND";

type LogSoundType = "info" | "success" | "warn" | "error" | "action";

type ToneStep = {
  frequency: number;
  duration: number;
  gap?: number;
  type?: OscillatorType;
};

const SOUND_PATTERNS: Record<LogSoundType, ToneStep[]> = {
  info: [
    { frequency: 660, duration: 0.12 },
    { frequency: 880, duration: 0.16 },
  ],
  success: [
    { frequency: 784, duration: 0.12 },
    { frequency: 1046.5, duration: 0.22 },
  ],
  warn: [
    { frequency: 523.25, duration: 0.14, type: "triangle" },
    { frequency: 392, duration: 0.24, type: "triangle" },
  ],
  error: [
    { frequency: 220, duration: 0.16, type: "square" },
    { frequency: 196, duration: 0.26, type: "square" },
  ],
  action: [
    { frequency: 880, duration: 0.08 },
    { frequency: 987.77, duration: 0.08 },
    { frequency: 1174.66, duration: 0.16 },
  ],
};

let audioContext: AudioContext | null = null;

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!isRecord(request) || request.type !== PLAY_ATTENTION_SOUND) {
    return false;
  }

  const logType = getLogSoundType(request.logType);
  void playAttentionSound(logType)
    .then(() => sendResponse({ success: true }))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

async function playAttentionSound(logType: LogSoundType): Promise<void> {
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }

  const pattern = SOUND_PATTERNS[logType];
  const start = context.currentTime + 0.01;
  const output = context.createGain();
  const totalDuration = pattern.reduce((sum, tone) => sum + tone.duration + (tone.gap ?? 0.03), 0);
  output.gain.setValueAtTime(0.0001, start);
  output.gain.linearRampToValueAtTime(0.1, start + 0.02);
  output.gain.exponentialRampToValueAtTime(0.0001, start + totalDuration + 0.06);
  output.connect(context.destination);

  let cursor = start;
  for (const tone of pattern) {
    playTone(context, output, tone, cursor);
    cursor += tone.duration + (tone.gap ?? 0.03);
  }

  window.setTimeout(() => {
    output.disconnect();
  }, Math.ceil((totalDuration + 0.2) * 1000));
}

function getAudioContext(): AudioContext {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextConstructor = window.AudioContext ?? getWebkitAudioContext();
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is not available.");
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

function getWebkitAudioContext(): typeof AudioContext | undefined {
  return (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function playTone(
  context: AudioContext,
  output: AudioNode,
  tone: ToneStep,
  start: number
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = tone.type ?? "sine";
  oscillator.frequency.setValueAtTime(tone.frequency, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(1, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);

  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  oscillator.stop(start + tone.duration + 0.03);
  oscillator.addEventListener(
    "ended",
    () => {
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true }
  );
}

function getLogSoundType(value: unknown): LogSoundType {
  return isLogSoundType(value) ? value : "action";
}

function isLogSoundType(value: unknown): value is LogSoundType {
  return value === "info" ||
    value === "success" ||
    value === "warn" ||
    value === "error" ||
    value === "action";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
