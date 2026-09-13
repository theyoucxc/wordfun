/* 词趣 WordFun — 逻辑层测试（Node 运行：node test.js） */
'use strict';

var fs = require('fs');
var path = require('path');

// --- 环境垫片（localStorage / window） ---
var backing = new Map();
global.window = global;
global.localStorage = {
  getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
  setItem: function (k, v) { backing.set(k, String(v)); },
  removeItem: function (k) { backing.delete(k); }
};

['storage.js', 'srs.js', 'questions.js', 'tts.js', 'import.js'].forEach(function (f) {
  var code = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
  (0, eval)(code);
});

var passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

console.log('\n== Store ==');
Store.clearAll();
assert(Store.getWords().length === 0, '初始词库为空');

var r = Store.addWord({ word: 'Apple', meaning: 'n. 苹果' });
assert(r.status === 'added', '添加新词');
var w = Store.getWords()[0];
assert(w.word === 'apple', '单词被小写化');

r = Store.addWord({ word: 'apple', meaning: '苹果' });
assert(r.status === 'updated', '重复添加走合并更新');
assert(Store.getWords()[0].meaning === 'n. 苹果；苹果', '词义按「；」去重合并');

r = Store.addWord({ word: '123abc', meaning: 'x' });
assert(r.status === 'skipped', '非法单词被拒绝');

Store.setSettings({ ttsRate: 2, dailyNewWords: 0, sessionSize: 100 });
var s = Store.getSettings();
assert(s.ttsRate === 1.5 && s.dailyNewWords === 1 && s.sessionSize === 30, '设置数值钳制');

assert(/^\d{4}-\d{2}-\d{2}$/.test(Store.dateKey(new Date())), '本地日期键格式');

var backup = Store.exportJSON();
Store.clearAll();
r = Store.importJSON(backup);
assert(r.ok && Store.getWords().length === 1, 'JSON 备份导出导入往返');
r = Store.importJSON('{not json');
assert(!r.ok, '非法 JSON 导入被拒绝');

console.log('\n== SRS ==');
Store.clearAll();
var ids = ['apple', 'book', 'cat', 'dog', 'egg', 'fish', 'goat', 'house', 'ice', 'juice'].map(function (word, i) {
  return Store.addWord({ word: word, meaning: '词义' + i }).wordId;
});
var now = Date.now();

var session = SRS.buildSession(now);
assert(session && session.words.length === 10, '10 个新词全部进入会话');
assert(session.words.every(function (w) { return SRS.isFresh(w); }), '全部判定为真新词');

var t = SRS.applyAnswer(ids[0], true, now);
assert(t.fromBox === 0 && t.toBox === 1, '答对 0 级升 1 级');
var w0 = Store.getWord(ids[0]);
assert(Math.abs(w0.nextReviewAt - (now + 86400000)) < 5000, '复习间隔 +1 天');

SRS.applyAnswer(ids[1], true, now);
SRS.applyAnswer(ids[1], false, now + 10);
var w1 = Store.getWord(ids[1]);
assert(w1.box === 0 && w1.nextReviewAt === 0 && w1.correctCount === 1, '答错归零待重练');

Store.updateWord(ids[2], { box: 1, nextReviewAt: now - 86400000 });
Store.updateWord(ids[3], { box: 1, nextReviewAt: now - 2 * 86400000 });
session = SRS.buildSession(now);
assert(session.words.length === 9, '会话 = 3 到期 + 6 新词（到期不足由新词补满）：实际 ' + session.words.length);
assert(session.words[0].id === ids[1], '答错待重练词最优先');
assert(session.words[1].id === ids[3] && session.words[2].id === ids[2], '逾期更久的优先');
assert(session.words.slice(3).every(function (w) { return SRS.isFresh(w); }), '新词殿后');

Store.recordAnswer(Store.dateKey(new Date(now)), true, true);
Store.setSettings({ dailyNewWords: 1 });
session = SRS.buildSession(now);
assert(session.words.length === 3 && session.words.every(function (w) { return !SRS.isFresh(w); }),
  '新词配额用尽后不再引入新词');

assert(SRS.relativeTimeText(Store.getWord(ids[4]), now) === '新词', '相对时间：新词');
assert(SRS.relativeTimeText(Store.getWord(ids[2]), now) === '已到期', '相对时间：已到期');

console.log('\n== Questions ==');
var allWords = Store.getWords();
var ok = true;
for (var i = 0; i < 100; i++) {
  var q = Questions.genChoice(allWords[0], allWords, 'w2m');
  if (!q) { ok = false; break; }
  var texts = q.choices.map(function (c) { return c.text; });
  var correctText = q.choices.filter(function (c) { return c.correct; })[0].text;
  if (texts.filter(function (t2) { return t2 === correctText; }).length !== 1) ok = false;
  var uniq = {};
  texts.forEach(function (t2) { uniq[t2] = true; });
  if (Object.keys(uniq).length !== texts.length) ok = false;
}
assert(ok, '100 次循环：干扰项不含正确文本且选项无重复');

var tenWords = allWords.slice(0, 10);
var queue = Questions.assemble(tenWords, allWords);
assert(queue.length === 6, 'assemble(10) = 5 单题 + 1 配对轮：实际 ' + queue.length);
assert(queue[5].type === 'matching' && queue[5].pairs.length === 5, '配对轮收尾且 5 对');
assert(queue.slice(0, 5).map(function (q2) { return q2.type; }).join(',') === 'choice,choice,choice,spelling,choice',
  '题型轮转（TTS 不可用时听音降级为选择题）');

var sq = Questions.genSpelling(Store.getWord(ids[0]));
assert(Questions.check(sq, 'APPLE').correct, '拼写判定容忍大小写');
assert(Questions.check(sq, '  apple  ').correct, '拼写判定容忍首尾空格');
assert(!Questions.check(sq, 'app le').correct, '拼写判定拒绝中间空格');

var cq = Questions.genChoice(Store.getWord(ids[0]), allWords, 'w2m');
var correctId = cq.choices.filter(function (c) { return c.correct; })[0].id;
var wrongId = cq.choices.filter(function (c) { return !c.correct; })[0].id;
assert(Questions.check(cq, correctId).correct, '选择题正确答案判定');
assert(!Questions.check(cq, wrongId).correct, '选择题错误答案判定');

console.log('\n== Importer ==');
var parsed = Importer.parseText('word,meaning\napple,n. 苹果\nbook|/bʊk/|n. 书|I read a book.\n123,坏词\norange');
assert(parsed.rows.length === 2, '解析 2 行有效：实际 ' + parsed.rows.length);
assert(parsed.skipped.length === 3, '跳过 3 行（表头/非法词/缺词义）');
assert(parsed.rows[0].word === 'apple' && parsed.rows[0].meaning === 'n. 苹果', '逗号格式解析');
assert(parsed.rows[1].phonetic === '/bʊk/' && parsed.rows[1].example === 'I read a book.', '管道格式解析');

var csv = Importer.parseCSVLine('"hello, world","n. 你好"');
assert(csv.length === 2 && csv[0] === 'hello, world', '引号内逗号不切分');

var parsed2 = Importer.parseText('"hello, world","n. 你好"');
assert(parsed2.rows.length === 0 && parsed2.skipped.length === 1, '含逗号单词被判定为非法（正则不允许）');

var parsed3 = Importer.parseText('单词，词义\napple，苹果');
assert(parsed3.rows.length === 1 && parsed3.rows[0].meaning === '苹果', '全角逗号与中文表头');

Store.clearAll();
var merged = Importer.mergeIntoStore(Importer.parseText('apple,苹果\napple,apple的意思').rows);
assert(merged.added === 1 && merged.updated === 1, '批内重复：1 新增 1 更新');
var ap = Store.getWords()[0];
assert(ap.meaning === '苹果；apple的意思', '批内重复词义合并');
Store.updateWord(ap.id, { box: 3, nextReviewAt: 123456789 });
Importer.mergeIntoStore(Importer.parseText('apple,苹果').rows);
assert(Store.getWord(ap.id).box === 3, '重复导入保留学习进度');

var csvOut = Importer.exportCSV(Store.getWords());
assert(csvOut.charCodeAt(0) === 0xFEFF, '导出 CSV 带 BOM 头');
assert(csvOut.indexOf('word,phonetic,meaning,example') !== -1, '导出 CSV 表头正确');

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
