@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT="
where git >nul 2>&1 && set GIT=git
if not defined GIT if exist "C:\Program Files\Git\bin\git.exe" set "GIT=C:\Program Files\Git\bin\git.exe"
if not defined GIT if exist "C:\Program Files (x86)\Git\bin\git.exe" set "GIT=C:\Program Files (x86)\Git\bin\git.exe"

if not defined GIT (
    echo [오류] Git을 찾을 수 없습니다.
    pause
    exit /b 1
)

echo Git: %GIT%
echo.

echo [1] 파일 타임스탬프 업데이트
copy /b src\App.tsx +,, >nul 2>&1
copy /b src\App.css +,, >nul 2>&1
copy /b src\pdf\textGrouping.ts +,, >nul 2>&1

echo [2] git add .
"%GIT%" add -A

echo [3] Git 사용자 설정
"%GIT%" config user.email "seunghwan-6829@users.noreply.github.com"
"%GIT%" config user.name "seunghwan-6829"

echo [4] git commit
"%GIT%" commit -m "refactor: 인라인 편집 + 텍스트 이동 기능"
echo.

echo [5] git push
"%GIT%" push origin main

echo.
echo 완료! 1-2분 후 Vercel 자동 배포됩니다.
pause
