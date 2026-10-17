/* Звуки синтезируются Web Audio, файлов нет. Контекст создаётся только по нажатию
   ребёнка, поэтому сам по себе звук не запускается; есть переключатель в интерфейсе. */
(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;

  function unlock() {
    if (!ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
        return;
      }
    }
    if (ctx.state === 'suspended' && enabled) ctx.resume();
  }

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  function tone(freq, duration, type, volume, slideTo, delay) {
    if (!ready()) return;
    var start = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noise(duration, volume) {
    if (!ready()) return;
    var length = Math.floor(ctx.sampleRate * duration);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  window.Sound = {
    unlock: unlock,
    isEnabled: function () { return enabled; },
    setEnabled: function (value) {
      enabled = !!value;
      if (!ctx) return;
      if (enabled) ctx.resume(); else ctx.suspend();
    },
    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && enabled) ctx.resume(); },
    flap: function () { tone(420, 0.12, 'triangle', 0.18, 640); },
    point: function () { tone(880, 0.09, 'sine', 0.12); },
    tick: function () { tone(660, 0.12, 'triangle', 0.13); },
    coin: function () {
      tone(988, 0.08, 'square', 0.07);
      tone(1319, 0.16, 'square', 0.07, null, 0.07);
    },
    hit: function () {
      noise(0.3, 0.5);
      tone(160, 0.3, 'sawtooth', 0.12, 60);
    },
    card: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, 'triangle', 0.12, null, i * 0.08); });
    },
    win: function () {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.13, null, i * 0.11); });
    }
  };
})();
