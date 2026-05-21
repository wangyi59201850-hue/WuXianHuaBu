@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3220

if not exist "node_modules\next\package.json" (
  echo [启动画布] 首次运行，正在安装依赖…
  call npm install
  if errorlevel 1 (
    echo npm install 失败
    pause
    exit /b 1
  )
)

echo [启动画布] 正在启动开发服务并在就绪后打开浏览器…
node scripts\dev-open.cjs
if errorlevel 1 pause
