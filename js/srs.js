/* 词趣 WordFun — 间隔重复（Leitner 盒子）：间隔表、答题更新、会话选词、相对时间文案 */
window.SRS = (function () {
  'use strict';

  var DAY_MS = 86400000;
  // 下标 = box 等级 0..5；box 0 = 新词/答错词（无间隔），box 5 = 已掌握每 30 天循环
  var INTERVALS_DAYS = [0, 1, 3, 7, 14, 30];

  function isDue(w, now) {
    if (w.nextReviewAt === 0) {
      // box 0 且从未答对 = 真新词（不属于到期池）；答错待重练的立即到期
      return w.correctCount > 0;
    }
    return w.nextReviewAt <= now;
  }

  function isFresh(w) {
    return w.box === 0 && w.correctCount === 0;
  }

  // 答对/答错更新并落库，返回 { wordId, word, fromBox, toBox, correct }；词不存在返回 null
  function applyAnswer(id, isCorrect, now) {
    var w = Store.getWord(id);
    if (!w) return null;
    var fromBox = w.box;
    if (isCorrect) {
      w.box = Math.min(w.box + 1, 5);
      w.nextReviewAt = now + INTERVALS_DAYS[w.box] * DAY_MS;
      w.correctCount++;
      w.streak++;
    } else {
      w.box = 0;
      w.nextReviewAt = 0;
      w.wrongCount++;
      w.streak = 0;
    }
    Store.updateWord(id, {
      box: w.box,
      nextReviewAt: w.nextReviewAt,
      correctCount: w.correctCount,
      wrongCount: w.wrongCount,
      streak: w.streak
    });
    return { wordId: id, word: w.word, fromBox: fromBox, toBox: w.box, correct: isCorrect };
  }

  // 会话选词：80% 到期词优先 + 20% 新词（受每日上限约束）；无词可练返回 null
  function buildSession(now) {
    var settings = Store.getSettings();
    var words = Store.getWords();
    if (!words.length) return null;

    var today = Store.dateKey(new Date(now));
    var quotaLeft = Math.max(0, settings.dailyNewWords - Store.todayLearned(today));

    var due = [], fresh = [];
    words.forEach(function (w) {
      if (isFresh(w)) fresh.push(w);
      else if (isDue(w, now)) due.push(w);
    });

    due.sort(function (a, b) {
      // 逾期时长降序：box0 待重练视为最紧急
      var ovA = a.box > 0 ? (now - a.nextReviewAt) : Infinity;
      var ovB = b.box > 0 ? (now - b.nextReviewAt) : Infinity;
      if (ovB !== ovA) return ovB - ovA;
      if (a.box !== b.box) return a.box - b.box;
      return b.wrongCount - a.wrongCount;
    });
    fresh.sort(function (a, b) { return a.createdAt - b.createdAt; });

    var size = Math.min(settings.sessionSize, due.length + Math.min(fresh.length, quotaLeft));
    if (!size) return null;

    var targetNew = Math.min(Math.round(size * 0.2), quotaLeft);
    var dueCount = Math.min(due.length, size - targetNew);
    var newCount = Math.min(size - dueCount, fresh.length, quotaLeft);
    if (dueCount === 0 && newCount === 0) return null;

    var selected = due.slice(0, dueCount).concat(fresh.slice(0, newCount));
    return {
      words: selected,
      quotaLeft: quotaLeft,
      dueTotal: due.length,
      newTotal: fresh.length
    };
  }

  // 相对时间文案（词库列表用）
  function relativeTimeText(w, now) {
    if (isFresh(w)) return '新词';
    if (w.nextReviewAt === 0) return '待复习';
    if (w.nextReviewAt <= now) return '已到期';
    var days = Math.ceil((w.nextReviewAt - now) / DAY_MS);
    return days <= 1 ? '今天' : days + ' 天后';
  }

  return {
    INTERVALS_DAYS: INTERVALS_DAYS,
    isDue: isDue,
    isFresh: isFresh,
    applyAnswer: applyAnswer,
    buildSession: buildSession,
    relativeTimeText: relativeTimeText
  };
})();
