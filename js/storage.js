/* 词趣 WordFun — 数据层：localStorage 读写、数据模型、词 CRUD、设置、统计、备份、会话恢复 */
window.Store = (function () {
  'use strict';

  var KEY = 'wordfun.data';
  var MAX_MEANING = 500;
  var MAX_DAILY_KEYS = 365;

  var data = null;
  var broken = false;
  var suspend = false; // 批量导入期间暂停每次落盘

  function defaults() {
    return {
      version: 2,
      words: {},
      settings: {
        ttsEnabled: true,
        ttsRate: 0.9,
        sessionSize: 10
      },
      stats: {
        daily: {},
        totalAnswered: 0,
        totalCorrect: 0,
        totalSessions: 0
      },
      meta: { createdAt: Date.now(), lastBackupAt: 0, lastStudyAt: 0, seededKBs: [], studyDay: 0 }
    };
  }

  // 迁移：v1 → v2 去掉音标/例句，单词增加 day（默认 0 = 自由词）；未来版本按 version 分支
  function migrate(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    if (raw.words && typeof raw.words === 'object') {
      for (var id in raw.words) {
        var w = raw.words[id];
        if (!w || typeof w !== 'object') continue;
        d.words[id] = {
          id: w.id || id,
          word: String(w.word || ''),
          meaning: String(w.meaning || ''),
          day: (typeof w.day === 'number' && w.day > 0) ? w.day : 0,
          box: w.box || 0,
          nextReviewAt: w.nextReviewAt || 0,
          correctCount: w.correctCount || 0,
          wrongCount: w.wrongCount || 0,
          streak: w.streak || 0,
          createdAt: w.createdAt || Date.now(),
          updatedAt: w.updatedAt || Date.now()
        };
      }
    }
    if (raw.settings && typeof raw.settings === 'object') Object.assign(d.settings, raw.settings);
    if (raw.stats && typeof raw.stats === 'object') {
      Object.assign(d.stats, raw.stats);
      if (!d.stats.daily || typeof d.stats.daily !== 'object') d.stats.daily = {};
    }
    if (raw.meta && typeof raw.meta === 'object') Object.assign(d.meta, raw.meta);
    if (!Array.isArray(d.meta.seededKBs)) d.meta.seededKBs = [];
    if (!(typeof d.meta.studyDay === 'number' && d.meta.studyDay >= 0)) d.meta.studyDay = 0;
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
    if (broken || suspend) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      broken = true;
      return false;
    }
  }

  // 批量写：期间暂停每次 save，结束统一落盘一次（导入大量词时避免频繁序列化）
  function beginBatch() {
    load();
    suspend = true;
  }

  function endBatch() {
    suspend = false;
    save();
  }

  function reload() {
    data = null;
    load();
  }

  function isBroken() { return broken; }

  // ===== 单词规范化 =====
  // 去重音符号、去带圈序号（lie①→lie）、去派生词标记 *、折叠空白、小写
  function normalizeWord(raw) {
    if (typeof raw !== 'string') return '';
    var s = raw;
    if (typeof s.normalize === 'function') s = s.normalize('NFD');
    return s
      .replace(/[̀-ͯ]/g, '')   // 重音符号：résumé → resume
      .replace(/[①-⑳]/g, '')   // 带圈序号：lie① → lie
      .trim()
      .replace(/^\*+/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // 允许 behave(u)r / practise/-ice 这类变体写法（括号与斜杠）
  function isValidWord(w) {
    return /^[a-z][a-z()\/' .-]{0,39}$/.test(w);
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
    // 按天升序、同天按导入顺序（createdAt 升序）——保持课程顺序
    return Object.values(data.words).sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      return a.createdAt - b.createdAt;
    });
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
    var meaning = String(fields.meaning || '').trim().slice(0, MAX_MEANING);
    var day = Math.max(0, Math.min(999, Math.round(Number(fields.day) || 0)));

    var existing = findWordByWord(w);
    if (existing) {
      var changed = false;
      if (meaning) {
        var merged = mergeMeaning(existing.meaning, meaning);
        if (merged !== existing.meaning) { existing.meaning = merged; changed = true; }
      }
      if (day > 0 && existing.day === 0) { existing.day = day; changed = true; }
      if (changed) { existing.updatedAt = Date.now(); save(); }
      return { status: 'updated', wordId: existing.id };
    }

    var id = genId();
    var now = Date.now();
    data.words[id] = {
      id: id,
      word: w,
      meaning: meaning,
      day: day,
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

  // 编辑：只允许改 word/meaning/day 及 SRS 字段；word 规范化后若撞库合并词义
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
    if (typeof fields.meaning === 'string') w.meaning = fields.meaning.trim().slice(0, MAX_MEANING);
    if (typeof fields.day === 'number') w.day = Math.max(0, Math.min(999, Math.round(fields.day)));
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
    s.sessionSize = Math.round(clampNum(s.sessionSize, 5, 30, 10));
    save();
  }

  // ===== 统计 =====
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

  // ===== 会话恢复 =====
  function saveSession(s) {
    load();
    data.session = s;
    save();
  }

  function getSession() {
    load();
    return data.session || null;
  }

  function clearSession() {
    load();
    if (data.session) {
      delete data.session;
      save();
    }
  }

  // ===== 知识库载入记录（按名去重，避免重复导入） =====
  function getSeededKBs() {
    load();
    return data.meta.seededKBs;
  }

  function setSeededKBs(arr) {
    load();
    data.meta.seededKBs = arr;
    save();
  }

  // ===== 学习天（0 = 自动跟随进度；N = 手动跳转到第 N 天） =====
  function getStudyDay() {
    load();
    var d = data.meta.studyDay;
    return (typeof d === 'number' && d >= 0) ? d : 0;
  }

  function maxStudyDay() {
    load();
    var max = 0;
    for (var k in data.words) {
      if (data.words[k].day > max) max = data.words[k].day;
    }
    return max;
  }

  function setStudyDay(n) {
    load();
    data.meta.studyDay = Math.max(0, Math.min(Math.round(Number(n) || 0), maxStudyDay()));
    save();
  }

  // ===== 备份 =====
  function exportJSON() {
    load();
    return JSON.stringify({
      app: 'wordfun',
      version: 2,
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
    beginBatch: beginBatch,
    endBatch: endBatch,
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
    saveSession: saveSession,
    getSession: getSession,
    clearSession: clearSession,
    getSeededKBs: getSeededKBs,
    setSeededKBs: setSeededKBs,
    getStudyDay: getStudyDay,
    maxStudyDay: maxStudyDay,
    setStudyDay: setStudyDay,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll
  };
})();
