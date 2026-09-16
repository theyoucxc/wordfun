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

  // 听音选义：只朗读不显示单词；词义为空或库不足 2 词返回 null（调用方降级 w2m）
  function genListening(word, allWords) {
    if (!word.meaning) return null;
    var dist = pickDistractors(word, allWords, 'meaning', 3);
    if (dist.length < 1) return null;
    return {
      id: nextId('l'),
      type: 'listening',
      wordId: word.id,
      word: word.word,
      promptText: '',
      subText: '',
      autoSpeak: true,
      choices: buildChoices({ text: word.meaning }, dist.slice(0, 3)),
      answer: ''
    };
  }

  // 拼写：显示词义，朗读，用户拼写
  function genSpelling(word) {
    if (!word.meaning) return null;
    return {
      id: nextId('s'),
      type: 'spelling',
      wordId: word.id,
      word: word.word,
      promptText: word.meaning,
      subText: '',
      autoSpeak: true,
      choices: null,
      answer: word.word
    };
  }

  // 配对：N 词配 N 义（右列洗牌），至少 2 对
  function genMatching(group) {
    var items = group.filter(function (w) { return w.meaning; });
    if (items.length < 2) return null;
    var meanings = shuffle(items).map(function (w) { return w.meaning; });
    var pairs = items.map(function (w, i) {
      return { wordId: w.id, left: w.word, right: meanings[i], wrongAttempts: 0 };
    });
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
      pairs: pairs
    };
  }

  // 会话组装：每 10 词含 1 轮配对（放末尾），其余按 4 题型轮转
  function assemble(selectedWords, allWords) {
    var n = selectedWords.length;
    var matchingRounds = Math.floor(n / 10);
    var matchCount = matchingRounds * 5;
    var matchingWords = selectedWords.slice(n - matchCount);
    var singleWords = selectedWords.slice(0, n - matchCount);

    var ttsOk = (typeof TTS !== 'undefined') && TTS.available();
    var pattern = ['w2m', 'm2w', ttsOk ? 'listening' : 'w2m', 'spelling'];

    var singles = [];
    singleWords.forEach(function (w, i) {
      var t = pattern[i % 4];
      var q = null;
      if (t === 'w2m' || t === 'm2w') q = genChoice(w, allWords, t);
      else if (t === 'listening') q = genListening(w, allWords) || genChoice(w, allWords, 'w2m');
      else q = genSpelling(w);
      if (!q) {
        // 兜底：尝试任意可用题型
        q = genChoice(w, allWords, 'w2m') || genChoice(w, allWords, 'm2w') ||
            genSpelling(w) || genListening(w, allWords);
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

  // 判定：choice/listening 传选项 id；spelling 传用户输入
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
    genListening: genListening,
    genSpelling: genSpelling,
    genMatching: genMatching,
    assemble: assemble,
    check: check
  };
})();
