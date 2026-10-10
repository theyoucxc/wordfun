/* 词趣 WordFun — 间隔重复（Leitner 盒子）：间隔表、答题更新、按天会话选词、相对时间文案 */
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

  // 当前学习天（仅「日常」区域的 day>0 课程词）= 仍有未学新词的最小 day；
  // 学完当天自动进入下一天；全学完则取最大 day；无课程时为 0。
  // 基础区域的自由词（day=0）不参与天数计算。
  function currentStudyDay() {
    var words = Store.getWords();
    var minDay = Infinity, maxDay = 0;
    words.forEach(function (w) {
      if (w.day > 0 && w.day > maxDay) maxDay = w.day;
      if (w.day > 0 && isFresh(w) && w.day < minDay) minDay = w.day;
    });
    return minDay === Infinity ? maxDay : minDay;
  }

  // 生效的学习天：手动跳转（meta.studyDay > 0）优先，否则自动跟随进度
  function effectiveStudyDay() {
    var override = Store.getStudyDay();
    return override > 0 ? override : currentStudyDay();
  }

  // 某天尚未学过的新词数（用于判断当天是否学完、是否顺延到下一天）
  function freshInDay(day) {
    return Store.getWords().filter(function (w) {
      return w.day === day && isFresh(w);
    }).length;
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

  // 会话选词（分区域）：area = 'daily'（日常课程词，day>0）或 'basic'（基础自由词，day=0）。
  // 新词 = 该区域尚未学过的词（daily 取当前学习天，basic 取全部 day=0 新词）；
  // 复习 = 该区域到期词优先、最多占一半，剩余名额给新词；无词可练返回 null
  function buildSession(now, area) {
    area = area === 'basic' ? 'basic' : 'daily';
    var settings = Store.getSettings();
    var words = Store.getWords();
    if (!words.length) return null;

    var studyDay = area === 'basic' ? 0 : effectiveStudyDay();

    var due = [], fresh = [];
    words.forEach(function (w) {
      var inArea = area === 'basic' ? (w.day === 0) : (w.day > 0);
      if (!inArea) return;
      if (isFresh(w)) {
        if (area === 'basic' || w.day === studyDay) fresh.push(w);
      } else if (isDue(w, now)) {
        due.push(w);
      }
    });

    due.sort(function (a, b) {
      // 逾期时长降序：box0 待重练视为最紧急
      var ovA = a.box > 0 ? (now - a.nextReviewAt) : Infinity;
      var ovB = b.box > 0 ? (now - b.nextReviewAt) : Infinity;
      if (ovB !== ovA) return ovB - ovA;
      if (a.box !== b.box) return a.box - b.box;
      return b.wrongCount - a.wrongCount;
    });
    fresh.sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      return a.createdAt - b.createdAt;
    });

    var size = settings.sessionSize;
    var dueCount = Math.min(due.length, Math.ceil(size / 2));
    var newCount = Math.min(size - dueCount, fresh.length);
    // 新词不足时，把剩余名额还给复习
    if (newCount < size - dueCount) {
      dueCount = Math.min(due.length, size - newCount);
    }
    if (dueCount === 0 && newCount === 0) return null;

    var selected = due.slice(0, dueCount).concat(fresh.slice(0, newCount));
    return {
      words: selected,
      studyDay: studyDay,
      area: area,
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
    currentStudyDay: currentStudyDay,
    effectiveStudyDay: effectiveStudyDay,
    freshInDay: freshInDay,
    applyAnswer: applyAnswer,
    buildSession: buildSession,
    relativeTimeText: relativeTimeText
  };
})();
