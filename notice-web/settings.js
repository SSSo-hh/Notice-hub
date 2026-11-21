// settings.js
// 설정 화면(settings.html): 폴더별 사이트 줄을 추가, 수정, 삭제합니다.
// 데이터는 Supabase DB에서 읽어 오고, 바꾼 내용은 바로 DB에 저장합니다.

// DB에서 읽어 온 데이터를 담아 둘 상자
let folders = [];
let sites = [];

// URLSearchParams: 주소 뒤에 붙은 ?folder=2 같은 값을 읽는 도구입니다.
const params = new URLSearchParams(location.search);
let currentFolderId = Number(params.get("folder"));

// 폴더 고르기 상자 채우기
function renderFolderSelect() {
  const select = document.querySelector("#folder-select");
  select.innerHTML = "";
  folders.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    if (folder.id === currentFolderId) option.selected = true;
    select.appendChild(option);
  });
}

// 사이트 한 줄의 바뀐 칸만 DB에 저장합니다. changes 예: { name: "학과 공지" }
async function saveSite(site, changes) {
  const { error } = await db.from("sites").update(changes).eq("id", site.id);
  if (error) {
    showSaveError(error);
    renderRows(); // 저장 실패 시 입력칸을 원래 값으로 되돌림
    return;
  }
  // Object.assign: changes 안의 값을 site 에 덮어씁니다 (화면 데이터도 맞춤).
  Object.assign(site, changes);
}

// 사이트 줄 목록 그리기
function renderRows() {
  const box = document.querySelector("#site-rows");
  box.innerHTML = "";
  const folderSites = sites.filter((site) => site.folder_id === currentFolderId);

  if (folderSites.length === 0) {
    box.innerHTML = `<p class="empty">이 폴더에 등록된 사이트가 없습니다. 아래 + 버튼으로 추가하세요.</p>`;
  }

  folderSites.forEach((site) => {
    const hasRule = site.last_status !== "norule";

    const row = document.createElement("div");
    row.className = "row";
    // 휴대폰 화면에서는 cell-label 글자가 보이고, PC에서는 숨겨집니다 (style.css)
    row.innerHTML = `
      <label class="cell"><span class="cell-label">사이트 이름</span>
        <input type="text" class="in-name" placeholder="예: 학과 공지"></label>
      <label class="cell"><span class="cell-label">게시판 주소</span>
        <input type="url" class="in-url" placeholder="https://"></label>
      <label class="cell"><span class="cell-label">키워드</span>
        <input type="text" class="in-keywords" placeholder="예: 장학금, 공모전"></label>
      <div class="cell"><span class="cell-label">찾기 규칙</span>
        <span class="status ${hasRule ? "status-ok" : "status-norule"}">${hasRule ? "설정됨" : "미설정"}</span></div>
      <div class="cell cell-del"><button class="del-btn" title="삭제">삭제</button></div>`;

    // 입력칸에 지금 값을 넣습니다.
    const nameInput = row.querySelector(".in-name");
    const urlInput = row.querySelector(".in-url");
    const keywordInput = row.querySelector(".in-keywords");
    nameInput.value = site.name;
    urlInput.value = site.board_url;
    keywordInput.value = site.keywords.join(", ");

    // 입력을 마치면(change: 칸을 벗어나거나 Enter) 그 칸 하나를 DB에 저장합니다.
    nameInput.addEventListener("change", () => {
      saveSite(site, { name: nameInput.value.trim() });
    });
    urlInput.addEventListener("change", () => {
      saveSite(site, { board_url: urlInput.value.trim() });
    });
    keywordInput.addEventListener("change", () => {
      // "장학금, 공모전" 글자를 ["장학금", "공모전"] 목록으로 나누고, 빈 칸은 뺍니다.
      const list = keywordInput.value.split(",").map((k) => k.trim()).filter((k) => k !== "");
      saveSite(site, { keywords: list });
    });

    // 삭제 버튼
    row.querySelector(".del-btn").addEventListener("click", async () => {
      const ok = confirm(`"${site.name || "이름 없음"}" 사이트를 삭제할까요? 이 사이트에서 모은 공지는 그대로 남습니다.`);
      if (!ok) return;

      // DB에서 사이트만 지웁니다. 모은 공지는 남고, 공지의 site_id 만 비워집니다. (supabase-notice-keep.sql)
      const { error } = await db.from("sites").delete().eq("id", site.id);
      if (error) return showSaveError(error);

      sites.splice(sites.indexOf(site), 1);
      renderRows();
    });

    box.appendChild(row);
  });

  // 공지 화면으로 돌아갈 때도 같은 폴더를 보도록 주소를 맞춥니다.
  document.querySelector("#back-link").href = `index.html?folder=${currentFolderId}`;
}

// 폴더를 바꾸면 그 폴더의 사이트 줄을 다시 그립니다.
document.querySelector("#folder-select").addEventListener("change", (event) => {
  currentFolderId = Number(event.target.value);
  renderRows();
});

// + 사이트 추가: 빈 줄을 하나 만들고 이름 칸에 커서를 둡니다.
document.querySelector("#add-row").addEventListener("click", async () => {
  if (currentFolderId === null) return; // 폴더가 없으면 사이트를 추가할 수 없음

  // DB에 빈 사이트 줄을 넣고, 만들어진 줄(DB가 붙인 id 포함)을 돌려받습니다.
  // 새 게시판은 제목 고르기 전까지 규칙 미설정(norule)입니다.
  const { data: newSite, error } = await db
    .from("sites")
    .insert({ folder_id: currentFolderId, name: "", board_url: "", keywords: [], last_status: "norule" })
    .select()
    .single();
  if (error) return showSaveError(error);

  sites.push(newSite);
  renderRows();
  const inputs = document.querySelectorAll("#site-rows .in-name");
  inputs[inputs.length - 1].focus();
});

// DB에서 폴더와 사이트를 읽은 뒤 화면을 그립니다.
async function loadData() {
  try {
    folders = await loadTable("folders", "sort_order");
    sites = await loadTable("sites", "id");

    // 주소의 폴더가 없으면 첫 번째 폴더로 (폴더가 아예 없으면 null)
    if (!folders.some((f) => f.id === currentFolderId)) {
      currentFolderId = folders.length > 0 ? folders[0].id : null;
    }
    renderFolderSelect();
    renderRows();
  } catch (error) {
    console.error("DB 읽기 실패:", error);
    document.querySelector("#site-rows").innerHTML =
      `<p class="empty">데이터를 불러오지 못했습니다: ${error.message}</p>`;
  }
}

loadData();
