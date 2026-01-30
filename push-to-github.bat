@echo off
chcp 65001 >nul
echo ============================================
echo   Git 기록 초기화 후 GitHub 푸시
echo ============================================
echo.

set "GIT=C:\Program Files\Git\bin\git.exe"

if not exist "%GIT%" (
    set "GIT=git"
)

cd /d "C:\Users\user\pdf-editor"

echo [1] 기존 .git 폴더 삭제
rmdir /s /q .git 2>nul

echo [2] git init
"%GIT%" init

echo [3] git 설정
"%GIT%" config user.email "seunghwan-6829@users.noreply.github.com"
"%GIT%" config user.name "seunghwan-6829"

echo [4] git add
"%GIT%" add .

echo [5] git commit
"%GIT%" commit -m "feat: AI PDF 제작 도구"

echo [6] branch 이름 변경
"%GIT%" branch -M main

echo [7] remote 추가
"%GIT%" remote add origin https://github.com/seunghwan-6829/pdf-editor.git

echo [8] force push
"%GIT%" push -u origin main --force

echo.
echo ============================================
echo 완료! Vercel에서 자동 배포됩니다.
echo ============================================
pause
