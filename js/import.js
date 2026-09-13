/* 词趣 WordFun — 导入导出：文本/CSV 解析、编码检测、CSV 导出 */
window.Importer = (function () {
  'use strict';

  var HEADER_WORD = ['word', '单词', '英文', '词汇'];
  var HEADER_MEAN = ['meaning', '词义', '中文', '释义', '意思'];
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

  function isHeaderLine(line) {
    var f1 = '', f2 = '';
    if (line.indexOf('|') !== -1) {
      var p = line.split('|');
      f1 = stripQuotes(p[0]).toLowerCase();
      f2 = stripQuotes(p[1] || '').toLowerCase();
    } else if (line.indexOf(',') !== -1 || line.indexOf('，') !== -1) {
      var f = parseCSVLine(normalizeFullWidth(line));
      f1 = stripQuotes(f[0]).toLowerCase();
      f2 = stripQuotes(f[1] || '').toLowerCase();
    } else {
      return false;
    }
    return HEADER_WORD.indexOf(f1) !== -1 && HEADER_MEAN.indexOf(f2) !== -1;
  }

  // 单行解析：| 管道格式优先，其次逗号格式（最多 2 有效字段），否则整行视为单词
  function parseLine(line) {
    if (line.indexOf('|') !== -1) {
      var parts = line.split('|').map(stripQuotes);
      return {
        word: parts[0] || '',
        phonetic: parts[1] || '',
        meaning: parts[2] || '',
        example: parts.slice(3).join('|').trim()
      };
    }
    if (line.indexOf(',') !== -1 || line.indexOf('，') !== -1) {
      var fields = parseCSVLine(normalizeFullWidth(line));
      var meaningParts = fields.slice(1).map(stripQuotes).filter(Boolean);
      return {
        word: stripQuotes(fields[0] || ''),
        phonetic: '',
        meaning: meaningParts.join(', '),
        example: ''
      };
    }
    return { word: stripQuotes(line), phonetic: '', meaning: '', example: '' };
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
      var word = Store.normalizeWord(p.word);
      if (!Store.isValidWord(word)) {
        skipped.push({ lineNo: lineNo, line: line, reason: '单词格式不合法' });
        return;
      }
      var meaning = String(p.meaning || '').trim();
      if (!meaning) {
        skipped.push({ lineNo: lineNo, line: line, reason: '缺少词义' });
        return;
      }
      rows.push({
        word: word,
        phonetic: String(p.phonetic || '').trim(),
        meaning: meaning,
        example: String(p.example || '').trim()
      });
    });

    return { rows: rows, skipped: skipped };
  }

  // 批量合并入库（去重合并逻辑在 Store.addWord）
  function mergeIntoStore(rows) {
    var added = 0, updated = 0;
    rows.forEach(function (r) {
      var res = Store.addWord(r);
      if (res.status === 'added') added++;
      else if (res.status === 'updated') updated++;
    });
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

  // CSV 词表导出（BOM 头保证 Excel 中文不乱码）
  function exportCSV(words) {
    function esc(s) {
      s = String(s || '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = ['word,phonetic,meaning,example'];
    words.forEach(function (w) {
      lines.push([w.word, w.phonetic, w.meaning, w.example].map(esc).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  return {
    parseText: parseText,
    parseLine: parseLine,
    parseCSVLine: parseCSVLine,
    mergeIntoStore: mergeIntoStore,
    fileToText: fileToText,
    exportCSV: exportCSV
  };
})();
