@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if not defined NODE_MAJOR goto no_node
if %NODE_MAJOR% LSS 24 goto old_node
if exist node_modules goto deps_ok
call npm ci
if errorlevel 1 goto failed
:deps_ok
if exist dist\index.html goto dist_ok
call npm run build
if errorlevel 1 goto failed
:dist_ok
echo Vellum 工作台：http://127.0.0.1:8780
echo 保留此窗口以运行软件；关闭窗口即可停止服务。
node server/launch.mjs
if errorlevel 1 goto failed
pause
exit /b 0

:no_node
echo 没有找到 Node.js。请先安装 24 或更新版本：https://nodejs.org/
pause
exit /b 1

:old_node
echo 当前 Node.js 版本过低，需要 24 或更新版本。当前版本：
node --version
pause
exit /b 1

:failed
echo.
echo 启动失败，请把上面的报错一起发我。
pause
exit /b 1
