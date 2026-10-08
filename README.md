# 2024 · 민정 — Interaction Pages

클라이언트 작업 (2024). turn.js 기반 플립북 인터랙션 페이지.

**라이브 페이지:** https://yirangok.github.io/2024-client-minjeong-interaction-pages/

## 구조

- `index.html` — 플립북 본체 (페이지 이미지 91장 참조)
- `pages/` — 페이지 이미지 (`page-001.jpg` ~ `page-091.jpg`)
- `lib/`, `extras/` — turn.js 라이브러리와 의존 스크립트
- `_tests/smoke.js` — 스모크 검사 (밑줄 폴더라 Pages에는 배포되지 않는다)

## 검증

빌드·패키지 설정은 없다. 고친 뒤에는 스모크 검사를 돌린다: 참조 무결성 + Chromium으로 3개 화면 폭에서 넘김·마지막 쪽·404 확인.

```sh
npm i --no-save playwright-core@1.63.0   # 처음 한 번. node_modules는 커밋하지 않는다
npx playwright-core install chromium     # 번들 Chromium이 없을 때만
node _tests/smoke.js                     # 모두 통과면 종료 코드 0
```

## 404·리다이렉트

- GitHub Pages(`main` 루트)가 없는 URL에 루트의 `404.html`을 HTTP 404로 돌려준다. 자산 경로는 `/2024_client_MinJeong_Interaction-pages/` 기준 절대경로.
- GitHub Pages는 서버 리다이렉트가 불가하다. 옛 공개 페이지가 있을 때만 meta refresh 스텁을 둔다.
- 현재 리다이렉트 0개: git 이력의 유일한 HTML 이동(`samples/basic/index.html` → `index.html`, 2025-01-26)은 첫 배포 후 약 3분만 존재했고 외부 링크 근거가 없다.
