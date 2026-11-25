// All source material is generated once or synthesized on the Web Audio clock.
const bpm = 128;
const beat = 60 / bpm;
const tick = beat / 4;
const clamp = (value, max = 1) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
const hz = note => 440 * 2 ** ((note - 69) / 12);

let ctx, output, compressor, reverb, white, brown, audience, musicFilter;
let musicBuses, layerGains;
let muted = false;
let volume = 0.85;
let musicLevel = 0;
let crowdLevel = 0;
let origin = 0;
let nextStep = 0;
let musicTimer;
const loops = new Map();
try {
  muted = globalThis.localStorage?.getItem('aguanteMute') === 'true';
} catch {}

function smooth(param, value, seconds = 0.035) {
  param.setTargetAtTime(value, ctx.currentTime, seconds);
}

function gain(value, destination) {
  const node = ctx.createGain();
  node.gain.value = value;
  node.connect(destination);
  return node;
}

function filter(type, frequency, q, destination) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.connect(destination);
  return node;
}

function makeNoise(seconds, colored = false) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.random() * 2 - 1;
    low = low * 0.97 + sample * 0.16;
    data[i] = colored ? Math.tanh(low) : sample;
  }
  const fade = 256;
  for (let i = 0; i < fade; i++) {
    data[i] *= i / fade;
    data[data.length - 1 - i] *= i / fade;
  }
  return buffer;
}

function hallImpulse() {
  const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 2.5), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = Math.floor(ctx.sampleRate * 0.033); i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const noise = Math.random() * 2 - 1;
      low = low * 0.72 + noise * 0.28;
      data[i] = 0.16 * (noise * Math.exp(-5.4 * t) + low * Math.exp(-2.85 * t))
        * Math.min(1, (t - 0.033) * 35);
    }
    for (const [delay, amplitude] of [[0.028, 0.58], [0.046, 0.38], [0.071, 0.27], [0.113, 0.19]]) {
      data[Math.round((delay + channel * 0.004) * ctx.sampleRate)] += amplitude;
    }
  }
  return impulse;
}

function noiseSource(buffer, destination, looping = false) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = looping;
  source.connect(destination);
  return source;
}

function envelope(destination, time, amplitude, duration, attack) {
  const node = gain(0, destination);
  node.gain.setValueAtTime(0, time);
  node.gain.linearRampToValueAtTime(amplitude, time + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  return node;
}

function tone(time, from, to, duration, amplitude, type = 'sine',
  destination = compressor, attack = 0.004, sweep = duration * 0.78) {
  const shape = envelope(destination, time, amplitude, duration, attack);
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, time);
  oscillator.frequency.exponentialRampToValueAtTime(to, time + sweep);
  oscillator.connect(shape);
  oscillator.start(time);
  oscillator.stop(time + duration);
  oscillator.onended = () => { oscillator.disconnect(); shape.disconnect(); };
  return oscillator;
}

function noise(time, duration, amplitude, frequency, q = 0.8, type = 'bandpass',
  destination = compressor, buffer = white, attack = 0.005, endFrequency = frequency) {
  const shape = envelope(destination, time, amplitude, duration, attack);
  const band = filter(type, frequency, q, shape);
  band.frequency.setValueAtTime(frequency, time);
  band.frequency.exponentialRampToValueAtTime(endFrequency, time + duration * 0.85);
  const source = noiseSource(buffer, band);
  source.start(time, Math.random() * Math.max(0, buffer.duration - duration));
  source.stop(time + duration);
  source.onended = () => { source.disconnect(); band.disconnect(); shape.disconnect(); };
  return source;
}

function disconnectAfter(source, ...nodes) {
  const cleanup = source.onended;
  source.onended = () => {
    cleanup();
    for (const node of nodes) node.disconnect();
  };
}

function modulate(destination, type, frequency, depth) {
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.connect(gain(depth, destination));
  oscillator.start();
  return oscillator;
}

function makeAudience() {
  const level = gain(0, compressor);
  level.connect(gain(0.55, reverb));
  const bed = gain(0.56, level);
  const voices = gain(0.27, level);
  noiseSource(brown, filter('bandpass', 520, 0.6, bed), true).start(0, 0.7);
  noiseSource(white, filter('bandpass', 1180, 1.25, voices), true).start(0, 1.4);
  modulate(bed.gain, 'sine', 0.38, 0.16);
  modulate(voices.gain, 'sine', 0.23, 0.12);
  modulate(voices.gain, 'triangle', 3.3, 0.035);
  return level;
}

function makeLoops() {
  const sled = gain(0, compressor);
  const grit = filter('bandpass', 420, 0.85, sled);
  const scrape = filter('bandpass', 1300, 0.95, sled);
  const sledNoise = noiseSource(brown, grit, true);
  sledNoise.connect(gain(0.26, scrape));
  sledNoise.start();
  loops.set('sled', {
    level: sled,
    speed: [[grit.frequency, 165, 555], [scrape.frequency, 590, 1490], [sledNoise.playbackRate, 0.48, 0.64]],
    amplitude: 0.49,
  });

  const flywheel = gain(0, compressor);
  const wind = filter('bandpass', 610, 0.85, flywheel);
  noiseSource(white, wind, true).start(0, 0.4);
  const rotor = ctx.createOscillator();
  rotor.type = 'triangle';
  rotor.frequency.value = 25;
  rotor.connect(gain(0.08, flywheel));
  rotor.start();
  loops.set('flywheel', {
    level: flywheel,
    speed: [[wind.frequency, 270, 1050], [rotor.frequency, 25, 90]],
    amplitude: 0.29,
  });

  const breath = gain(0, compressor);
  const inhale = gain(0.39, breath);
  const exhale = gain(0.39, breath);
  const inhaleBand = filter('bandpass', 1040, 1.15, inhale);
  const exhaleBand = filter('bandpass', 490, 0.85, exhale);
  noiseSource(white, inhaleBand, true).start(0, 1.2);
  noiseSource(brown, exhaleBand, true).start(0, 1.8);
  const breathOscillator = modulate(inhale.gain, 'sine', 0.8, 0.38);
  // Both breath phases follow one oscillator, with opposite polarity.
  breathOscillator.connect(gain(-0.38, exhale.gain));
  loops.set('breath', {
    level: breath,
    speed: [[breathOscillator.frequency, 0.55, 0.68], [inhaleBand.frequency, 790, 410]],
    amplitude: 0.48,
  });
}

const progression = [
  [45, 57, 60, 64, 67],
  [41, 57, 60, 64, 65],
  [48, 55, 59, 62, 64],
  [43, 55, 57, 62, 65],
];

function playMusicStep(step, time) {
  const position = step % 16;
  const [root, ...chord] = progression[Math.floor(step / 16) % progression.length];
  const [intro, drums, synth, extra] = musicBuses;
  if (musicLevel === 1 && position === 0) {
    tone(time, hz(root - 12), hz(root - 12), beat * 3.9, 0.18, 'sine', intro, 0.19);
    for (const note of chord) {
      tone(time, hz(note), hz(note + 0.025), beat * 4.65, 0.083, 'triangle', intro, 0.46);
    }
  }
  if (musicLevel < 2) return;

  if (position % 4 === 0) {
    tone(time, 135, 47, 0.26, 0.77, 'sine', drums, 0.002, 0.047);
    tone(time, 96, 49, 0.078, 0.19, 'triangle', drums, 0.002, 0.022);
    noise(time, 0.027, 0.15, 1700, 0.8, 'bandpass', drums);
    const pump = synth.gain;
    pump.setValueAtTime(0.84, time);
    pump.linearRampToValueAtTime(0.21, time + 0.012);
    pump.exponentialRampToValueAtTime(0.84, time + 0.24);
  }
  if (position % 4 === 2) {
    noise(time, 0.145, 0.28, 6800, 0.7, 'highpass', drums);
  } else {
    noise(time, 0.05, position % 2 ? 0.12 : 0.075, 9600, 0.7, 'highpass', drums, white, 0.002);
  }
  if (position === 4 || position === 12) {
    for (const offset of [0, 0.011, 0.024]) {
      noise(time + offset, 0.032, 0.23, 1470, 1.1, 'bandpass', drums, white, 0.002);
    }
    noise(time + 0.025, 0.18, 0.33, 1130, 0.85, 'bandpass', drums);
  }
  if ([2, 5, 7, 10, 13, 15].includes(position)) {
    const pitch = hz(root - 12 + (position === 7 ? 12 : position === 15 ? 7 : 0));
    tone(time, pitch, pitch, 0.17, 0.24, 'triangle', synth);
    tone(time, pitch, pitch, 0.13, 0.085, 'sawtooth', synth);
  }
  if ([0, 6, 10].includes(position)) {
    for (const note of chord) {
      tone(time, hz(note + 12), hz(note + 11.97), position === 0 ? 0.64 : 0.23,
        0.071, 'triangle', synth, 0.027);
    }
  }
  if (musicLevel === 3) {
    if (position % 2 === 1) noise(time, 0.071, 0.25, 3900, 1.2, 'bandpass', extra);
    if (position % 4 === 2 || position === 15) {
      const pitch = hz(chord[Math.floor(position / 4) % chord.length] + 12);
      tone(time, pitch, pitch * 0.997, 0.16, 0.095, 'sawtooth', extra);
    }
    if (position === 0 && step % 64 === 0) {
      noise(time, 0.76, 0.16, 5300, 0.65, 'highpass', extra);
    }
  }
}

function scheduleMusic() {
  musicTimer = undefined;
  if (!musicLevel || muted || !ctx) return;
  const now = ctx.currentTime;
  if (ctx.state === 'running') {
    nextStep = Math.max(nextStep, Math.ceil((now + 0.012 - origin) / tick));
    while (origin + nextStep * tick < now + 0.16) {
      playMusicStep(nextStep, origin + nextStep * tick);
      nextStep++;
    }
  }
  musicTimer = setTimeout(scheduleMusic, 25);
}

function updateMusic() {
  if (!ctx) return;
  const levels = [musicLevel === 1 ? 0.65 : 0, musicLevel >= 2 ? 0.58 : 0,
    musicLevel >= 2 ? 0.61 : 0, musicLevel === 3 ? 0.58 : 0];
  layerGains.forEach((layer, i) => smooth(layer.gain, levels[i], 0.115));
  smooth(musicFilter.frequency, musicLevel === 3 ? 5800 : 1710, 0.24);
  if (musicTimer === undefined && musicLevel && !muted) scheduleMusic();
}

function impact(time, body, weight, texture = 710, length = 0.15) {
  tone(time, body * 1.45, body, length, weight, 'sine');
  noise(time, length * 0.83, weight * 0.9, texture, 0.8);
  noise(time, length, weight * 0.72, body * 2.1, 0.85, 'lowpass', compressor, brown);
}

function metal(time, body, weight, length, ratios) {
  ratios.forEach((ratio, i) => {
    const pitch = body * ratio;
    tone(time, pitch * 1.006, pitch, length / (1 + i * 0.32), weight / (1 + i * 1.15));
  });
}

function horn(time, length, root, strength = 1) {
  const band = filter('lowpass', 1600, 0.85, compressor);
  const send = gain(0.35, reverb);
  band.connect(send);
  let lastVoice;
  for (const ratio of [1, 1.25, 1.5]) {
    lastVoice = tone(time, root * ratio * 0.96, root * ratio, length, strength * 0.14, 'sawtooth', band, 0.039);
  }
  noise(time, length * 0.65, strength * 0.18, 980, 1, 'bandpass', band, white, 0.041);
  disconnectAfter(lastVoice, band, send);
}

function cheerAt(time, strength) {
  if (!strength) return;
  const tail = gain(0.55, compressor);
  const send = gain(0.8, reverb);
  tail.connect(send);
  const longestVoice = noise(time, 1.48, strength * 0.8, 880, 0.55, 'bandpass', tail, white, 0.20, 600);
  noise(time + 0.05, 1.2, strength * 0.72, 710, 0.7, 'bandpass', tail, brown, 0.23);
  for (let i = 0; i < 7; i++) {
    const offset = i * 0.075 + Math.random() * 0.13;
    const pitch = 410 + Math.random() * 500;
    noise(time + offset, 0.42, strength * 0.24, pitch, 4, 'bandpass', tail, white, 0.046, pitch * 0.79);
  }
  disconnectAfter(longestVoice, tail, send);
}

const effects = {
  beep(t) {
    tone(t, 820, 815, 0.19, 0.31, 'triangle', compressor, 0.01);
    tone(t, 1640, 1630, 0.11, 0.067);
  },
  go(t) { horn(t, 0.74, 224); },
  mat(t) {
    tone(t, 1910, 1910, 0.068, 0.18);
    tone(t + 0.055, 2310, 2310, 0.095, 0.14);
  },
  stroke(t, { power = 0.65 }) {
    const p = clamp(power);
    noise(t, 0.39, 0.18 + 0.49 * p, 960 + 950 * p, 0.85, 'bandpass', compressor, white, 0.024, 380);
    tone(t, 71 + 48 * p, 38, 0.22, 0.11 + p * 0.13, 'triangle');
    noise(t + 0.21, 0.16, 0.15 + p * 0.12, 2700, 2.4, 'bandpass', compressor, white, 0.028, 1700);
  },
  step(t) {
    impact(t, 68 + Math.random() * 17, 0.21, 690 + Math.random() * 390, 0.1);
    noise(t + 0.03, 0.075, 0.15, 2300);
  },
  kbDrop(t) {
    impact(t, 53, 0.5, 1060, 0.29);
    metal(t, 192, 0.26, 0.51, [1, 2.71, 4.43, 7.19]);
    metal(t + 0.074, 215, 0.12, 0.30, [1, 3.21, 5.13]);
    noise(t + 0.076, 0.11, 0.22, 1990);
  },
  kbPick(t) {
    noise(t, 0.19, 0.36, 1370, 1.4, 'bandpass', compressor, white, 0.021, 640);
    metal(t + 0.028, 260, 0.083, 0.18, [1, 2.9, 5.7]);
  },
  thud(t) {
    impact(t, 46, 0.55, 350, 0.26);
    noise(t + 0.036, 0.20, 0.27, 820, 1.25, 'bandpass', compressor, brown);
  },
  land(t) {
    impact(t, 61, 0.47, 570, 0.21);
    impact(t + 0.025, 74, 0.22, 950, 0.108);
  },
  ballThrow(t) {
    noise(t, 0.23, 0.34, 570, 1.1, 'bandpass', compressor, white, 0.035, 2120);
    noise(t + 0.03, 0.12, 0.22, 300, 0.85, 'bandpass', compressor, brown);
  },
  ballHit(t) {
    impact(t, 89, 0.39, 1250, 0.18);
    metal(t, 171, 0.18, 0.32, [1, 2.28, 3.81, 6.13]);
  },
  ballCatch(t) {
    impact(t, 108, 0.28, 970, 0.12);
    noise(t + 0.02, 0.11, 0.24, 400, 0.6, 'bandpass', compressor, brown);
  },
  whistle(t) {
    const band = filter('lowpass', 5900, 0.75, compressor);
    const send = gain(0.26, reverb);
    band.connect(send);
    let lastVoice;
    for (const offset of [0, 0.17]) {
      lastVoice = tone(t + offset, 2870, 3100, 0.145, 0.19, 'sine', band, 0.017);
      tone(t + offset, 2960, 3185, 0.132, 0.10, 'sine', band, 0.019);
      noise(t + offset, 0.133, 0.17, 2950, 3.4, 'bandpass', band, white, 0.018);
    }
    disconnectAfter(lastVoice, band, send);
  },
  norep(t) {
    const band = filter('lowpass', 1260, 1.25, compressor);
    const longestVoice = tone(t, 143, 126, 0.22, 0.31, 'sawtooth', band, 0.009);
    tone(t, 156, 139, 0.20, 0.14, 'square', band, 0.012);
    disconnectAfter(longestVoice, band);
  },
  tag(t) {
    impact(t, 145, 0.17, 1850, 0.09);
    noise(t, 0.048, 0.40, 2450, 0.7, 'bandpass', compressor, white, 0.001);
  },
  rope(t) {
    noise(t, 0.30, 0.52, 750, 1.45, 'bandpass', compressor, brown, 0.032, 285);
    for (const offset of [0.012, 0.052, 0.081]) {
      noise(t + offset, 0.095, 0.18, 850, 1.1, 'bandpass', compressor, white, 0.009);
    }
  },
  finish(t) {
    horn(t, 0.53, 261);
    horn(t + 0.4, 0.91, 349, 0.82);
    cheerAt(t + 0.1, 1);
  },
  ui(t) {
    noise(t, 0.057, 0.17, 1250, 1.05);
    tone(t, 380, 260, 0.057, 0.12, 'triangle');
  },
  good(t) {
    tone(t, 587, 587, 0.18, 0.14, 'triangle');
    tone(t + 0.055, 784, 784, 0.24, 0.12, 'sine');
  },
  bad(t) {
    tone(t, 254, 195, 0.16, 0.15, 'triangle');
    noise(t, 0.09, 0.075, 460);
  },
};

const announcements = [];
let speaking;
let speechTimer;
let nextAnnouncement = 0;

function speakNext() {
  if (muted || speaking || !announcements.length) return;
  const speech = globalThis.speechSynthesis;
  const item = announcements[0];
  const wait = nextAnnouncement - performance.now();
  if (!item.priority && wait > 0) {
    speechTimer ??= setTimeout(() => {
      speechTimer = undefined;
      speakNext();
    }, wait);
    return;
  }
  clearTimeout(speechTimer);
  speechTimer = undefined;
  announcements.shift();
  const utterance = new globalThis.SpeechSynthesisUtterance(item.text);
  const voices = speech.getVoices();
  const voice = voices.find(voice => /^es-(ES|MX)$/i.test(voice.lang))
    ?? voices.find(voice => /^es(?:-|$)/i.test(voice.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? 'es-ES';
  utterance.volume = volume;
  utterance.rate = 1.07;
  const finished = () => {
    if (speaking !== utterance) return;
    speaking = undefined;
    nextAnnouncement = performance.now() + 2500;
    speakNext();
  };
  utterance.onend = finished;
  utterance.onerror = finished;
  speaking = utterance;
  speech.speak(utterance);
}

function updateOutput() {
  if (output) smooth(output.gain, muted ? 0 : volume, 0.02);
}

function updateAudience() {
  if (audience) smooth(audience.gain, crowdLevel ** 1.25 * 0.58, 0.31);
}

export const Audio = {
  bpm,

  init() {
    if (!ctx) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return;
      ctx = new Context();
      output = gain(muted ? 0 : volume, ctx.destination);
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 19;
      compressor.ratio.value = 3.6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.17;
      compressor.connect(output);
      reverb = ctx.createConvolver();
      reverb.buffer = hallImpulse();
      reverb.connect(gain(0.42, compressor));
      white = makeNoise(3.1);
      brown = makeNoise(3.7, true);
      audience = makeAudience();
      makeLoops();

      layerGains = Array.from({ length: 4 }, () => gain(0, compressor));
      layerGains[0].connect(gain(0.28, reverb));
      musicFilter = filter('lowpass', 1710, 0.77, layerGains[2]);
      const pump = gain(0.84, musicFilter);
      musicBuses = [layerGains[0], layerGains[1], pump, layerGains[3]];
      layerGains[3].connect(gain(0.21, reverb));
      origin = ctx.currentTime + 0.065;
      updateMusic();
      updateAudience();
    }
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      return ctx.resume().catch(() => {});
    }
  },

  setMuted(value) {
    muted = Boolean(value);
    try { globalThis.localStorage?.setItem('aguanteMute', String(muted)); } catch {}
    updateOutput();
    if (muted) {
      clearTimeout(musicTimer);
      musicTimer = undefined;
      clearTimeout(speechTimer);
      speechTimer = undefined;
      announcements.length = 0;
      if (speaking) {
        speaking = undefined;
        globalThis.speechSynthesis?.cancel();
      }
      nextAnnouncement = 0;
    }
    updateMusic();
  },

  isMuted() { return muted; },

  music(level) {
    const target = Math.round(clamp(level, 3));
    if (target === musicLevel) return;
    if (ctx && target && !musicLevel) {
      origin = ctx.currentTime + 0.065;
      nextStep = 0;
      musicBuses[2].gain.cancelScheduledValues(ctx.currentTime);
    }
    musicLevel = target;
    if (!target) {
      clearTimeout(musicTimer);
      musicTimer = undefined;
    }
    updateMusic();
  },

  beatPhase() {
    if (!ctx || ctx.currentTime < origin) return 0;
    return ((ctx.currentTime - origin) / beat) % 1;
  },

  crowd(level) {
    const target = clamp(level);
    if (target === crowdLevel) return;
    crowdLevel = target;
    updateAudience();
  },

  cheer(strength = 1) {
    if (ctx?.state === 'running' && !muted) cheerAt(ctx.currentTime + 0.012, clamp(strength));
  },

  loop(name, vol, rate = 1) {
    const voice = loops.get(name);
    if (!voice) return;
    const level = clamp(vol) * voice.amplitude;
    const speed = clamp(rate, 2);
    if (level !== voice.lastLevel) {
      voice.lastLevel = level;
      smooth(voice.level.gain, level);
    }
    if (speed !== voice.lastSpeed) {
      voice.lastSpeed = speed;
      for (const [param, base, range] of voice.speed) smooth(param, base + range * speed, 0.055);
    }
  },

  sfx(name, opts = {}) {
    if (ctx?.state === 'running' && !muted && Object.hasOwn(effects, name)) {
      effects[name](ctx.currentTime + 0.012, opts ?? {});
    }
  },

  // locutor apagado: a Marco no le gustó la voz (y Chrome la seguía diciendo al cerrar la pestaña)
  say() { },
  _sayOld(text, { priority = false } = {}) {
    if (muted || typeof text !== 'string' || !text.trim()
      || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const item = { text: text.trim(), priority };
    const firstNormal = priority ? announcements.findIndex(entry => !entry.priority) : -1;
    if (firstNormal < 0) announcements.push(item);
    else announcements.splice(firstNormal, 0, item);
    speakNext();
  },

  master(vol) {
    volume = clamp(vol);
    updateOutput();
  },
};

// por si quedó algo en la cola de voz de una versión anterior: callarla, y nada de sonido al cerrar
try { globalThis.speechSynthesis?.cancel(); } catch { }
globalThis.addEventListener?.('pagehide', () => { try { globalThis.speechSynthesis?.cancel(); } catch { } try { ctx?.suspend(); } catch { } });
globalThis.addEventListener?.('pageshow', e => { if (e.persisted) try { ctx?.resume(); } catch { } });
