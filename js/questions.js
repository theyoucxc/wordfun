/* 词趣 WordFun — 题目生成器（纯函数，不碰 DOM 与 Store 之外的状态） */
window.Questions = (function () {
  'use strict';

  var seq = 0;
  function nextId(t) {
    seq++;
    return 'q' + t + '_' + seq;
  }

  // Fisher-Yates 洗牌（返回新数组）
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // 干扰项：全库剔除本词、剔除与正确项 text 相同的词后随机取
  function pickDistractors(word, allWords, field, count) {
    var pool = allWords.filter(function (w) {
      return w.id !== word.id && w[field] && w[field] !== word[field];
    });
    return shuffle(pool).slice(0, count).map(function (w) {
      return { wordId: w.id, text: w[field] };
    });
  }

  function buildChoices(correct, distractors) {
    return shuffle([{ text: correct.text, correct: true }].concat(
      distractors.map(function (d) { return { text: d.text, correct: false }; })
    )).map(function (c, i) {
      return { id: 'c' + i, text: c.text, correct: c.correct };
    });
  }

  // 四选一：direction 'w2m' 看词选义（题干=单词，选项=词义）/ 'm2w' 看义选词（题干=词义，选项=单词）
  function genChoice(word, allWords, direction) {
    if (!word.meaning) return null;
    var field = direction === 'w2m' ? 'meaning' : 'word';
    var correct = { text: direction === 'w2m' ? word.meaning : word.word };
    var dist = pickDistractors(word, allWords, field, 3);
    if (dist.length < 1) return null;
    return {
      id: nextId('c'),
      type: 'choice',
      direction: direction,
      wordId: word.id,
      word: word.word,
      promptText: direction === 'w2m' ? word.word : word.meaning,
      subText: '',
      autoSpeak: false,
      choices: buildChoices(correct, dist.slice(0, 3)),
      answer: ''
    };
  }

  // 拼写：显示词义，用户拼写
  function genSpelling(word) {
    if (!word.meaning) return null;
    return {
      id: nextId('s'),
      type: 'spelling',
      wordId: word.id,
      word: word.word,
      promptText: word.meaning,
      subText: '',
      autoSpeak: false,
      choices: null,
      answer: word.word
    };
  }

  // 配对：N 词配 N 义，左列单词保持原序、右列词义按 rightOrder 打乱显示，至少 2 对
  function genMatching(group) {
    var items = group.filter(function (w) { return w.meaning; });
    if (items.length < 2) return null;
    // 每对 right 存「该词的真实词义」作为判定答案键；右列显示顺序由 rightOrder 单独打乱
    var pairs = items.map(function (w) {
      return { wordId: w.id, left: w.word, right: w.meaning, wrongAttempts: 0 };
    });
    var rightOrder = [];
    for (var i = 0; i < pairs.length; i++) rightOrder.push(i);
    rightOrder = shuffle(rightOrder);
    return {
      id: nextId('m'),
      type: 'matching',
      wordId: null,
      word: '',
      promptText: '',
      subText: '',
      autoSpeak: false,
      choices: null,
      answer: '',
      pairs: pairs,
      rightOrder: rightOrder
    };
  }

  // 错题重问：换一种题型（看词选义 ↔ 看义选词 ↔ 拼写）复习同一个词
  function genRetry(originalQ, allWords) {
    var word = null;
    for (var i = 0; i < allWords.length; i++) {
      if (allWords[i].id === originalQ.wordId) { word = allWords[i]; break; }
    }
    if (!word) return null;
    if (originalQ.type === 'spelling') {
      return genChoice(word, allWords, 'w2m') || genChoice(word, allWords, 'm2w') || genSpelling(word);
    }
    if (originalQ.type === 'choice') {
      var alt = originalQ.direction === 'w2m' ? 'm2w' : 'w2m';
      return genChoice(word, allWords, alt) || genSpelling(word) || genChoice(word, allWords, originalQ.direction);
    }
    return null;
  }

  // 会话组装：每 10 词含 1 轮配对（放末尾），其余按 3 题型轮转（发音功能已暂停，无听音题）
  function assemble(selectedWords, allWords) {
    var n = selectedWords.length;
    var matchingRounds = Math.floor(n / 10);
    var matchCount = matchingRounds * 5;
    var matchingWords = selectedWords.slice(n - matchCount);
    var singleWords = selectedWords.slice(0, n - matchCount);

    var pattern = ['w2m', 'm2w', 'spelling'];

    var singles = [];
    singleWords.forEach(function (w, i) {
      var t = pattern[i % 3];
      var q = null;
      if (t === 'w2m' || t === 'm2w') q = genChoice(w, allWords, t);
      else q = genSpelling(w);
      if (!q) {
        // 兜底：尝试任意可用题型
        q = genChoice(w, allWords, 'w2m') || genChoice(w, allWords, 'm2w') || genSpelling(w);
      }
      if (q) singles.push(q);
    });

    var rounds = [];
    for (var r = 0; r < matchingRounds; r++) {
      var m = genMatching(matchingWords.slice(r * 5, r * 5 + 5));
      if (m) rounds.push(m);
    }
    return singles.concat(rounds);
  }

  // 判定：choice 传选项 id；spelling 传用户输入
  function check(q, userAnswer) {
    if (q.type === 'spelling') {
      var ok = norm(userAnswer) === norm(q.answer);
      return { correct: ok, correctText: q.answer };
    }
    var choice = null, correctChoice = null;
    for (var i = 0; i < q.choices.length; i++) {
      if (q.choices[i].id === userAnswer) choice = q.choices[i];
      if (q.choices[i].correct) correctChoice = q.choices[i];
    }
    return {
      correct: !!choice && choice.correct,
      correctText: correctChoice ? correctChoice.text : ''
    };
  }

  return {
    shuffle: shuffle,
    pickDistractors: pickDistractors,
    genChoice: genChoice,
    genSpelling: genSpelling,
    genMatching: genMatching,
    genRetry: genRetry,
    assemble: assemble,
    check: check
  };
})();
