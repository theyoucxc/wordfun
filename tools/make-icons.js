/* 生成应用图标：天蓝圆角方块 + 白色 W（纯 Node 无依赖，zlib 内置）
   用法：node tools/make-icons.js */
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

// ---- PNG 编码（手写最小实现） ----
var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var tb = Buffer.from(type, 'ascii');
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(size, rgba) {
  var sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 位深
  ihdr[9] = 6;  // RGBA
  var raw = Buffer.alloc((size * 4 + 1) * size);
  for (var y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 绘制：圆角方块（4× 超采样抗锯齿）+ 像素字 W ----
var BG = [0x0E, 0xA5, 0xE9]; // 天蓝
var FG = [255, 255, 255];
var W_BITS = [
  '10001',
  '10001',
  '10001',
  '10101',
  '10101',
  '01010'
];

function makeIcon(size, file) {
  var rgba = Buffer.alloc(size * size * 4);
  var m = size * 0.05;                       // 外边距（maskable 安全区）
  var r = size * 0.22;                       // 圆角半径
  var cell = Math.floor(size * 0.075);       // 字母单元
  var ww = W_BITS[0].length * cell;          // W 宽
  var wh = W_BITS.length * cell;             // W 高
  var wx = Math.round((size - ww) / 2);
  var wy = Math.round((size - wh) / 2);

  function inRound(x, y) { // 圆角矩形内测试（样本点坐标）
    if (x < m || x > size - m || y < m || y > size - m) return false;
    var cx = Math.max(m + r, Math.min(x, size - m - r));
    var cy = Math.max(m + r, Math.min(y, size - m - r));
    var dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  for (var py = 0; py < size; py++) {
    for (var px = 0; px < size; px++) {
      var hits = 0;
      for (var sy = 0; sy < 2; sy++) {
        for (var sx = 0; sx < 2; sx++) {
          if (inRound(px + 0.25 + sx * 0.5, py + 0.25 + sy * 0.5)) hits++;
        }
      }
      var a = Math.round(hits / 4 * 255);
      var col = BG;
      var bx = Math.floor((px - wx) / cell), by = Math.floor((py - wy) / cell);
      if (bx >= 0 && bx < W_BITS[0].length && by >= 0 && by < W_BITS.length && W_BITS[by][bx] === '1') col = FG;
      var o = (py * size + px) * 4;
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = a;
    }
  }
  fs.writeFileSync(file, encodePNG(size, rgba));
  console.log('生成 ' + path.relative(process.cwd(), file) + ' (' + size + 'x' + size + ')');
}

var outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
makeIcon(180, path.join(outDir, 'icon-180.png'));
makeIcon(512, path.join(outDir, 'icon-512.png'));
