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

['storage.js', 'srs.js', 'questions.js', 'import.js'].forEach(function (f) {
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

var r = Store.addWord({ word: 'Apple', meaning: 'n. 苹果', day: 1 });
assert(r.status === 'added', '添加新词');
var w = Store.getWords()[0];
assert(w.word === 'apple', '单词被小写化');
assert(w.day === 1, '记录天数');

r = Store.addWord({ word: 'apple', meaning: '苹果' });
assert(r.status === 'updated', '重复添加走合并更新');
assert(Store.getWords()[0].meaning === 'n. 苹果；苹果', '词义按「；」去重合并');

r = Store.addWord({ word: '123abc', meaning: 'x' });
assert(r.status === 'skipped', '非法单词被拒绝');

r = Store.addWord({ word: '*actor', meaning: 'n. 演员' });
assert(r.status === 'added' && Store.getWord(r.wordId).word === 'actor', '* 派生词标记被去掉');

r = Store.addWord({ word: 'behavio(u)r', meaning: 'n. 行为' });
assert(r.status === 'added', '变体写法 behave(u)r 可导入');

assert(Store.normalizeWord('résumé') === 'resume', '重音符号被剥离（résumé→resume）');
assert(Store.normalizeWord('lie①') === 'lie', '带圈序号被剥离（lie①→lie）');

Store.setSettings({ ttsRate: 2, sessionSize: 100 });
var s = Store.getSettings();
assert(s.ttsRate === 1.5 && s.sessionSize === 30, '设置数值钳制');
assert(!('dailyNewWords' in s), '每日新词上限设置已移除');

assert(/^\d{4}-\d{2}-\d{2}$/.test(Store.dateKey(new Date())), '本地日期键格式');

// 会话恢复
Store.saveSession({ queue: [{ id: 'x' }], idx: 1 });
assert(Store.getSession().queue.length === 1, '会话落盘/读取');
Store.clearSession();
assert(Store.getSession() === null, '会话清除');

// 知识库载入记录
assert(Store.getSeededKBs().length === 0, '初始未载入任何知识库');
Store.setSeededKBs(['核心词汇']);
assert(Store.getSeededKBs()[0] === '核心词汇', '知识库载入记录读写');
Store.setSeededKBs([]);

// v1 → v2 迁移：去掉音标/例句、补 day
backing.set('wordfun.data', JSON.stringify({
  version: 1,
  words: { a: { id: 'a', word: 'apple', phonetic: '/x/', meaning: '苹果', example: 'e', box: 1, correctCount: 1, nextReviewAt: 0, createdAt: 1, updatedAt: 1 } }
}));
Store.reload();
var mig = Store.getWords()[0];
assert(!('phonetic' in mig) && !('example' in mig) && mig.day === 0, 'v1 迁移去音标/例句并补 day=0');

var backup = Store.exportJSON();
Store.clearAll();
r = Store.importJSON(backup);
assert(r.ok && Store.getWords().length === 1, 'JSON 备份导出导入往返');
r = Store.importJSON('{not json');
assert(!r.ok, '非法 JSON 导入被拒绝');

console.log('\n== SRS（按天规划）==');
Store.clearAll();
var d1 = ['apple', 'banana', 'cherry', 'dog', 'egg', 'fish'];
var d2 = ['grape', 'house'];
var d1ids = d1.map(function (x) { return Store.addWord({ word: x, meaning: '义 ' + x, day: 1 }).wordId; });
var d2ids = d2.map(function (x) { return Store.addWord({ word: x, meaning: '义 ' + x, day: 2 }).wordId; });
var now = Date.now();

var session = SRS.buildSession(now);
assert(session && session.studyDay === 1, '当前学习天 = 第 1 天');
assert(session.words.length === 6, '第 1 天 6 个新词全部进入会话');
assert(session.words.every(function (x) { return x.day === 1; }), '只含第 1 天的词');

SRS.applyAnswer(d1ids[0], true, now);
SRS.applyAnswer(d1ids[1], true, now);
session = SRS.buildSession(now);
assert(session.words.length === 4, '学过 2 个后剩 4 个第 1 天新词');
assert(session.studyDay === 1, '未学完仍停在第 1 天');

SRS.applyAnswer(d1ids[2], true, now);
SRS.applyAnswer(d1ids[3], true, now);
SRS.applyAnswer(d1ids[4], true, now);
SRS.applyAnswer(d1ids[5], true, now);
session = SRS.buildSession(now);
assert(session.studyDay === 2, '第 1 天学完自动进入第 2 天');
assert(session.words.length === 2 && session.words.every(function (x) { return x.day === 2; }), '进入第 2 天');

SRS.applyAnswer(d2ids[0], true, now);
SRS.applyAnswer(d2ids[1], true, now);
session = SRS.buildSession(now);
assert(session === null, '全部学完且无到期词返回 null');

// 到期词优先（最多占一半）
Store.clearAll();
var ids = ['apple', 'banana', 'cherry', 'dog', 'egg'].map(function (x) {
  return Store.addWord({ word: x, meaning: '义 ' + x, day: 1 }).wordId;
});
Store.updateWord(ids[0], { box: 1, nextReviewAt: now - 3 * 86400000 });
Store.updateWord(ids[1], { box: 1, nextReviewAt: now - 86400000 });
Store.updateWord(ids[2], { box: 0, nextReviewAt: 0, correctCount: 1 });
session = SRS.buildSession(now);
assert(session.words.length === 5, '3 到期 + 2 新词');
assert(session.words[0].id === ids[2], '答错待重练词最优先');
assert(session.words[1].id === ids[0] && session.words[2].id === ids[1], '逾期更久的优先');
assert(SRS.isFresh(session.words[3]) && SRS.isFresh(session.words[4]), '新词殿后');

assert(SRS.relativeTimeText(Store.getWord(ids[3]), now) === '新词', '相对时间：新词');
assert(SRS.relativeTimeText(Store.getWord(ids[0]), now) === '已到期', '相对时间：已到期');

console.log('\n== Questions ==');
Store.clearAll();
['apple', 'banana', 'cherry', 'dog', 'egg', 'fish', 'grape', 'house', 'ice', 'juice'].forEach(function (x, i) {
  Store.addWord({ word: x, meaning: '词义' + i, day: 1 });
});
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

var wq = allWords[0];
var cq = Questions.genChoice(wq, allWords, 'w2m');
assert(cq.promptText === wq.word, 'w2m 题干是单词（修复选项乱序）');
assert(cq.choices.filter(function (c) { return c.correct; })[0].text === wq.meaning, 'w2m 正确选项是词义');
assert(cq.autoSpeak === false, '选择题不自动朗读');
var mq = Questions.genChoice(wq, allWords, 'm2w');
assert(mq.promptText === wq.meaning, 'm2w 题干是词义');
assert(mq.choices.filter(function (c) { return c.correct; })[0].text === wq.word, 'm2w 正确选项是单词');

var tenWords = allWords.slice(0, 10);
var queue = Questions.assemble(tenWords, allWords);
assert(queue.length === 6, 'assemble(10) = 5 单题 + 1 配对轮：实际 ' + queue.length);
assert(queue[5].type === 'matching' && queue[5].pairs.length === 5, '配对轮收尾且 5 对');

var mg = Questions.genMatching(tenWords.slice(0, 5));
assert(mg && mg.pairs.length === 5, '配对题生成 5 对');
assert(mg.rightOrder && mg.rightOrder.length === 5, '配对题带右列打乱顺序');
assert(mg.rightOrder.slice().sort().join(',') === '0,1,2,3,4', '右列打乱顺序是 0..4 的排列');
var pairRightOk = mg.pairs.every(function (p) {
  var w = Store.getWord(p.wordId);
  return w && p.right === w.meaning;
});
assert(pairRightOk, '配对题每对 right 为该词真实词义（修复答案键错位）');
assert(queue.slice(0, 5).map(function (q2) { return q2.type; }).join(',') === 'choice,choice,spelling,choice,choice',
  '题型轮转（看词选义 / 看义选词 / 拼写）');

var sq = Questions.genSpelling(allWords[0]);
assert(sq.subText === '', '拼写题不再显示例句');
assert(Questions.check(sq, 'APPLE').correct, '拼写判定容忍大小写');
assert(Questions.check(sq, '  apple  ').correct, '拼写判定容忍首尾空格');
assert(!Questions.check(sq, 'app le').correct, '拼写判定拒绝中间空格');

var ccq = Questions.genChoice(allWords[0], allWords, 'w2m');
var correctId = ccq.choices.filter(function (c) { return c.correct; })[0].id;
var wrongId = ccq.choices.filter(function (c) { return !c.correct; })[0].id;
assert(Questions.check(ccq, correctId).correct, '选择题正确答案判定');
assert(!Questions.check(ccq, wrongId).correct, '选择题错误答案判定');

var rq = Questions.genRetry(sq, allWords);
assert(rq && rq.type === 'choice', '拼写错题换题型重问 → 选择题');
assert(rq.wordId === sq.wordId, '重问题指向同一个词');
var rq2 = Questions.genRetry(ccq, allWords);
assert(rq2 && rq2.type === 'choice' && rq2.direction === 'm2w', '看词选义错题 → 换为看义选词重问');
var rq3 = Questions.genRetry(Questions.genChoice(allWords[0], allWords, 'm2w'), allWords);
assert(rq3 && rq3.type === 'choice' && rq3.direction === 'w2m', '看义选词错题 → 换为看词选义重问');

console.log('\n== Importer ==');
var parsed = Importer.parseText(
  '所属天/单元,单词,词性及中文释义\n' +
  '第1天 Unit 1 Lesson 1,act,v.行动;表现得;扮演 n.行为\n' +
  '第1天 Unit 1 Lesson 1,*actor,n.演员;扮演者\n' +
  '第1天 Unit 1 Lesson 2,,'
);
assert(parsed.rows.length === 2, '3 列课程格式解析 2 词：实际 ' + parsed.rows.length);
assert(parsed.skipped.length === 2, '跳过表头 + 单元标头');
assert(parsed.rows[0].word === 'act' && parsed.rows[0].day === 1 && parsed.rows[0].meaning === 'v.行动;表现得;扮演 n.行为', '第 1 天 + 词义解析');
assert(parsed.rows[1].word === 'actor', '* 前缀被去掉');

var p2 = Importer.parseText('word,meaning\napple,n. 苹果');
assert(p2.rows.length === 1 && p2.rows[0].word === 'apple' && p2.rows[0].day === 0, '2 列格式解析（无天数为自由词）');

var csv = Importer.parseCSVLine('"hello, world","n. 你好"');
assert(csv.length === 2 && csv[0] === 'hello, world', '引号内逗号不切分');

var parsed2 = Importer.parseText('"hello, world","n. 你好"');
assert(parsed2.rows.length === 0 && parsed2.skipped.length === 1, '含逗号单词被判定为非法（正则不允许）');

var parsed3 = Importer.parseText('单词，词义\napple，苹果');
assert(parsed3.rows.length === 1 && parsed3.rows[0].meaning === '苹果', '全角逗号与中文表头');

Store.clearAll();
var merged = Importer.mergeIntoStore(Importer.parseText('第1天 Unit 1,apple,n. 苹果\n第2天 Unit 1,book,n. 书').rows);
assert(merged.added === 2, '按天导入 2 词');
var iw = Store.getWords();
assert(iw[0].word === 'apple' && iw[0].day === 1, '导入词带 day=1');
assert(iw[1].word === 'book' && iw[1].day === 2, '导入词带 day=2');

Store.clearAll();
merged = Importer.mergeIntoStore(Importer.parseText('apple,苹果\napple,apple的意思').rows);
assert(merged.added === 1 && merged.updated === 1, '批内重复：1 新增 1 更新');
var ap = Store.getWords()[0];
assert(ap.meaning === '苹果；apple的意思', '批内重复词义合并');
Store.updateWord(ap.id, { box: 3, nextReviewAt: 123456789 });
Importer.mergeIntoStore(Importer.parseText('apple,苹果').rows);
assert(Store.getWord(ap.id).box === 3, '重复导入保留学习进度');

var csvOut = Importer.exportCSV(Store.getWords());
assert(csvOut.charCodeAt(0) === 0xFEFF, '导出 CSV 带 BOM 头');
assert(csvOut.indexOf('所属天/单元,单词,词义') !== -1, '导出 CSV 表头正确');

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
