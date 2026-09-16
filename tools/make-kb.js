/* 词趣 WordFun — 知识库打包脚本
   把 data/ 下所有 *.csv 打包成 data/kb.js（window.WORDFUN_KBS 数组）。
   每个 CSV 文件名（去掉 .csv）即为该知识库的名字，站内按名去重导入。

   用法：node tools/make-kb.js
   添加新知识库：把新的 CSV 放进 data/ 目录，重跑本脚本，再重新部署即可。
*/
'use strict';

var fs = require('fs');
var path = require('path');

var dataDir = path.join(__dirname, '..', 'data');
var files = fs.readdirSync(dataDir)
  .filter(function (f) { return /\.csv$/i.test(f); })
  .sort();

if (!files.length) {
  console.error('data/ 目录下没有 CSV 文件');
  process.exit(1);
}

var parts = [];
files.forEach(function (f) {
  var name = f.replace(/\.csv$/i, '');
  var text = fs.readFileSync(path.join(dataDir, f), 'utf8');
  parts.push('window.WORDFUN_KBS.push({ name: ' + JSON.stringify(name) + ', text: ' + JSON.stringify(text) + ' });');
});

var out = '/* 词趣 WordFun — 知识库数据（由 tools/make-kb.js 从 data/*.csv 生成，请勿手改） */\n' +
  'window.WORDFUN_KBS = window.WORDFUN_KBS || [];\n' +
  parts.join('\n') + '\n';

var target = path.join(dataDir, 'kb.js');
fs.writeFileSync(target, out, 'utf8');
console.log('已生成 data/kb.js：包含 ' + files.length + ' 个知识库（' + files.join(', ') + '）');
console.log('  大小 ' + (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1) + ' KB');
