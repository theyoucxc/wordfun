/* 词趣 WordFun — 发音：Web Speech API 封装、en-US 语音选择、降级检测 */
window.TTS = (function () {
  'use strict';

  var voices = [];
  var voiceReady = false;
  var initAttempted = false;
  var readyCallbacks = [];

  function pickVoice() {
    var en = voices.filter(function (v) { return /^en(-|_)/i.test(v.lang); });
    var best = null;
    en.forEach(function (v) {
      if (/microsoft/i.test(v.name) && /en[-_]us/i.test(v.lang)) best = v;
    });
    if (!best) {
      var us = en.filter(function (v) { return /en[-_]us/i.test(v.lang); });
      best = us[0] || en[0] || null;
    }
    return best;
  }

  function notifyReady() {
    if (!voiceReady) return;
    readyCallbacks.forEach(function (cb) { try { cb(); } catch (e) {} });
    readyCallbacks = [];
  }

  function init() {
    if (initAttempted) return;
    initAttempted = true;
    if (!('speechSynthesis' in window)) return;
    var load = function () {
      voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        voiceReady = true;
        notifyReady();
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    // 兜底：1 秒后若语音仍未加载且存在 en 语音之外的任何语音，视为可用前状态再等；
    // 若无语音列表则保持不可用，由 available() 决定降级
    setTimeout(load, 1000);
    setTimeout(load, 3000);
  }

  // 浏览器支持 + 已加载到 en 语音
  function available() {
    if (!('speechSynthesis' in window)) return false;
    if (!voiceReady) return false;
    return !!pickVoice();
  }

  // 语音就绪时回调（用于仪表盘渲染修正提示条）
  function onReady(cb) {
    if (voiceReady) { cb(); return; }
    readyCallbacks.push(cb);
  }

  function speak(text, opts) {
    if (!('speechSynthesis' in window)) return;
    if (!Store.getSettings().ttsEnabled) return;
    var v = pickVoice();
    var u = new SpeechSynthesisUtterance(String(text));
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-US';
    u.rate = (opts && opts.rate) || Store.getSettings().ttsRate;
    u.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function cancel() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // 静音预热：在首次用户点击后调用，解锁浏览器自动播放限制
  function prime() {
    if (!('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 2;
    window.speechSynthesis.speak(u);
  }

  init();

  return {
    available: available,
    onReady: onReady,
    speak: speak,
    cancel: cancel,
    prime: prime
  };
})();
