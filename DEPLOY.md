# GitHub + Vercel 배포 가이드

## 1. 로컬에서 Git 저장소 준비

프로젝트 폴더에서 터미널을 열고:

```bash
cd C:\Users\user\pdf-editor

# Git 초기화 (이미 했다면 생략)
git init

# 모든 파일 추가
git add .

# 첫 커밋
git commit -m "Initial commit: PDF 편집기 (100MB, 단어 단위 수정)"
```

---

## 2. GitHub에 저장소 만들고 푸시

### 방법 A: GitHub 웹에서 저장소 생성 후 푸시

1. [GitHub](https://github.com/new) 접속 → **New repository**
2. Repository name: `pdf-editor` (원하는 이름으로)
3. **Public** 선택, **Create repository** (README 추가 안 해도 됨)
4. 생성된 페이지에 나오는 주소 복사 (예: `https://github.com/내아이디/pdf-editor.git`)

5. 로컬에서 실행 (아래는 이 프로젝트용 주소):

```bash
git remote add origin https://github.com/seunghwan-6829/pdf-editor.git
git branch -M main
git push -u origin main
```

(GitHub 로그인/토큰 요청 시 입력)

### 방법 B: GitHub CLI 사용

```bash
gh auth login
gh repo create pdf-editor --public --source=. --push
```

---

## 3. Vercel로 웹 배포

### 방법 A: Vercel 웹에서 GitHub 연결 (권장)

1. [Vercel](https://vercel.com) 접속 → **Sign Up** / **Log In** (GitHub 계정으로 로그인)
2. **Add New…** → **Project**
3. **Import Git Repository**에서 방금 푸시한 `pdf-editor` 저장소 선택
4. **Import** 클릭
5. 설정 확인:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
6. **Deploy** 클릭

배포가 끝나면 `https://pdf-editor-xxx.vercel.app` 형태의 URL이 생성됩니다.

### 방법 B: Vercel CLI

```bash
npm i -g vercel
cd C:\Users\user\pdf-editor
vercel
```

로그인 후 프로젝트 연결, 배포 완료 후 URL 확인.

---

## 요약

| 단계 | 작업 |
|------|------|
| 1 | `git init` → `git add .` → `git commit -m "..."` |
| 2 | GitHub에서 새 저장소 생성 → `git remote add origin ...` → `git push -u origin main` |
| 3 | Vercel 로그인 → Import Git Repository → `pdf-editor` 선택 → Deploy |

이후 코드 수정 후 `git add .` → `git commit -m "메시지"` → `git push` 하면 Vercel이 자동으로 다시 배포합니다.
