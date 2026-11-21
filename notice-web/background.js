// background.js
// 확장 프로그램의 본체(서비스 워커)입니다. 화면 없이 뒤에서 돌며, 필요할 때만 깨어납니다.
// ⑥단계: 설치 확인과 DB 연결 확인만 합니다. 수집 기능은 ⑧~⑪단계에서 여기에 추가합니다.

// importScripts: 다른 js 파일을 불러와 이 파일 안에서 쓸 수 있게 합니다. (서비스 워커 전용 문법)
importScripts("supabase.js", "config.js");

// 확장을 처음 설치하거나 새로고침(업데이트)했을 때 한 번 실행됩니다.
chrome.runtime.onInstalled.addListener(async () => {
  console.log("공지 모음 수집기 설치됨");

  // DB 연결 확인: 게시판(sites) 개수를 세어 Console에 출력합니다.
  // head: true = 내용은 받지 않고 개수만 받기
  const { count, error } = await db.from("sites").select("*", { count: "exact", head: true });
  if (error) {
    console.error("DB 연결 실패:", error);
  } else {
    console.log(`DB 연결 성공: 등록된 게시판 ${count}곳`);
  }
});
