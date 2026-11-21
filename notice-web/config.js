// config.js
// 확장 프로그램의 Supabase 접속 정보입니다. (웹사이트 supabase-config.js 와 같은 값)
// 공개 키(publishable)만 넣습니다. secret 키는 절대 넣지 않습니다.
const SUPABASE_URL = "https://cwzyqiscgmwdnaxqfoep.supabase.co";
const SUPABASE_KEY = "sb_publishable_ToWzYy3rT52MS3i-lf1klg_OMfaMUgp";

// 팝업의 "웹사이트 열기" 버튼이 여는 주소입니다.
// 지금은 VS Code Live Server 주소이고, 나중에 GitHub Pages로 배포하면 그 주소로 바꿉니다.
const WEBSITE_URL = "http://127.0.0.1:5500/index.html";

// supabase.js(라이브러리 파일)가 만든 supabase 로 DB 접속 도구를 만듭니다.
// persistSession: false = 로그인 정보를 저장하지 않음 (로그인은 3단계에서 붙임)
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});
