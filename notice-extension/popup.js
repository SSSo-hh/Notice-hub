// popup.js
// 확장 아이콘을 누르면 열리는 작은 창(popup.html)의 동작입니다.
// DB에서 마지막 수집 시각과 규칙 미설정 게시판을 읽어 보여 주고, 게시판 추가(제목 고르기)와 웹사이트 열기를 연결합니다.

// "2026-11-10T00:02:00+00:00" 같은 날짜 글자를 "11.10 09:02" 모양으로 바꿉니다.
function formatDate(text) {
  const d = new Date(text);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

// 다음 자동 수집 시각 (12시간 알람)
async function showNextCollect() {
  const box = document.querySelector("#next-collect");
  const a = await chrome.alarms.get("collect");
  box.textContent = a ? "다음 자동 수집 " + formatDate(new Date(a.scheduledTime).toISOString()) : "";
}

// 마지막 수집 시각 표시 (collector 테이블)
async function showLastCollect() {
  const box = document.querySelector("#last-collect");
  const { data, error } = await db.from("collector").select("last_collect").limit(1);
  if (error) {
    console.error(error);
    box.textContent = "불러오기 실패";
    return;
  }
  const last = data[0] && data[0].last_collect;
  box.textContent = last ? formatDate(last) : "기록 없음";
}

// 규칙 미설정 게시판 목록 (sites 중 last_status 가 norule 인 것)
async function showNoRuleSites() {
  const list = document.querySelector("#norule-list");
  // folders(name): sites 의 folder_id 로 연결된 폴더 이름도 함께 가져옵니다.
  const { data, error } = await db
    .from("sites")
    .select("id, name, board_url, folders(name)")
    .eq("last_status", "norule")
    .order("id");

  if (error) {
    console.error(error);
    list.innerHTML = `<li class="empty">불러오기 실패</li>`;
    return;
  }

  document.querySelector("#norule-count").textContent = data.length;
  list.innerHTML = "";
  if (data.length === 0) {
    list.innerHTML = `<li class="empty">모든 게시판에 규칙이 설정되어 있습니다.</li>`;
    return;
  }

  data.forEach((site) => {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `<div class="item-name"></div><div class="item-sub"></div>`;
    li.querySelector(".item-name").textContent = site.name || "(이름 없음)";
    li.querySelector(".item-sub").textContent =
      (site.folders ? site.folders.name + " | " : "") + (site.board_url || "주소 없음");
    // 누르면 그 게시판을 열고 제목 고르기를 시작합니다. (background.js 가 처리)
    li.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "openAndPick", siteId: site.id });
      if (res && res.ok) window.close();
      else showError(res && res.error);
    });
    list.appendChild(li);
  });
}

// 확인 필요 게시판 목록 (sites 중 last_status 가 check 인 것)
async function showCheckSites() {
  const block = document.querySelector("#check-block");
  const list = document.querySelector("#check-list");
  const { data, error } = await db.from("sites").select("id, name, last_error").eq("last_status", "check").order("id");
  if (error || !data.length) { block.classList.add("hidden"); return; }
  block.classList.remove("hidden");
  document.querySelector("#check-count").textContent = data.length;
  list.innerHTML = "";
  data.forEach((site) => {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `<div class="item-name"></div><div class="item-sub"></div>`;
    li.querySelector(".item-name").textContent = site.name || "(이름 없음)";
    li.querySelector(".item-sub").textContent = site.last_error || "지난 수집에서 공지를 찾지 못함";
    li.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "openCheck", siteId: site.id });
      if (res && res.ok) window.close();
      else showError(res && res.error);
    });
    list.appendChild(li);
  });
}

// 오류 글자 표시
function showError(text) {
  const box = document.querySelector("#add-error");
  box.textContent = text || "알 수 없는 오류가 났습니다.";
  box.classList.remove("hidden");
}

// ---------- 이 페이지를 게시판으로 추가 ----------
let currentTab = null;

// 지금 보고 있는 탭이 일반 웹페이지(http, https)일 때만 추가 버튼을 켭니다.
async function setupAddBoard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab && /^https?:/.test(tab.url || "")) {
    document.querySelector("#add-board").disabled = false;
  }
}

// 추가 버튼: 폴더 목록을 DB에서 읽어 입력칸을 펼칩니다. 게시판 이름은 탭 제목으로 미리 채웁니다.
document.querySelector("#add-board").addEventListener("click", async () => {
  const { data, error } = await db.from("folders").select("id, name").order("sort_order");
  if (error) return showError("폴더를 불러오지 못했습니다.");
  if (data.length === 0) return showError("폴더가 없습니다. 웹사이트에서 폴더를 먼저 만드세요.");
  const select = document.querySelector("#add-folder");
  select.innerHTML = "";
  data.forEach((f) => {
    const option = document.createElement("option");
    option.value = f.id;
    option.textContent = f.name;
    select.appendChild(option);
  });
  document.querySelector("#add-name").value = (currentTab.title || "").slice(0, 30);
  document.querySelector("#add-form").classList.remove("hidden");
  document.querySelector("#add-board").classList.add("hidden");
});

// 제목 고르기 시작: background 에 알리고 팝업을 닫습니다. (페이지 위에 안내 막대가 뜸)
document.querySelector("#add-start").addEventListener("click", async () => {
  const name = document.querySelector("#add-name").value.trim();
  if (!name) return showError("게시판 이름을 입력하세요.");
  const res = await chrome.runtime.sendMessage({
    type: "startPicker",
    tabId: currentTab.id,
    folderId: Number(document.querySelector("#add-folder").value),
    name,
  });
  if (res && res.ok) window.close();
  else showError((res && res.error) || "이 페이지에서는 제목 고르기를 시작할 수 없습니다.");
});

// 웹사이트 열기: 새 탭으로 공지 모음 웹사이트를 엽니다.
document.querySelector("#open-website").addEventListener("click", () => {
  chrome.tabs.create({ url: WEBSITE_URL });
});

// 시작: 로그인되어 있으면 평소 화면, 아니면 로그인 칸만 보여 줍니다.
(async () => {
  if (!(await currentSession())) {
    document.querySelector("#login-block").classList.remove("hidden");
    document.querySelector("#main-blocks").classList.add("hidden");
    return;
  }
  showLastCollect();
  showNextCollect();
  showNoRuleSites();
  showCheckSites();
  fillOldSites();
  setupAddBoard();
})();

// 로그인: 성공하면 팝업을 다시 그립니다.
document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const box = document.querySelector("#login-error");
  box.classList.add("hidden");
  const { error } = await db.auth.signInWithPassword({
    email: document.querySelector("#login-email").value.trim(),
    password: document.querySelector("#login-password").value,
  });
  if (error) {
    box.textContent = "로그인하지 못했습니다. 이메일과 비밀번호를 확인하십시오.";
    box.classList.remove("hidden");
    return;
  }
  chrome.action.setBadgeText({ text: "" });
  location.reload();
});

// 로그아웃
document.querySelector("#logout").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

// 수집 결과 목록 그리기 (지금 수집, 옛 공지 가져오기 공용)
function renderResults(results, headline) {
  const state = document.querySelector("#collect-state");
  const list = document.querySelector("#collect-list");
  state.textContent = headline;
  showResultBlock();
  list.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    li.className = "item";
    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = r.name;
    const sub = document.createElement("div");
    sub.className = "item-sub" + (r.ok ? "" : " warn");
    const pagesText = r.pagesRead > 1 ? `, ${r.pagesRead}페이지까지` : "";
    sub.textContent = r.ok
      ? `${r.count}건 중 새로 ${r.saved || 0}건 저장${pagesText}${r.stage === "tab" ? " (2차 탭)" : ""}${r.saveError ? ", 저장 오류: " + r.saveError : ""}`
      : r.error;
    const detail = document.createElement("div");
    detail.className = "item-detail hidden";
    detail.textContent = (r.items || []).slice(0, 3).map((it) => "- " + it.title).join("\n") || "(없음)";
    li.append(name, sub, detail);
    li.addEventListener("click", () => detail.classList.toggle("hidden"));
    list.appendChild(li);
  });
  list.classList.remove("hidden");
}

// 버튼 잠그기와 안내 글자
function setBusy(busy, text) {
  document.querySelector("#collect-now").disabled = busy;
  document.querySelector("#collect-old").disabled = busy;
  const state = document.querySelector("#collect-state");
  if (text) { state.textContent = text; showResultBlock(); }
  if (busy) document.querySelector("#collect-list").classList.add("hidden");
}

// 지금 수집 / 옛 공지 가져오기: 시작만 알리고, 결과는 runState(확장 저장소)가 바뀌면 그립니다.
// (팝업이 닫혀도 수집은 서비스 워커에서 계속되고, 다시 열면 진행 중이거나 끝난 결과가 보입니다.)
document.querySelector("#collect-now").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "collectNow" }).catch(() => {});
});
document.querySelector("#collect-old").addEventListener("click", () => {
  const pages = Number(document.querySelector("#first-pages").value);
  const siteId = Number(document.querySelector("#old-site").value);
  if (!siteId) return setBusy(false, "옛 공지를 가져올 게시판을 고르십시오.");
  if (pages <= 1) return setBusy(false, "페이지 수를 2 이상으로 고르십시오.");
  chrome.runtime.sendMessage({ type: "collectOld", siteId, pages }).catch(() => {});
});

// 옛 공지 가져오기 게시판 목록 (규칙이 있고 정상인 게시판)
async function fillOldSites() {
  const sel = document.querySelector("#old-site");
  const { data, error } = await db.from("sites").select("id, name, folders(name)").eq("last_status", "ok").order("folder_id").order("id");
  sel.innerHTML = `<option value="">게시판 고르기</option>`;
  if (error) return;
  data.forEach((site) => {
    const op = document.createElement("option");
    op.value = site.id;
    op.textContent = (site.folders ? site.folders.name + " | " : "") + site.name;
    sel.appendChild(op);
  });
}

// 최근 결과 칸 보이기
function showResultBlock() {
  document.querySelector("#result-block").classList.remove("hidden");
}

// 접기: 제목 줄을 누르면 접고 펼치며, 상태를 기억합니다.
(async () => {
  const { folded = {} } = await chrome.storage.local.get("folded");
  document.querySelectorAll(".fold").forEach((sec) => {
    const key = sec.dataset.fold;
    if (folded[key]) sec.classList.add("folded");
    sec.querySelector(".fold-head").addEventListener("click", () => {
      sec.classList.toggle("folded");
      folded[key] = sec.classList.contains("folded");
      chrome.storage.local.set({ folded });
    });
  });
})();

function showRunState(st) {
  if (!st) return;
  const what = st.kind === "old" ? "옛 공지를 가져오는" : st.kind === "new" ? "새 게시판을 수집하는" : st.kind === "auto" ? "자동 수집으로 게시판을 읽는" : "게시판을 읽는";
  if (!st.running && st.kind === "login") {
    const r = st.results[0];
    renderResults(st.results, `${formatDate(new Date(st.finishedAt).toISOString())} 로그인 뒤 "${r.name}" 수집, 새 공지 ${r.saved || 0}건 저장.`);
    showCheckSites();
    return;
  }
  if (st.running && Date.now() - st.startedAt > 30 * 60000) {
    // 30분이 넘도록 끝나지 않은 기록: 크롬이 꺼지는 등으로 중간에 멈춘 것
    return setBusy(false, "이전 수집이 중간에 멈췄습니다. 다시 눌러 주십시오.");
  }
  if (st.running) {
    const min = Math.floor((Date.now() - st.startedAt) / 60000);
    setBusy(true, `${what} 중입니다${min ? " (" + min + "분째)" : ""}. 창을 닫아도 계속 진행되고, 끝나면 아이콘에 저장 건수가 표시됩니다.`);
    return;
  }
  setBusy(false);
  if (!st.ok) return setBusy(false, "실패: " + (st.error || "알 수 없는 오류"));
  const okCount = st.results.filter((r) => r.ok).length;
  const savedSum = st.results.reduce((a, r) => a + (r.saved || 0), 0);
  const when = formatDate(new Date(st.finishedAt).toISOString());
  const one = st.results[0];
  const headline = st.kind === "old"
    ? `${when} "${one ? one.name : ""}" 옛 공지 ${savedSum}건 저장.`
    : st.kind === "new"
    ? `${when} 새 게시판 "${one ? one.name : ""}" 수집, 공지 ${savedSum}건 저장.`
    : `${when}${st.kind === "auto" ? " 자동 수집" : ""} ${st.results.length}곳 중 ${okCount}곳 읽음, 새 공지 ${savedSum}건 저장. 이름을 누르면 첫 공지 3개가 보입니다.`;
  renderResults(st.results, headline);
  if (st.kind !== "old") showLastCollect();
  showCheckSites();
}

(async () => {
  const { runState } = await chrome.storage.local.get("runState");
  // 진행 중이면 진행 상태, 끝났으면 마지막 결과를 보여 줍니다. (seen: 아이콘 숫자를 지웠는지)
  if (runState) showRunState(runState);
  if (runState && !runState.running && !runState.seen) {
    chrome.storage.local.set({ runState: { ...runState, seen: true } });
    chrome.action.setBadgeText({ text: "" });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.runState) return;
    const st = changes.runState.newValue;
    showRunState(st);
    if (st && !st.running && !st.seen) {
      chrome.storage.local.set({ runState: { ...st, seen: true } });
      chrome.action.setBadgeText({ text: "" });
    }
  });
})();

// 페이지 수 설정: 확장 저장소에 기억 (기본 5)
(async () => {
  const sel = document.querySelector("#first-pages");
  const { firstPages } = await chrome.storage.local.get("firstPages");
  sel.value = String(firstPages || 5);
  sel.addEventListener("change", () => chrome.storage.local.set({ firstPages: Number(sel.value) }));
})();
