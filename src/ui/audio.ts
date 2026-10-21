/** Tiny procedural sound-effect synth (WebAudio). No audio files: every sound is generated, so it is original and tiny. */
export type Sfx = 'hit' | 'miss' | 'hurt' | 'chop' | 'mine' | 'loot' | 'levelup' | 'bow' | 'magic' | 'swing' | 'click' | 'quest' | 'death' | 'eat';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

  /** Must be called from a user gesture on mobile. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'bandpass', when = 0, q = 1) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  play(sfx: Sfx) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const r = 1 + (Math.random() - 0.5) * 0.12;
    switch (sfx) {
      case 'hit':
        this.noise(0.12, 0.5, 900 * r, 'lowpass');
        this.tone(140 * r, 0.12, 'square', 0.12, 0, 70);
        break;
      case 'miss':
        this.noise(0.15, 0.18, 2500 * r, 'highpass');
        break;
      case 'hurt':
        this.tone(220 * r, 0.18, 'sawtooth', 0.12, 0, 110);
        this.noise(0.1, 0.3, 600, 'lowpass');
        break;
      case 'swing':
        this.noise(0.16, 0.22, 1800 * r, 'bandpass', 0, 2);
        break;
      case 'chop':
        this.noise(0.09, 0.55, 700 * r, 'bandpass', 0, 3);
        this.tone(180 * r, 0.08, 'triangle', 0.25, 0, 120);
        break;
      case 'mine':
        this.tone(1650 * r, 0.22, 'triangle', 0.18);
        this.tone(2480 * r, 0.15, 'sine', 0.08);
        this.noise(0.06, 0.35, 3000, 'highpass');
        break;
      case 'loot':
        this.tone(880, 0.09, 'triangle', 0.16);
        this.tone(1320, 0.12, 'triangle', 0.14, 0.07);
        break;
      case 'bow':
        this.tone(320 * r, 0.12, 'triangle', 0.18, 0, 180);
        this.noise(0.18, 0.12, 3000, 'highpass', 0.02);
        break;
      case 'magic':
        this.tone(520 * r, 0.35, 'sine', 0.14, 0, 1400);
        this.tone(780 * r, 0.3, 'triangle', 0.06, 0.03, 1900);
        break;
      case 'click':
        this.tone(660, 0.05, 'square', 0.05);
        break;
      case 'eat':
        this.noise(0.07, 0.3, 1200, 'bandpass', 0, 2);
        this.noise(0.07, 0.3, 1000, 'bandpass', 0.12, 2);
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.09));
        this.tone(1568, 0.6, 'sine', 0.08, 0.36);
        break;
      case 'quest':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.14, i * 0.12));
        break;
      case 'death':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.14, i * 0.18));
        break;
    }
  }
}
