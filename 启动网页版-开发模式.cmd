@echo off

setlocal

chcp 65001 >nul

title JiMengPro Web Launcher (Dev)



cd /d "%~dp0"



set PORT=3220



where node >nul 2>nul

if errorlevel 1 (

  echo [错误] 未检测到 Node.js，请先安装 Node.js 18+ 后重试。

  pause

  exit /b 1

)



where npm >nul 2>nul

if errorlevel 1 (

  echo [错误] 未检测到 npm，请检查 Node.js 安装是否完整。

  pause

  exit /b 1

)



if not exist "node_modules" (

  echo [信息] 首次运行，正在安装依赖...

  call npm install

  if errorlevel 1 (

    echo [错误] 依赖安装失败，请检查网络后重试。

    pause

    exit /b 1

  )

)



echo [信息] 端口 %PORT% — 服务就绪后将自动打开浏览器: http://localhost:%PORT%

echo [提示] 关闭本窗口即停止服务。

call node scripts\dev-open.cjs



endlocal


