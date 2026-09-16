/* 词趣 WordFun — 应用编排：初始化、全局事件、练习会话状态机 */
window.App = (function () {
  'use strict';

  // 会话状态
  var S = null;

  function freshSession() {
    return {
      queue: [],
      requeue: [],
      idx: 0,
      current: null,
      locked: false,
      startedAt: 0,
      totalScreens: 0,
      answeredScreens: 0,
      byType: {
        choice: { t: 0, c: 0 },
        listening: { t: 0, c: 0 },
        spelling: { t: 0, c: 0 },
        matching: { t: 0, c: 0 }
      },
      transitions: [],
      newLearned: 0
    };
  }

  // 会话进度落盘：中途退出/刷新后可继续
  function persist() {
    if (S) Store.saveSession(S);
  }

  // 载入内置知识库（data/kb.js 里的 window.WORDFUN_KBS）：按名去重，只导入尚未载入过的；
  // 天数做偏移，让后续新增的知识库接在前一个的天数之后，避免「第 N 天」冲突
  function seedKnowledgeBase() {
    var kbs = window.WORDFUN_KBS || [];
    if (!kbs.length) return;
    var seeded = Store.getSeededKBs();
    var changed = false;
    kbs.forEach(function (kb) {
      if (seeded.indexOf(kb.name) !== -1) return;
      var maxDay = 0;
      Store.getWords().forEach(function (w) { if (w.day > maxDay) maxDay = w.day; });
      var parsed = Importer.parseText(kb.text);
      if (parsed.rows.length) {
        var offset = maxDay;
        parsed.rows.forEach(function (r) { if (r.day > 0) r.day += offset; });
        var res = Importer.mergeIntoStore(parsed.rows);
        seeded.push(kb.name);
        changed = true;
        if (res.added || res.updated) {
          UI.toast('已载入知识库「' + kb.name + '」：新增 ' + res.added + ' · 更新 ' + res.updated);
        }
      }
    });
    if (changed) Store.setSeededKBs(seeded);
  }

  // ===== 初始化 =====
  function init() {
    Store.load();
    seedKnowledgeBase();

    if (Store.isBroken()) {
      var bar = document.getElementById('warning-bar');
      bar.hidden = false;
      bar.textContent = '⚠ 数据无法保存，请检查浏览器设置（可能处于无痕模式或存储被禁用）';
    }

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        UI.showView(t.dataset.view);
      });
    });

    document.getElementById('btn-settings').addEventListener('click', function () {
      UI.openSettings();
    });

    // 首次用户手势后预热语音（解锁自动播放限制）
    document.addEventListener('click', function primeOnce() {
      TTS.prime();
      document.removeEventListener('click', primeOnce);
    });

    // 多标签页：数据变化时提示并刷新
    window.addEventListener('storage', function (e) {
      if (e.key === 'wordfun.data') {
        Store.reload();
        UI.renderCurrent();
      }
    });

    // 语音异步加载完成后修正仪表盘提示
    TTS.onReady(function () {
      if (document.getElementById('view-dashboard') &&
          !document.getElementById('view-dashboard').hidden) {
        UI.renderDashboard();
      }
    });

    UI.renderDashboard();
  }

  function refresh() {
    UI.renderCurrent();
  }

  // ===== 会话流程 =====
  function startSession() {
    var built = SRS.buildSession(Date.now());
    if (!built) {
      UI.toast('今日任务已完成，明天再来吧');
      return;
    }
    var queue = Questions.assemble(built.words, Store.getWords());
    if (!queue.length) {
      UI.toast('暂无可练习的题目');
      return;
    }
    TTS.cancel();
    S = freshSession();
    S.queue = queue;
    S.startedAt = Date.now();
    S.totalScreens = queue.length;

    UI.showView('practice');
    UI.renderPracticeHeader(S.totalScreens);
    nextQuestion();
  }

  function nextQuestion() {
    if (S.idx < S.queue.length) {
      S.current = S.queue[S.idx];
      S.idx++;
      showCurrent();
      return;
    }
    if (S.requeue.length) {
      var q = S.requeue.shift();
      q.id = q.id + '_r';
      S.current = q;
      showCurrent();
      return;
    }
    finishSession();
  }

  function showCurrent() {
    S.locked = false;
    var h = {
      onAnswer: handleChoice,
      onSpell: handleSpell,
      onReplay: function () { TTS.speak(S.current.word); },
      onMatchingDone: handleMatchingDone
    };
    UI.renderQuestion(S.current, h);
    if (S.current.autoSpeak) TTS.speak(S.current.word);
    persist();
  }

  // ===== 判定与落库 =====
  function handleChoice(choiceId) {
    if (S.locked) return;
    var q = S.current;
    var res = Questions.check(q, choiceId);
    S.locked = true;
    markOption(q, choiceId, res);
    UI.showFeedback(res.correct, res.correctText, function () {
      proceed(q, res.correct, q.type);
    });
    applyResult(q, res.correct);
  }

  // 在选项上标出对错（feedback 显示期间）
  function markOption(q, choiceId, res) {
    var wrap = document.getElementById('q-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.opt').forEach(function (b, i) {
      b.disabled = true;
      var c = q.choices[i];
      if (c.correct) b.classList.add('correct');
      else if (c.id === choiceId && !res.correct) b.classList.add('wrong');
    });
  }

  function handleSpell(text) {
    if (S.locked) return;
    var q = S.current;
    var res = Questions.check(q, text);
    S.locked = true;
    if (res.correct) {
      UI.showFeedback(true, res.correctText, function () {
        proceed(q, true, 'spelling');
      });
      applyResult(q, true);
    } else {
      // 答错：立即判定落库，反馈后进入照抄纠正（纠正不计入）
      UI.showFeedback(false, res.correctText, function () {
        UI.renderSpellCorrection(q, function () {
          proceed(q, false, 'spelling');
        });
      });
      applyResult(q, false);
    }
  }

  // 首次判定即落库（SRS + 统计）；重问（_r 后缀）不重复落库
  function applyResult(q, correct) {
    if (q.id.slice(-2) === '_r') return;
    var word = Store.getWord(q.wordId);
    if (!word) return; // 会话中词被删：跳过
    var wasNew = SRS.isFresh(word);
    var t = SRS.applyAnswer(q.wordId, correct, Date.now());
    if (t) S.transitions.push(t);
    Store.recordAnswer(Store.dateKey(new Date()), correct, correct && wasNew);
    if (correct && wasNew) S.newLearned++;
    S.byType[q.type].t++;
    if (correct) S.byType[q.type].c++;
    if (!correct) S.requeue.push(q); // 错题结尾重问一次
    persist();
  }

  function proceed(q, correct, type) {
    S.answeredScreens++;
    UI.updateProgress(S.answeredScreens, S.totalScreens);
    nextQuestion();
  }

  // 配对题：逐词判定（连错过至少一次视为答错）
  function handleMatchingDone(pairs) {
    var today = Store.dateKey(new Date());
    pairs.forEach(function (p) {
      var ok = p.wrongAttempts === 0;
      var word = Store.getWord(p.wordId);
      if (!word) return;
      var wasNew = SRS.isFresh(word);
      var t = SRS.applyAnswer(p.wordId, ok, Date.now());
      if (t) S.transitions.push(t);
      Store.recordAnswer(today, ok, ok && wasNew);
      if (ok && wasNew) S.newLearned++;
      S.byType.matching.t++;
      if (ok) S.byType.matching.c++;
    });
    S.answeredScreens++;
    UI.updateProgress(S.answeredScreens, S.totalScreens);
    persist();
    nextQuestion();
  }

  function finishSession() {
    var total = 0, correct = 0;
    Object.keys(S.byType).forEach(function (k) {
      total += S.byType[k].t;
      correct += S.byType[k].c;
    });
    Store.recordSession(Store.dateKey(new Date()));
    TTS.cancel();
    UI.renderSummary({
      total: total,
      correct: correct,
      accuracy: total ? Math.round(correct / total * 100) : 0,
      byType: S.byType,
      transitions: S.transitions,
      newLearned: S.newLearned,
      durationMs: Date.now() - S.startedAt
    });
    Store.clearSession();
    S = null;
  }

  // ===== 会话内操作 =====
  function confirmAbandon() {
    UI.confirm({
      title: '退出练习',
      message: '进度已自动保存，退出后可从首页「继续上次练习」接着学。',
      confirmText: '退出',
      onConfirm: function () {
        TTS.cancel();
        S = null;
        goHome();
      }
    });
  }

  function resumeSession() {
    var saved = Store.getSession();
    if (!saved || !saved.queue || !saved.queue.length) {
      UI.toast('没有可继续的练习');
      return;
    }
    TTS.cancel();
    S = saved;
    UI.showView('practice');
    UI.renderPracticeHeader(S.totalScreens);
    UI.updateProgress(S.answeredScreens, S.totalScreens);
    showCurrent();
  }

  function toggleTTS() {
    var s = Store.getSettings();
    Store.setSettings({ ttsEnabled: !s.ttsEnabled });
    if (!Store.getSettings().ttsEnabled) TTS.cancel();
    UI.updateSpeakerIcon();
    UI.toast(Store.getSettings().ttsEnabled ? '已开启发音' : '已关闭发音');
  }

  function goHome() {
    S = null;
    TTS.cancel();
    UI.showView('dashboard');
  }

  return {
    init: init,
    refresh: refresh,
    startSession: startSession,
    resumeSession: resumeSession,
    confirmAbandon: confirmAbandon,
    toggleTTS: toggleTTS,
    goHome: goHome
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
