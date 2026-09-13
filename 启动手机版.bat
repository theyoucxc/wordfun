@echo off
chcp 65001 >nul
title 词趣 - 手机版服务器
cd /d "%~dp0"
node server.js
echo.
pause
