// audio.js — every sound in Solano Heat is synthesised with WebAudio at play
// time; the game ships no audio files. One master gain keeps the mix tame and
// the M key mutes it. The engine hum and the police siren are continuous
// voices whose parameters the game steers each frame; everything else is a
// short one-shot built from oscillators and filtered noise.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenPhase = 0;
    this.ambientTimer = 0;
  }

  // Browsers only allow audio after a user gesture, so main.js calls this
  // from the start button / first key press.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this._startEngine();
    this._startSiren();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 20;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    this.engineFilter = filter;
    this.engineSub = sub;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter); sub.connect(filter);
    filter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); sub.start();
  }

  // speed01: 0..1 of the car's top speed; load: throttle amount 0..1.
  engine(speed01, load, dt) {
    if (!this.ctx || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const rpm = 42 + speed01 * 130 + load * 22;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.06);
    this.engineSub.frequency.setTargetAtTime(rpm / 2, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(240 + speed01 * 900, t, 0.08);
    const vol = this.engineActive ? 0.05 + load * 0.05 + speed01 * 0.03 : 0;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.09);
  }

  setEngineActive(on) { this.engineActive = on; if (!on && this.engineGain && this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }

  _startSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
  }

  // nearest: distance in metres to the closest police car, or Infinity.
  siren(nearest, dt) {
    if (!this.ctx || !this.sirenGain) return;
    const t = this.ctx.currentTime;
    if (!isFinite(nearest)) {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    this.sirenPhase += dt * 2.4;
    const f = 660 + (Math.sin(this.sirenPhase * Math.PI * 2) * 0.5 + 0.5) * 320;
    this.sirenOsc.frequency.setTargetAtTime(f, t, 0.03);
    const vol = Math.max(0, 0.075 * (1 - nearest / 95));
    this.sirenGain.gain.setTargetAtTime(vol, t, 0.08);
  }

  _blip(freqA, freqB, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqA, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, filterFreq, vol, type = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(t + dur + 0.02);
  }

  shot() { this._noise(0.16, 1800, 0.5, 'highpass'); this._blip(160, 40, 0.14, 'square', 0.25); }
  dryFire() { this._blip(900, 300, 0.05, 'square', 0.08); }
  reload() { this._blip(300, 500, 0.07, 'square', 0.12); this._blip(500, 260, 0.07, 'square', 0.12, 0.16); }
  thud() { this._blip(120, 45, 0.18, 'sine', 0.5); this._noise(0.1, 300, 0.2, 'lowpass'); }
  crash(intensity) { this._noise(0.3, 500, 0.25 + intensity * 0.4, 'lowpass'); this._blip(90, 35, 0.3, 'sine', 0.4); }
  screech(amount) {
    if (!this.ctx || amount <= 0.05) return;
    if (this._screechAt && this.ctx.currentTime - this._screechAt < 0.12) return;
    this._screechAt = this.ctx.currentTime;
    this._noise(0.12, 2400 + amount * 800, 0.03 + amount * 0.05, 'bandpass');
  }
  pickup() { this._blip(660, 990, 0.12, 'sine', 0.2); this._blip(990, 1320, 0.14, 'sine', 0.16, 0.07); }
  cash() { this._blip(880, 880, 0.07, 'square', 0.1); this._blip(1174, 1174, 0.1, 'square', 0.1, 0.06); }
  success() { [523, 659, 784, 1046].forEach((f, i) => this._blip(f, f, 0.16, 'triangle', 0.18, i * 0.09)); }
  fail() { this._blip(220, 110, 0.35, 'sawtooth', 0.15); }
  door() { this._blip(140, 90, 0.09, 'square', 0.15); this._blip(200, 160, 0.06, 'square', 0.1, 0.1); }
  step() { this._noise(0.05, 500, 0.05, 'lowpass'); }

  // A lazy sunset synth pad: two detuned triangles through a slow filter,
  // re-triggered as a gentle chord drift while the game runs.
  ambient(dt) {
    if (!this.ctx) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 7.5;
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
    const chord = chords[Math.floor(Math.random() * chords.length)];
    for (const f of chord) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 700;
      o.type = 'triangle'; o.frequency.value = f;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.016, t + 2.2);
      g.gain.linearRampToValueAtTime(0, t + 7.4);
      o.connect(flt); flt.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 7.5);
    }
  }
}
