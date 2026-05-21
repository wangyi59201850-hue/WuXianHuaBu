@echo off
setlocal
chcp 65001 >nul
title Wuxianhuabu1.1 Web Stopper

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [信息] 正在停止当前工程相关的 Node.js / Next.js 进程...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$projectDir = [System.IO.Path]::GetFullPath('%PROJECT_DIR%');" ^
  "$targets = Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.Name -in @('node.exe','cmd.exe') -and" ^
  "  $_.CommandLine -and" ^
  "  $_.CommandLine.IndexOf($projectDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0" ^
  "};" ^
  "if (-not $targets) {" ^
  "  Write-Output '[信息] 未发现当前工程的运行进程。';" ^
  "  exit 0" ^
  "}" ^
  "$targets | ForEach-Object {" ^
  "  try {" ^
  "    Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop;" ^
  "    Write-Output ('[已停止] PID=' + $_.ProcessId + ' ' + $_.Name)" ^
  "  } catch {" ^
  "    Write-Output ('[跳过] PID=' + $_.ProcessId + ' 停止失败: ' + $_.Exception.Message)" ^
  "  }" ^
  "}"

echo [完成] 已执行当前工程专用停止命令。
pause
endlocal
