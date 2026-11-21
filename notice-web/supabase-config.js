// supabase-config.js
// Supabase 접속 정보와, 여러 화면에서 같이 쓰는 DB 읽기 도구를 모아 둔 파일입니다.

// 공개 키(publishable)는 웹사이트에 넣어도 되는 키입니다.
// secret 키나 service_role 키는 절대 여기에 넣지 않습니다.
const SUPABASE_URL = "https://cwzyqiscgmwdnaxqfoep.supabase.co";
const SUPABASE_KEY = "sb_publishable_ToWzYy3rT52MS3i-lf1klg_OMfaMUgp";

// HTML에서 먼저 불러온 Supabase 라이브러리(이름: supabase)로 접속 도구를 만듭니다.
// 앞으로 DB를 읽고 쓸 때는 이 db 를 씁니다.
// let: 로그인하지 않은 체험 화면에서는 아래에서 가짜 db(demo.js)로 바꿔 끼웁니다.
let db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let IS_DEMO = false; // 체험 화면이면 true

// ---------- 로그인 확인 ----------
// 로그인 정보(세션)는 브라우저에 저장되어, 한 번 로그인하면 다음에도 유지됩니다.
// 로그인 화면이 아닌데 로그인이 안 되어 있으면 체험 화면(예시 데이터)으로 보여 줍니다.
// 로그인 화면, 새 비밀번호 화면(reset.html), 설치 안내(install.html)는 로그인 없이 열 수 있어야 합니다.
const IS_LOGIN_PAGE = /(login|reset|install)\.html$/.test(location.pathname);
const authReady = (async () => {
  const { data } = await db.auth.getSession();
  if (!data.session && !IS_LOGIN_PAGE) {
    // 체험 화면: 진짜 DB 대신 예시 데이터로 동작 (demo.js). 바꾼 내용은 새로고침하면 처음으로 돌아감
    db = createDemoDb();
    IS_DEMO = true;
    showDemoBanner();
    return { demo: true };
  }
  return data.session;
})();

// 체험 화면 안내 막대: 상단 바 바로 아래에 표시, "로그아웃" 글자는 "로그인"으로
function showDemoBanner() {
  document.body.classList.add("demo");
  const bar = document.createElement("div");
  bar.className = "demo-banner";
  bar.innerHTML = `
    <span><b>체험 화면</b>예시 공지로 기능을 써 볼 수 있고, 새로고침하면 처음으로 돌아갑니다.</span>
    <a href="login.html" class="btn btn-primary">로그인 / 회원가입</a>`;
  const topbar = document.querySelector(".topbar");
  if (topbar) topbar.after(bar); // after: 상단 바 바로 뒤에 넣기
  else document.body.prepend(bar);
  document.querySelectorAll('a[onclick*="logout"]').forEach((link) => (link.textContent = "로그인"));
}

// 로그아웃: 저장된 로그인 정보를 지우고 로그인 화면으로 (체험 화면에서는 로그인 화면으로 이동만)
async function logout() {
  if (IS_DEMO) return location.assign("login.html");
  await db.auth.signOut();
  location.replace("login.html");
}

// 테이블 하나를 통째로 읽어 옵니다.
// async 함수: 안에서 await(기다리기)를 쓸 수 있는 함수입니다. 결과를 바로 주지 못하고 나중에 줍니다.
// 예: const list = await loadTable("folders", "sort_order");
async function loadTable(table, orderColumn, ascending = true) {
  await authReady; // 로그인 확인이 끝난 뒤에 읽습니다.
  // await: DB의 대답이 올 때까지 기다렸다가 다음 줄로 넘어갑니다.
  // 대답은 { data: 읽어 온 줄 목록, error: 오류 내용 } 모양으로 옵니다.
  const { data, error } = await db
    .from(table)                                // 어느 테이블에서
    .select("*")                                // 모든 칸을
    .order(orderColumn, { ascending: ascending }); // 이 칸 순서로 정렬해서

  if (error) throw error; // 오류가 있으면 던져서, 부른 쪽의 catch 가 받게 합니다.
  return data;
}

// DB 저장에 실패했을 때 알립니다. 자세한 내용은 F12 Console에 남깁니다. (세 화면이 같이 사용)
function showSaveError(error) {
  console.error("DB 저장 실패:", error);
  alert("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.\n(" + error.message + ")");
}
