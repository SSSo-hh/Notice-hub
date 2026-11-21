// popup.js
// 확장 아이콘을 누르면 열리는 작은 창(popup.html)의 동작입니다.
// ⑥단계: DB에서 마지막 수집 시각과 규칙 미설정 게시판을 읽어 보여 주고, 웹사이트 열기 버튼을 연결합니다.

// "2026-11-10T00:02:00+00:00" 같은 날짜 글자를 "11.10 09:02" 모양으로 바꿉니다.
function formatDate(text) {
  const d = new Date(text);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
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
    // ⑦단계: 누르면 그 게시판을 열고 제목 고르기를 시작하도록 연결합니다.
    list.appendChild(li);
  });
}

// 웹사이트 열기: 새 탭으로 공지 모음 웹사이트를 엽니다.
document.querySelector("#open-website").addEventListener("click", () => {
  chrome.tabs.create({ url: WEBSITE_URL });
});

showLastCollect();
showNoRuleSites();
