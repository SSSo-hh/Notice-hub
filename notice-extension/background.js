// background.js
// 확장 프로그램의 본체(서비스 워커)입니다. 화면 없이 뒤에서 돌며, 필요할 때만 깨어납니다.
// 제목 고르기(⑦), 수집(⑧~⑩, collect.js), 12시간 자동 수집(⑪)을 맡습니다.

// importScripts: 다른 js 파일을 불러와 이 파일 안에서 쓸 수 있게 합니다. (서비스 워커 전용 문법)
importScripts("supabase.js", "config.js", "linkfinder.js", "collect.js");

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
  ensureAlarm();
});

// ---------- ⑦-3 제목 고르기 ----------
// 탭마다 고르기 정보를 chrome.storage.session 에 둡니다. (서비스 워커가 잠들었다 깨어나도 유지)
//   ctx_탭번호: { folderId, name, siteId }  (어떤 폴더에, 어떤 이름으로, 기존 게시판이면 그 id)
//   pick_탭번호: { areas, sampleTitle, frameUrl, count }  (마지막으로 고른 결과)
async function getSession(key) {
  const data = await chrome.storage.session.get(key);
  return data[key];
}

// 탭에 고르기 화면을 넣습니다. allFrames: iframe 안 게시판도 고를 수 있게 모든 프레임에 넣음
async function startPicker({ tabId, folderId, name, siteId }) {
  await chrome.storage.session.set({ ["ctx_" + tabId]: { folderId, name, siteId: siteId || null } });
  await chrome.storage.session.remove("pick_" + tabId);
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["rules.js", "picker.js"] });
}

// 규칙 미설정 게시판: 게시판 주소를 열고 고르기 시작
async function openAndPick(siteId) {
  const { data: site, error } = await db.from("sites").select("id, name, board_url, folder_id").eq("id", siteId).single();
  if (error) throw error;
  if (!site.board_url) throw new Error("게시판 주소가 비어 있습니다. 웹사이트 설정 화면에서 주소를 먼저 입력하세요.");
  const tab = await chrome.tabs.create({ url: site.board_url, active: true });
  await waitTabComplete(tab.id);
  await startPicker({ tabId: tab.id, folderId: site.folder_id, name: site.name, siteId: site.id });
}

// 저장: 글 주소 방법을 찾고(linkfinder.js) 규칙을 DB sites 에 저장합니다.
async function savePick(tabId) {
  const ctx = await getSession("ctx_" + tabId);
  const pick = await getSession("pick_" + tabId);
  if (!ctx || !pick) throw new Error("고른 제목이 없습니다. 제목을 먼저 클릭하세요.");

  const found = await findLinkRule(pick.frameUrl, pick.areas, pick.sampleTitle);
  const rule = { areas: pick.areas, link: found.link, sampleTitle: pick.sampleTitle };
  const row = {
    board_url: pick.frameUrl,
    rule,
    list_area: pick.areas.map((a) => a.container).join(" | "), // 사람이 읽기 위한 참고용
    link_patterns: found.link.patterns || [],
    last_status: "ok",
    last_error: null,
  };

  let siteName = ctx.name;
  let savedId = ctx.siteId;
  if (ctx.siteId) {
    const { error } = await db.from("sites").update(row).eq("id", ctx.siteId);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("sites").insert({ ...row, folder_id: ctx.folderId, name: ctx.name, keywords: [] }).select("id").single();
    if (error) throw error;
    savedId = data.id;
  }
  await chrome.storage.session.remove(["ctx_" + tabId, "pick_" + tabId]);
  // 새로 규칙을 저장한 게시판은 바로 수집합니다 (첫 페이지 + 팝업에서 고른 페이지 수만큼 옛 공지)
  if (savedId) runTracked("new", () => collectSites([savedId], "new"));
  return {
    ok: true,
    siteName,
    count: found.count || pick.count,
    mode: found.link.mode,
    observed: found.observed,
    verified: found.verified,
    note: found.note || "",
  };
}

// 팝업과 고르기 화면에서 오는 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return false; // offscreen.js 가 받는 메시지
  const tabId = msg.tabId || (sender.tab && sender.tab.id);
  const reply = (promise) => {
    promise.then((r) => sendResponse(r || { ok: true })).catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true; // 응답을 나중에(비동기로) 보낸다는 표시
  };

  if (msg.type === "startPicker") return reply(startPicker(msg));
  if (msg.type === "openAndPick") return reply(openAndPick(msg.siteId));
  if (msg.type === "pickerSave") return reply(savePick(tabId));
  if (msg.type === "previewCollect") return reply(previewCollect().then((results) => ({ ok: true, results })));
  if (msg.type === "openCheck") return reply(openCheckSite(msg.siteId));
  if (msg.type === "collectNow") return reply(runTracked("now", () => collectAndSave()));
  if (msg.type === "collectOld") return reply(runTracked("old", () => collectSites([msg.siteId], "old", msg.pages)));

  if (msg.type === "pickerResult") {
    // 어느 프레임에서 골랐든 결과를 기억하고, 맨 위 프레임의 안내 막대로 전달합니다.
    if (msg.ok) {
      chrome.storage.session.set({ ["pick_" + tabId]: { areas: msg.areas, sampleTitle: msg.sampleTitle, frameUrl: msg.frameUrl, count: msg.count } });
    }
    chrome.tabs.sendMessage(tabId, { ...msg, type: "pickerUpdate" }, { frameId: 0 }).catch(() => {});
    return false;
  }
  if (msg.type === "pickerBroadcast") {
    chrome.tabs.sendMessage(tabId, msg.payload).catch(() => {}); // 같은 탭의 모든 프레임으로
    return false;
  }
  return false;
});

// ---------- 수집 진행 상태 기억 ----------
// 팝업은 다른 곳을 누르면 닫히므로, 진행 상태와 결과를 chrome.storage.local 의 runState 에 남겨
// 팝업을 다시 열었을 때 이어서 보여 줍니다. 끝나면 아이콘에 새로 저장한 건수를 표시하고 팝업을 다시 띄워 봅니다.
async function runTracked(kind, job) {
  if (collecting) return { ok: false, error: "이미 수집 중입니다." }; // 진행 중인 기록을 덮어쓰지 않음
  if (!(await currentSession())) {
    // 확장에 로그인이 안 되어 있으면 DB를 읽고 쓸 수 없습니다. 아이콘에 "!" 로 알림
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    return { ok: false, error: "확장 프로그램에 로그인해 주십시오." };
  }
  await chrome.storage.local.set({ runState: { running: true, kind, startedAt: Date.now() } });
  chrome.action.setBadgeText({ text: "…" });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
  let res;
  try {
    res = await job();
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }
  // 저장 공간을 아끼려고 게시판마다 공지는 3개만 남깁니다.
  const results = (res.results || []).map((r) => ({ ...r, items: (r.items || []).slice(0, 3) }));
  const saved = results.reduce((a, r) => a + (r.saved || 0), 0);
  await chrome.storage.local.set({
    runState: { running: false, kind, finishedAt: Date.now(), ok: res.ok !== false, error: res.error || null, results, seen: false },
  });
  chrome.action.setBadgeText({ text: res.ok === false ? "!" : String(saved) });
  chrome.action.setBadgeBackgroundColor({ color: res.ok === false ? "#dc2626" : "#16a34a" });
  // 팝업 다시 띄우기(사용자가 누른 수집만): 크롬 창이 앞에 있을 때만 됩니다. 안 되면 아이콘 숫자로 알 수 있습니다.
  if (kind === "now" || kind === "old") chrome.action.openPopup().catch(() => {});
  return res;
}

// ---------- ⑪ 12시간마다 자동 수집 ----------
// chrome.alarms: 정해진 시간마다 서비스 워커를 깨워 주는 알람입니다. (크롬이 켜져 있어야 울림)
const COLLECT_EVERY_MIN = 12 * 60;

// 알람이 없으면 만듭니다. (설치, 새로고침, 크롬 시작 때 확인)
async function ensureAlarm() {
  const a = await chrome.alarms.get("collect");
  if (!a) chrome.alarms.create("collect", { periodInMinutes: COLLECT_EVERY_MIN, delayInMinutes: COLLECT_EVERY_MIN });
}

// 마지막 수집에서 12시간이 지났으면 수집합니다.
async function collectIfDue() {
  if (!(await currentSession())) { console.log("[자동 수집] 로그인 안 됨, 건너뜀"); return; }
  const { data } = await db.from("collector").select("last_collect").limit(1);
  const last = data && data[0] && data[0].last_collect ? new Date(data[0].last_collect).getTime() : 0;
  if (Date.now() - last < COLLECT_EVERY_MIN * 60000) {
    console.log("[자동 수집] 마지막 수집 후 12시간이 지나지 않아 건너뜀");
    return;
  }
  console.log("[자동 수집] 시작");
  await runTracked("auto", () => collectAndSave());
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // collect: 12시간 알람 / startup: 크롬을 켠 뒤 1분 (인터넷 연결이 잡힐 시간)
  if (alarm.name === "collect" || alarm.name === "startup") collectIfDue();
});

// 크롬을 켤 때: 1분 뒤에 12시간이 지났는지 확인
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  chrome.alarms.create("startup", { delayInMinutes: 1 });
});

// ---------- 로그인 도우미 (확인 필요 게시판) ----------
// 수집이 안 된 게시판(로그인 풀림, 사이트 변경 등)을 사용자가 보는 탭으로 엽니다.
// 그 탭을 지켜보다가 목록이 보이면 바로 그 게시판을 수집해 저장합니다.
//  - 로그인 화면이 보이면: 사용자가 로그인(크롬 자동완성)할 때까지 기다림
//  - 로그인 뒤 다른 화면(메인 등)으로 가면: 게시판 주소로 한 번 다시 이동
//  - 10분 안에 목록이 안 보이면 지켜보기를 그만둠
// 지켜보는 정보는 chrome.storage.session 의 watch_탭번호 에 둡니다. (서비스 워커가 잠들어도 유지)
async function openCheckSite(siteId) {
  const { data: site, error } = await db.from("sites").select("id, name, board_url").eq("id", siteId).single();
  if (error) throw error;
  const tab = await chrome.tabs.create({ url: site.board_url, active: true });
  await chrome.storage.session.set({ ["watch_" + tab.id]: { siteId, name: site.name, sawLogin: false, revisited: false, until: Date.now() + 10 * 60000 } });
  return { ok: true };
}

async function checkWatchedTab(tabId) {
  const key = "watch_" + tabId;
  const w = await getSession(key);
  if (!w) return;
  if (Date.now() > w.until) { await chrome.storage.session.remove(key); return; }

  const { data: site, error } = await db.from("sites")
    .select("id, name, board_url, rule, keywords, seen_links, last_collected_at, folder_id").eq("id", w.siteId).single();
  if (error || !site || !site.rule) return;

  // 목록이 늦게 그려지는 사이트를 위해 최대 6초 동안 확인
  let state = null;
  for (let i = 0; i < 8; i++) {
    state = await runInTab(tabId, (rule) => ({
      items: self.NoticeRules.applyRule(document, rule, location.href),
      hasPassword: !!document.querySelector('input[type="password"]'),
    }), [site.rule]).catch(() => null);
    if (!state || state.items.length || state.hasPassword) break;
    await sleep(750);
  }
  if (!state) return;

  if (state.items.length) {
    // 목록이 보임: 수집해서 저장하고 지켜보기 끝
    await chrome.storage.session.remove(key);
    const r = { id: site.id, name: site.name, ok: true, count: state.items.length, items: state.items, stage: "login" };
    try {
      r.saved = await saveResult(site, r);
    } catch (e) {
      r.saved = 0;
      r.saveError = String(e.message || e);
    }
    chrome.action.setBadgeText({ text: String(r.saved) });
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    const results = [{ ...r, items: r.items.slice(0, 3) }];
    await chrome.storage.local.set({ runState: { running: false, kind: "login", finishedAt: Date.now(), ok: true, results, seen: false } });
    console.log(`[로그인 도우미] ${site.name}: ${r.count}건 중 ${r.saved}건 저장`);
    return;
  }
  if (state.hasPassword) {
    if (!w.sawLogin) await chrome.storage.session.set({ [key]: { ...w, sawLogin: true } });
    return;
  }
  // 로그인 화면을 지나 다른 화면으로 왔으면 게시판 주소로 한 번 다시 이동
  if (w.sawLogin && !w.revisited) {
    await chrome.storage.session.set({ [key]: { ...w, revisited: true } });
    chrome.tabs.update(tabId, { url: site.board_url }).catch(() => {});
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete") checkWatchedTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove("watch_" + tabId));
