/* 词趣 WordFun — 导入导出：文本/CSV 解析（按天 3 列 / 单词+词义 2 列）、编码检测、CSV 导出 */
window.Importer = (function () {
  'use strict';

  var MAX_FILE_SIZE = 1024 * 1024; // 1MB

  // 去首尾成对引号（含中文引号）
  function stripQuotes(s) {
    s = String(s || '').trim();
    if (s.length >= 2) {
      var first = s[0], last = s[s.length - 1];
      if ((first === '"' && last === '"') || (first === '“' && last === '”')) {
        s = s.slice(1, -1).trim();
      }
    }
    return s;
  }

  // 引号感知 CSV 行解析（"" 转义为字面 "）
  function parseCSVLine(line) {
    var fields = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(function (f) { return f.trim(); });
  }

  // 全角逗号/引号归一为半角
  function normalizeFullWidth(s) {
    return String(s).replace(/，/g, ',').replace(/“/g, '"').replace(/”/g, '"');
  }

  // 从「第N天 Unit X Lesson Y」提取天数
  function parseDay(cell) {
    var m = String(cell || '').match(/第\s*(\d+)\s*天/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // 表头启发式：同时含「单词」类与「词义」类字段即视为表头
  function isHeaderLine(line) {
    var fields = parseCSVLine(normalizeFullWidth(line)).map(function (s) { return s.toLowerCase(); });
    if (fields.length < 2) return false;
    var hasWord = fields.some(function (s) { return /单词|word|英文|词汇/.test(s); });
    var hasMean = fields.some(function (s) { return /词义|释义|中文|意思|meaning/.test(s); });
    return hasWord && hasMean;
  }

  // 单行解析：3 列（所属天/单元,单词,词义）→ 带 day；否则 2 列（单词,词义）
  function parseLine(line) {
    var fields = parseCSVLine(normalizeFullWidth(line));
    if (fields.length >= 3 && parseDay(fields[0]) > 0) {
      return {
        day: parseDay(fields[0]),
        word: fields[1] || '',
        meaning: fields.slice(2).map(stripQuotes).filter(Boolean).join('，')
      };
    }
    return {
      day: 0,
      word: stripQuotes(fields[0] || ''),
      meaning: fields.slice(1).map(stripQuotes).filter(Boolean).join('，')
    };
  }

  // 整体解析：去 BOM → 分行 → 跳表头 → 逐行规范化
  function parseText(text) {
    var rows = [];
    var skipped = [];
    var lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean);

    lines.forEach(function (line, idx) {
      var lineNo = idx + 1;
      if (idx === 0 && isHeaderLine(line)) {
        skipped.push({ lineNo: lineNo, line: line, reason: '表头已跳过' });
        return;
      }
      var p = parseLine(line);
      var word = Store.normalizeWord(p.word); // 去派生词标记 *、小写化
      if (!word) {
        // 单元标头行（如「第1天 Unit 1 Lesson 1,,」）无单词，静默跳过
        skipped.push({ lineNo: lineNo, line: line, reason: '单元标头（无单词）' });
        return;
      }
      if (!Store.isValidWord(word)) {
        skipped.push({ lineNo: lineNo, line: line, reason: '单词格式不合法' });
        return;
      }
      var meaning = String(p.meaning || '').trim();
      if (!meaning) {
        skipped.push({ lineNo: lineNo, line: line, reason: '缺少词义' });
        return;
      }
      rows.push({ word: word, meaning: meaning, day: p.day });
    });

    return { rows: rows, skipped: skipped };
  }

  // 批量合并入库（去重合并逻辑在 Store.addWord；批量期间只落盘一次）
  function mergeIntoStore(rows) {
    var added = 0, updated = 0;
    Store.beginBatch();
    try {
      rows.forEach(function (r) {
        var res = Store.addWord(r);
        if (res.status === 'added') added++;
        else if (res.status === 'updated') updated++;
      });
    } finally {
      Store.endBatch();
    }
    return { added: added, updated: updated };
  }

  // 文件 → 文本：UTF-8 解码失败（出现替换符）时回退 GBK（中文 Excel 导出的 CSV）
  async function fileToText(file) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('文件超过 1MB，请拆分成小文件');
    }
    var buf = await file.arrayBuffer();
    var text = new TextDecoder('utf-8').decode(buf);
    if (text.indexOf('�') !== -1) {
      try {
        text = new TextDecoder('gbk').decode(buf);
      } catch (e) { /* 保留 UTF-8 结果 */ }
    }
    return text;
  }

  // CSV 词表导出（BOM 头保证 Excel 中文不乱码；含天数列，重新导入可还原天数）
  function exportCSV(words) {
    function esc(s) {
      s = String(s || '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = ['所属天/单元,单词,词义'];
    words.forEach(function (w) {
      var dayLabel = w.day ? '第' + w.day + '天' : '';
      lines.push([dayLabel, w.word, w.meaning].map(esc).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  return {
    parseText: parseText,
    parseLine: parseLine,
    parseCSVLine: parseCSVLine,
    parseDay: parseDay,
    mergeIntoStore: mergeIntoStore,
    fileToText: fileToText,
    exportCSV: exportCSV
  };
})();
