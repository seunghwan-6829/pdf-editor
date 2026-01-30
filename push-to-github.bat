@echo off
chcp 65001 >nul
cd /d "C:\Users\user\pdf-editor"

echo [0] Git lock 파일 정리
if exist ".git\index.lock" del /f ".git\index.lock"

echo [1] git add
git add -A

echo [2] git commit
git commit -m "fix: 버그 수정 및 기능 개선"

echo [3] git pull
git pull --rebase origin main

echo [4] git push
git push origin main

echo.
echo 완료! 1-2분 후 Vercel 자동 배포됩니다.
pause
