/* 词趣 WordFun — 数据层：localStorage 读写、数据模型、词 CRUD、设置、统计、备份 */
window.Store = (function () {
  'use strict';

  var KEY = 'wordfun.data';
  var MAX_MEANING = 500;
  var MAX_PHONETIC = 100;
  var MAX_EXAMPLE = 300;
  var MAX_DAILY_KEYS = 365;

  var data = null;
  var broken = false;

  function defaults() {
    return {
      version: 1,
      words: {},
      settings: {
        ttsEnabled: true,
        ttsRate: 0.9,
        dailyNewWords: 10,
        sessionSize: 10
      },
      stats: {
        daily: {},
        totalAnswered: 0,
        totalCorrect: 0,
        totalSessions: 0
      },
      meta: { createdAt: Date.now(), lastBackupAt: 0, lastStudyAt: 0 }
    };
  }

  // 迁移：v1 为当前版本，仅做字段防御性补齐，未来版本在此按 version 分支
  function migrate(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    if (raw.words && typeof raw.words === 'object') d.words = raw.words;
    if (raw.settings && typeof raw.settings === 'object') {
      Object.assign(d.settings, raw.settings);
    }
    if (raw.stats && typeof raw.stats === 'object') {
      Object.assign(d.stats, raw.stats);
      if (!d.stats.daily || typeof d.stats.daily !== 'object') d.stats.daily = {};
    }
    if (raw.meta && typeof raw.meta === 'object') Object.assign(d.meta, raw.meta);
    return d;
  }

  function load() {
    if (data) return data;
    try {
      var raw = localStorage.getItem(KEY);
      data = raw ? migrate(JSON.parse(raw)) : defaults();
    } catch (e) {
      broken = true;
      data = defaults();
    }
    return data;
  }

  function save() {
    if (broken) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      broken = true;
      return false;
    }
  }

  // 供 storage 事件后重新读取
  function reload() {
    data = null;
    load();
  }

  function isBroken() { return broken; }

  // ===== 单词规范化 =====
  function normalizeWord(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function isValidWord(w) {
    return /^[a-z][a-z' .-]{0,39}$/.test(w);
  }

  function genId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 词义合并：按「；」分段去重后拼接
  function mergeMeaning(a, b) {
    var parts = [];
    if (a) parts.push.apply(parts, String(a).split('；').map(function (s) { return s.trim(); }).filter(Boolean));
    if (b) parts.push.apply(parts, String(b).split('；').map(function (s) { return s.trim(); }).filter(Boolean));
    var seen = {};
    return parts.filter(function (s) {
      if (seen[s]) return false;
      seen[s] = true;
      return true;
    }).join('；');
  }

  function findWordByWord(w) {
    var words = data.words;
    for (var k in words) {
      if (words[k].word === w) return words[k];
    }
    return null;
  }

  // ===== 词 CRUD =====
  function getWords() {
    load();
    return Object.values(data.words).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function getWord(id) {
    load();
    return data.words[id] || null;
  }

  // 添加（含去重合并）：返回 { status: 'added'|'updated'|'skipped', wordId, reason }
  function addWord(fields) {
    load();
    var w = normalizeWord(fields.word);
    if (!isValidWord(w)) {
      return { status: 'skipped', reason: '单词格式不合法：' + String(fields.word || '').slice(0, 20) };
    }
    var phonetic = String(fields.phonetic || '').trim().slice(0, MAX_PHONETIC);
    var meaning = String(fields.meaning || '').trim().slice(0, MAX_MEANING);
    var example = String(fields.example || '').trim().slice(0, MAX_EXAMPLE);

    var existing = findWordByWord(w);
    if (existing) {
      var changed = false;
      if (!existing.phonetic && phonetic) { existing.phonetic = phonetic; changed = true; }
      if (meaning) {
        var merged = mergeMeaning(existing.meaning, meaning);
        if (merged !== existing.meaning) { existing.meaning = merged; changed = true; }
      }
      if (!existing.example && example) { existing.example = example; changed = true; }
      if (changed) { existing.updatedAt = Date.now(); save(); }
      return { status: 'updated', wordId: existing.id };
    }

    var id = genId();
    var now = Date.now();
    data.words[id] = {
      id: id,
      word: w,
      phonetic: phonetic,
      meaning: meaning,
      example: example,
      box: 0,
      nextReviewAt: 0,
      correctCount: 0,
      wrongCount: 0,
      streak: 0,
      createdAt: now,
      updatedAt: now
    };
    save();
    return { status: 'added', wordId: id };
  }

  // 编辑：只允许改 word/phonetic/meaning/example；word 规范化后若撞库合并词义
  function updateWord(id, fields) {
    load();
    var w = data.words[id];
    if (!w) return false;
    var now = Date.now();
    if (typeof fields.word === 'string') {
      var nw = normalizeWord(fields.word);
      if (!isValidWord(nw)) return false;
      w.word = nw;
    }
    if (typeof fields.phonetic === 'string') w.phonetic = fields.phonetic.trim().slice(0, MAX_PHONETIC);
    if (typeof fields.meaning === 'string') w.meaning = fields.meaning.trim().slice(0, MAX_MEANING);
    if (typeof fields.example === 'string') w.example = fields.example.trim().slice(0, MAX_EXAMPLE);
    // SRS 字段（srs.js 使用）
    if (typeof fields.box === 'number') w.box = fields.box;
    if (typeof fields.nextReviewAt === 'number') w.nextReviewAt = fields.nextReviewAt;
    if (typeof fields.correctCount === 'number') w.correctCount = fields.correctCount;
    if (typeof fields.wrongCount === 'number') w.wrongCount = fields.wrongCount;
    if (typeof fields.streak === 'number') w.streak = fields.streak;
    w.updatedAt = now;
    save();
    return true;
  }

  function deleteWord(id) {
    load();
    if (!data.words[id]) return false;
    delete data.words[id];
    save();
    return true;
  }

  // ===== 设置 =====
  function getSettings() {
    load();
    return data.settings;
  }

  function setSettings(patch) {
    load();
    Object.assign(data.settings, patch);
    var s = data.settings;
    // 数值钳制（用 isFinite 判断：0 是合法输入，会被钳到下限而非当成缺省值）
    function clampNum(v, min, max, def) {
      var n = Number(v);
      return Math.min(max, Math.max(min, isFinite(n) ? n : def));
    }
    s.ttsRate = clampNum(s.ttsRate, 0.5, 1.5, 0.9);
    s.dailyNewWords = Math.round(clampNum(s.dailyNewWords, 1, 50, 10));
    s.sessionSize = Math.round(clampNum(s.sessionSize, 5, 30, 10));
    save();
  }

  // ===== 统计 =====
  // 本地日期键 'YYYY-MM-DD'（不用 toISOString，避免时区偏移）
  function dateKey(d) {
    var t = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  function getDaily(key) {
    load();
    var d = data.stats.daily[key];
    if (!d) d = { answered: 0, correct: 0, newLearned: 0, sessions: 0 };
    return d;
  }

  function pruneDaily() {
    var keys = Object.keys(data.stats.daily).sort();
    while (keys.length > MAX_DAILY_KEYS) {
      delete data.stats.daily[keys.shift()];
    }
  }

  function recordAnswer(key, correct, newLearned) {
    load();
    var d = getDaily(key);
    d.answered++;
    if (correct) d.correct++;
    if (newLearned) d.newLearned++;
    data.stats.daily[key] = d;
    pruneDaily();
    data.stats.totalAnswered++;
    if (correct) data.stats.totalCorrect++;
    save();
  }

  function recordSession(key) {
    load();
    var d = getDaily(key);
    d.sessions++;
    data.stats.daily[key] = d;
    data.stats.totalSessions++;
    data.meta.lastStudyAt = Date.now();
    save();
  }

  function todayLearned(key) {
    return getDaily(key).newLearned;
  }

  function getSummary() {
    var words = getWords();
    var mastered = words.filter(function (w) { return w.box >= 4; }).length;
    var accuracy = data.stats.totalAnswered
      ? Math.round(data.stats.totalCorrect / data.stats.totalAnswered * 100)
      : 0;
    return { total: words.length, mastered: mastered, accuracy: accuracy };
  }

  // ===== 备份 =====
  function exportJSON() {
    load();
    return JSON.stringify({
      app: 'wordfun',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: data
    }, null, 2);
  }

  function importJSON(text) {
    try {
      var obj = JSON.parse(text);
      if (!obj || obj.app !== 'wordfun' || !obj.data || typeof obj.data !== 'object') {
        return { ok: false, error: '文件格式不正确（不是词趣备份文件）' };
      }
      data = migrate(obj.data);
      data.meta.lastBackupAt = Date.now();
      save();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '文件无法解析' };
    }
  }

  function clearAll() {
    data = defaults();
    save();
  }

  return {
    load: load,
    save: save,
    reload: reload,
    isBroken: isBroken,
    normalizeWord: normalizeWord,
    isValidWord: isValidWord,
    mergeMeaning: mergeMeaning,
    getWords: getWords,
    getWord: getWord,
    addWord: addWord,
    updateWord: updateWord,
    deleteWord: deleteWord,
    getSettings: getSettings,
    setSettings: setSettings,
    dateKey: dateKey,
    getDaily: getDaily,
    recordAnswer: recordAnswer,
    recordSession: recordSession,
    todayLearned: todayLearned,
    getSummary: getSummary,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll
  };
})();
