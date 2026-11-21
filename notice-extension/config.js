// config.js
// 확장 프로그램의 Supabase 접속 정보입니다. (웹사이트 supabase-config.js 와 같은 값)
// 공개 키(publishable)만 넣습니다. secret 키는 절대 넣지 않습니다.
const SUPABASE_URL = "https://cwzyqiscgmwdnaxqfoep.supabase.co";
const SUPABASE_KEY = "sb_publishable_ToWzYy3rT52MS3i-lf1klg_OMfaMUgp";

// 팝업의 "웹사이트 열기" 버튼이 여는 주소입니다. (GitHub Pages 배포 주소)
const WEBSITE_URL = "https://ssso-hh.github.io/Notice-hub/index.html";

// 로그인 정보를 chrome.storage.local 에 저장합니다. 팝업과 서비스 워커(background.js)가 같이 씁니다.
// (서비스 워커에는 웹페이지의 localStorage 가 없어서, Supabase 에 저장 방법을 알려 줍니다.)
const chromeStorage = {
  getItem: async (key) => (await chrome.storage.local.get(key))[key] ?? null,
  setItem: async (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: async (key) => chrome.storage.local.remove(key),
};

// supabase.js(라이브러리 파일)가 만든 supabase 로 DB 접속 도구를 만듭니다.
// persistSession: 로그인 유지, autoRefreshToken: 로그인 만료 전에 자동 연장
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: chromeStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// 로그인되어 있는지 확인 (세션이 있으면 그 정보를, 없으면 null)
async function currentSession() {
  const { data } = await db.auth.getSession();
  return data.session;
}
