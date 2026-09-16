/* 词趣 WordFun — 导入预览：用真实解析逻辑预览一个 CSV/TXT 的导入结果与按天分布。
   用法：node tools/import-preview.js <csv文件路径> */
'use strict';

var fs = require('fs');
var path = require('path');

var backing = new Map();
global.window = global;
global.localStorage = {
  getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
  setItem: function (k, v) { backing.set(k, String(v)); },
  removeItem: function (k) { backing.delete(k); }
};

['storage.js', 'srs.js', 'questions.js', 'tts.js', 'import.js'].forEach(function (f) {
  var code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  (0, eval)(code);
});

var csvPath = process.argv[2];
if (!csvPath) { console.error('用法：node tools/import-preview.js <csv文件路径>'); process.exit(1); }
var text = fs.readFileSync(csvPath, 'utf8');

var parsed = Importer.parseText(text);
var rows = parsed.rows, skipped = parsed.skipped;

var byDay = {};
rows.forEach(function (r) { byDay[r.day] = (byDay[r.day] || 0) + 1; });
var days = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });

var starCount = (text.match(/,(\*[a-z])/g) || []).length;

// 模拟入库，得到去重后的唯一词数
Store.clearAll();
Importer.mergeIntoStore(rows);
var uniqCount = Store.getWords().length;

console.log('══════ 导入预览 ══════');
console.log('解析行数：' + rows.length + ' → 去重入库后唯一单词 ' + uniqCount + ' 个');
console.log('天数范围：第 ' + days[0] + ' 天 ~ 第 ' + days[days.length - 1] + ' 天（共 ' + days.length + ' 天）');
console.log('去掉 * 的派生词：' + starCount + ' 个');
console.log('跳过行数：' + skipped.length + ' 行');
var reasons = {};
skipped.forEach(function (s) { reasons[s.reason] = (reasons[s.reason] || 0) + 1; });
Object.keys(reasons).forEach(function (k) { console.log('  · ' + k + '：' + reasons[k]); });

console.log('\n各天单词数：');
days.forEach(function (d) {
  var sample = rows.filter(function (r) { return r.day === d; }).slice(0, 3)
    .map(function (r) { return r.word + ' → ' + r.meaning.slice(0, 22); });
  console.log('  第 ' + d + ' 天：' + byDay[d] + ' 词   例：' + sample.join(' | '));
});

console.log('\n今天（第 1 天）将学习的新词（前 10 个）：');
rows.filter(function (r) { return r.day === days[0]; }).slice(0, 10)
  .forEach(function (r) { console.log('  ' + r.word + '  ' + r.meaning.slice(0, 40)); });
