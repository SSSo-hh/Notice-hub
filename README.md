# 공지 모음 (Notice-hub)

여러 사이트 게시판의 새 공지 제목을 폴더별로 모아 한 화면에서 보는 개인 공지 모음 서비스입니다.
PC 크롬 확장 프로그램이 게시판을 수집해 클라우드 DB(Supabase)에 저장하고, 웹사이트에서 휴대폰과 PC 어디서든 확인합니다.

- 웹사이트: https://ssso-hh.github.io/Notice-hub/
- 확장 프로그램 설치 안내: https://ssso-hh.github.io/Notice-hub/install.html

## 주요 기능

- 폴더별 게시판 등록, 게시판마다 키워드 설정 (키워드가 들어간 제목만 저장)
- 12시간마다 자동 수집, 크롬을 켰을 때 12시간이 지났으면 바로 수집, 팝업의 "지금 수집"으로 수동 수집
- 새로운 공지와 확인한 공지를 나눠 표시, 읽음 상태는 휴대폰과 PC가 공유
- 제목 검색, 스크랩, 중복 공지 정리, 체크박스 선택 삭제
- 저장 공간 사용량 막대와 80% 초과 알림
- 이메일 회원가입과 로그인, 비밀번호 재설정 메일, 로그인 없이 둘러보는 체험 화면
- 휴대폰 반응형 화면

## 제목 고르기

게시판 페이지에서 공지 제목 하나만 클릭하면 확장 프로그램이 공지를 찾는 규칙을 자동으로 만듭니다. 사용자는 선택자나 HTML을 볼 필요가 없습니다.

1. 클릭한 제목에서 목록 영역(같은 모양의 줄)과 제목 위치를 찾습니다.
2. 글 주소를 만드는 방법을 차례로 시도합니다.
   - 제목 링크의 실제 주소(href)에서 바뀌는 부분만 골라 주소 모양을 만듭니다.
   - 줄 안의 다른 속성에 글 주소가 있으면 그 주소를 씁니다.
   - 링크가 `#`이나 `javascript:`이면 뒤에서 연 탭에서 제목을 대신 눌러 보고 이동 주소, POST 폼, 새 창, 주소 변경을 관찰해 글 번호 주소 틀을 만듭니다.
   - React 화면처럼 번호가 화면 속성에 없으면 React 데이터에서 번호를 찾습니다.
3. 만든 주소로 글이 실제로 열리는지 확인한 뒤 저장합니다. 모두 실패하면 원문 링크를 게시판 목록 주소로 연결합니다.

특정 사이트용 코드(사이트 주소, 함수 이름)는 넣지 않고 같은 코드 하나로 여러 형태의 게시판을 처리하는 것을 원칙으로 합니다.

## 수집 방식

- 1차 빠른 수집: 게시판 HTML을 fetch로 받아 오프스크린 문서에서 DOMParser로 읽습니다. EUC-KR 사이트도 문자셋을 읽어 변환합니다.
- 2차 탭 수집: 1차에서 0건이면 최소화한 창에 탭으로 열어, 자바스크립트로 늦게 그려지는 목록까지 기다렸다가 읽습니다.
- 새 공지 판단: 게시판마다 최근 본 링크 300개를 기억하고 처음 보는 링크만 저장합니다. 사용자가 지운 공지는 다시 들어오지 않습니다.
- 처음 등록한 게시판은 여러 페이지(기본 3페이지)를 읽고, 팝업의 "옛 공지 가져오기"로 게시판별 이전 페이지를 추가로 가져올 수 있습니다.
- 로그인이 필요한 게시판은 내 크롬의 로그인 상태를 그대로 씁니다. 로그인이 풀려 수집되지 않은 게시판은 팝업의 "확인 필요 게시판"에서 열어 로그인하면 바로 수집합니다.

## 구성

```
Notice-hub/
├─ notice-web/            웹사이트 (GitHub Pages로 배포)
│  ├─ index.html          공지 화면
│  ├─ login.html          로그인, 회원가입
│  ├─ reset.html          비밀번호 재설정
│  ├─ settings.html       게시판 설정
│  ├─ folder-settings.html 폴더 설정 (순서 끌어 바꾸기, 이름 변경, 추가, 삭제)
│  ├─ install.html        확장 프로그램 설치 안내
│  ├─ app.js, settings.js, folder-settings.js
│  ├─ supabase-config.js  DB 접속 정보, 로그인 확인, 공용 함수
│  ├─ demo.js             비로그인 체험 화면용 예시 데이터
│  └─ style.css
├─ notice-extension/      크롬 확장 프로그램 (Manifest V3)
│  ├─ manifest.json
│  ├─ background.js       서비스 워커, 12시간 알람, 제목 고르기 저장, 로그인 도우미
│  ├─ collect.js          1차, 2차 수집과 새 공지 저장
│  ├─ rules.js            규칙 엔진 (목록 영역, 제목, 주소 모양)
│  ├─ linkfinder.js       글 주소 찾기와 검증
│  ├─ picker.js           제목 고르기 화면
│  ├─ offscreen.html, offscreen.js  1차 수집용 HTML 읽기
│  ├─ popup.html, popup.css, popup.js
│  ├─ config.js           DB 접속 정보, 웹사이트 주소
│  ├─ supabase.js         supabase-js 라이브러리 파일
│  └─ icons/
└─ .github/workflows/pages.yml  자동 배포
```

## 사용 기술

- HTML, CSS, JavaScript (프레임워크 없이)
- Supabase: PostgreSQL DB, 이메일 로그인(Auth), 행 단위 보안(RLS)
- Chrome Extension Manifest V3: service worker, alarms, tabs, scripting, offscreen, webRequest, webNavigation
- GitHub Pages, GitHub Actions

## 데이터

| 표 | 내용 |
| --- | --- |
| folders | 폴더 이름과 순서 |
| sites | 게시판 주소, 키워드, 찾기 규칙, 최근 본 링크, 수집 상태 |
| notices | 공지 제목, 원문 링크, 수집일, 읽음 여부와 읽은 시각 |
| scraps | 스크랩한 공지 |
| collector | 마지막 수집 시각 |

모든 표에 RLS를 적용해 로그인한 본인 데이터만 읽고 쓸 수 있습니다. 웹사이트와 확장에는 공개 키(publishable key)만 들어 있고 관리자 키는 사용하지 않습니다.

## 배포

`main`에 올리면 GitHub Actions가 자동으로 배포합니다.

1. `notice-web` 폴더의 파일을 사이트 맨 위로 복사합니다.
2. `notice-extension` 폴더를 `notice-extension.zip`으로 압축해 함께 올립니다. (설치 안내 화면의 받기 버튼에서 사용)

저장소 설정은 Settings > Pages > Source를 "GitHub Actions"로 둡니다. GitHub Pages는 캐시 때문에 올린 직후 최대 10분 정도 예전 파일이 보일 수 있습니다.

## 확장 프로그램 설치

1. 설치 안내 화면에서 `notice-extension.zip`을 받아 압축을 풉니다.
2. 크롬 주소창에 `chrome://extensions`를 열고 오른쪽 위 "개발자 모드"를 켭니다.
3. "압축해제된 확장 프로그램을 로드합니다"를 눌러 압축을 푼 폴더를 고릅니다.
4. 확장 아이콘을 눌러 웹사이트와 같은 계정으로 로그인합니다.

창을 모두 닫아도 수집하려면 크롬 설정의 "Google Chrome이 닫혀도 백그라운드 앱 계속 실행"을 켭니다.
코드를 고친 뒤에는 `chrome://extensions`에서 새로고침 버튼을 누르면 반영됩니다.

## 알려진 한계

- PC 크롬이 꺼져 있는 동안은 수집하지 않습니다. (켜면 밀린 수집 진행)
- CAPTCHA나 사람 확인을 요구하는 사이트는 자동 수집할 수 없습니다.
- 글이 POST로만 열리거나 같은 화면 안 레이어로만 열리고 줄 안에 따로 글 주소(공유 주소 등)도 없는 게시판은 원문 링크가 목록 페이지로 연결됩니다.
- 로그인이 풀린 게시판은 자동으로 다시 로그인하지 않습니다.
