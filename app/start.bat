@echo off
chcp 65001 >nul
title AI API Hub

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。请先装 Node 18 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   首次运行，正在准备依赖...
  call npm install --no-audit --no-fund
)

echo.
echo   正在启动 AI API Hub ...
echo.

start "" http://127.0.0.1:8787
node server.js

echo.
echo   服务已停止。
pause
