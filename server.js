/* 词趣本地服务器：电脑上运行后，同一 Wi-Fi 的手机浏览器访问即可使用
   用法：node server.js [端口]（默认 8000） */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = __dirname;
var PORT = Number(process.argv[2]) || 8000;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

http.createServer(function (req, res) {
  var urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  var file = path.normalize(path.join(ROOT, urlPath));
  // 只允许访问项目目录内的文件
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('词趣已启动！手机连同一个 Wi-Fi，用浏览器打开下面的地址：');
  var printed = false;
  Object.keys(os.networkInterfaces()).forEach(function (name) {
    os.networkInterfaces()[name].forEach(function (a) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log('    http://' + a.address + ':' + PORT + '/');
        printed = true;
      }
    });
  });
  if (!printed) console.log('    （未检测到局域网 IP，请检查网络连接）');
  console.log('电脑本机访问：http://localhost:' + PORT + '/');
  console.log('关闭本窗口即停止服务');
});
