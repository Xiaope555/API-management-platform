@echo off
chcp 65001 >nul
title AI API Hub

cd /d "%~dp0"

echo.
echo   AI API Hub 正在启动...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   没有找到 Node.js。
  echo.
  echo   电脑端需要 Node 18 或更高版本才能运行，装完再双击本文件：
  echo     https://nodejs.org
  echo.
  echo   不想装 Node？手机可以直接下载 APK 版本，不需要电脑。
  echo.
  pause
  exit /b 1
)

rem  纯 Node 内置模块实现，不需要 npm install。
rem  服务起来后会自己打开浏览器，浏览器里就是完整的电脑端界面。
rem  端口默认 8787，被占用会自动往后找；想固定就用  node server.js --port=9000
node server.js --open

echo.
echo   服务已停止。
pause
