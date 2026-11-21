// app.js
// 메인 화면(index.html)을 그리고, 버튼을 눌렀을 때 할 일을 정하는 코드입니다.
// 데이터는 Supabase DB에서 읽어 오고, 읽음 처리, 읽지 않음, 선택 삭제, 폴더 추가는 DB에 저장합니다.

// DB에서 읽어 온 데이터를 담아 둘 상자 (처음에는 비어 있음)
let folders = [];
let sites = [];
let notices = [];
let collector = { last_collect: null };
let scraps = []; // 스크랩한 공지 (공지와 따로 저장되어, 공지를 지워도 남음)
let scrapReady = true; // scraps 표가 아직 없으면(supabase-scrap.sql 실행 전) false

// 지금 보는 화면: "folder"(폴더의 공지) 또는 "scrap"(스크랩 모음)
let viewMode = "folder"; // "folder"(폴더의 공지), "dup"(폴더의 중복 정리), "scrap"(스크랩)
const openDupGroups = new Set(); // 중복 정리 화면에서 펼쳐 둔 묶음(제목)
// 스크랩 화면에서 고른 폴더: "all"(전체) 또는 폴더 id
let scrapFolderFilter = "all";

// 저장 용량: used_mb 는 DB에서 조회한 실제 사용량, limit_mb 는 Supabase 무료 요금제 DB 한도(500MB)
// 요금제를 바꾸거나 한도가 바뀌면 limit_mb 숫자만 고치면 됩니다.
// failed 는 사용량 조회에 실패했는지 표시합니다 (실패하면 막대를 회색 빗금으로).
const storageUsage = { used_mb: 0, limit_mb: 500, failed: false };

// 지금 선택한 폴더의 id
// 설정 화면에서 돌아올 때는 주소의 ?folder=2 값을 씁니다. 맞는 폴더가 없으면 DB를 읽은 뒤 첫 번째 폴더로 바꿉니다.
const params = new URLSearchParams(location.search);
let currentFolderId = Number(params.get("folder"));

// 저장 공간 알림을 x로 닫았는지 기억 (새로고침하면 다시 보임)
let alertClosed = false;

// 수집 상태 코드를 화면 글자로 바꾸는 표
const STATUS_TEXT = { ok: "정상", check: "확인 필요", norule: "규칙 미설정" };


// ---------- 도우미 함수 ----------

// "2026-11-10T09:02:00" 같은 날짜 글자를 "11.10 09:02" 모양으로 바꿉니다.
function formatDate(text) {
  const d = new Date(text);
  const mm = String(d.getMonth() + 1).padStart(2, "0"); // padStart: 한 자리 숫자 앞에 0을 붙임
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

// 사이트 id로 사이트 정보를 찾습니다.
function findSite(siteId) {
  return sites.find((site) => site.id === siteId);
}

// 어떤 폴더에 속한 사이트만 골라냅니다.
function sitesInFolder(folderId) {
  return sites.filter((site) => site.folder_id === folderId);
}

// 공지가 속한 폴더: 게시판이 있으면 게시판의 폴더(게시판을 다른 폴더로 옮긴 경우 반영),
// 게시판을 지운 공지는 공지에 저장해 둔 폴더(folder_id)
function folderOfNotice(notice) {
  const site = findSite(notice.site_id);
  return site ? site.folder_id : notice.folder_id;
}

// 어떤 폴더에 속한 공지만 골라냅니다 (최근 수집 순서).
function noticesInFolder(folderId) {
  return notices
    .filter((notice) => folderOfNotice(notice) === folderId)
    .sort((a, b) => b.collected_at.localeCompare(a.collected_at));
}


// ---------- 화면 그리기 ----------

// 왼쪽 폴더 목록
function renderFolders() {
  const list = document.querySelector("#folder-list");
  list.innerHTML = "";

  // sort_order 순서대로 보여줍니다 (폴더 설정 화면에서 바꾼 순서). slice()로 복사본을 정렬해 원본은 그대로 둡니다.
  const sorted = folders.slice().sort((a, b) => a.sort_order - b.sort_order);

  sorted.forEach((folder) => {
    const unread = noticesInFolder(folder.id).filter((n) => !n.read).length;

    const btn = document.createElement("button");
    btn.className = "folder-btn";
    if (viewMode === "folder" && folder.id === currentFolderId) btn.classList.add("active");

    btn.innerHTML = `<span class="folder-name"></span>`;
    // 사용자가 입력한 글자는 textContent 로 넣습니다 (글자 속 HTML이 실행되지 않도록)
    btn.querySelector(".folder-name").textContent = folder.name;
    if (unread > 0) {
      btn.innerHTML += `<span class="badge">${unread}</span>`;
    }

    btn.addEventListener("click", () => {
      currentFolderId = folder.id;
      viewMode = "folder"; // 스크랩 화면에 있었으면 공지 화면으로
      render();
    });
    list.appendChild(btn);
  });
}

// 사이드바 아래: 저장 공간 사용량 막대
// 평소 초록 / 70% 이상 주황 / 90% 이상 빨강
function renderStorageMeter() {
  const meter = document.querySelector("#storage-meter");
  const fill = document.querySelector("#storage-fill");
  const percentText = document.querySelector("#storage-percent");
  meter.classList.remove("hidden");

  // 색깔 클래스: 한 번 모두 떼고 해당하는 것만 붙입니다.
  fill.classList.remove("level-ok", "level-warn", "level-danger", "level-unknown");

  // 조회에 실패하면 막대 전체를 회색 빗금으로 채우고 "조회 실패"를 표시합니다.
  if (storageUsage.failed) {
    fill.classList.add("level-unknown");
    fill.style.width = "100%";
    percentText.textContent = "조회 실패";
    meter.dataset.tip = "사용량을 조회하지 못했습니다 (F12 Console에서 원인 확인)";
    return;
  }

  const percent = (storageUsage.used_mb / storageUsage.limit_mb) * 100;
  fill.style.width = Math.min(percent, 100) + "%"; // 막대 길이 (100%를 넘지 않게)

  if (percent >= 90) fill.classList.add("level-danger");
  else if (percent >= 70) fill.classList.add("level-warn");
  else fill.classList.add("level-ok");

  // 10% 미만은 소수점 한 자리까지 (예: 1.6%), 그 이상은 정수로 (예: 27%)
  const text = percent < 10 ? percent.toFixed(1) : Math.round(percent);
  percentText.textContent = text + "%";
  // 마우스를 올리면(휴대폰은 누르면) MB 단위 사용량을 말풍선으로 보여 줍니다.
  // dataset.tip 은 HTML의 data-tip 속성이 되고, style.css 가 이 글자를 말풍선에 그립니다.
  meter.dataset.tip = `${storageUsage.used_mb.toFixed(1)}MB / ${storageUsage.limit_mb}MB 사용`;
}

// 가운데 위: 폴더 이름, 마지막 수집 시각, 용량 알림
function renderHead() {
  const folder = folders.find((f) => f.id === currentFolderId);
  const siteCount = sitesInFolder(currentFolderId).length;

  document.querySelector("#folder-title").textContent = folder.name;
  document.querySelector("#folder-sub").textContent =
    `사이트 ${siteCount}곳, 마지막 수집 ${collector.last_collect ? formatDate(collector.last_collect) : "기록 없음"}`;

  const percent = Math.round((storageUsage.used_mb / storageUsage.limit_mb) * 100);
  const alertBox = document.querySelector("#storage-alert");
  // 80% 이상이고, 사용자가 x로 닫지 않았을 때만 보여 줍니다.
  if (percent >= 80 && !alertClosed) {
    document.querySelector("#storage-alert-text").textContent =
      `저장 공간이 부족합니다 (${percent}% 사용). 확인한 공지를 정리해 주세요.`;
    alertBox.classList.remove("hidden");
  } else {
    alertBox.classList.add("hidden");
  }
}

// 공지 목록 하나를 그립니다 (새로운 공지 칸, 확인한 공지 칸에 같이 사용)
function renderNoticeList(listId, items, emptyText) {
  const list = document.querySelector(listId);
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<li class="empty">${emptyText}</li>`;
    return;
  }

  items.forEach((notice) => {
    const site = findSite(notice.site_id);

    const li = document.createElement("li");
    li.className = "notice";
    if (!notice.read) li.classList.add("unread");

    li.innerHTML = `
      <input type="checkbox" class="notice-check" data-id="${notice.id}">
      <div class="notice-body">
        <a class="notice-title" href="${notice.link}"></a>
        <div class="notice-meta">
          <span class="site-tag"></span>
          <span>${formatDate(notice.collected_at)}</span>
        </div>
      </div>
      <button class="scrap-btn" title="스크랩"></button>`;
    li.querySelector(".notice-title").textContent = notice.title;
    setupScrapButton(li.querySelector(".scrap-btn"), notice);
    li.querySelector(".site-tag").textContent = site ? site.name : notice.site_name || ""; // 지운 게시판은 저장해 둔 이름

    // 제목 클릭: 원문을 새 탭으로 열고, 읽음으로 바꿔 확인한 공지로 옮깁니다.
    li.querySelector(".notice-title").addEventListener("click", async (event) => {
      event.preventDefault(); // 링크의 기본 동작(현재 탭 이동)을 막음
      // 새 탭은 클릭하자마자 열어야 합니다 (기다린 뒤에 열면 브라우저가 팝업으로 막을 수 있음)
      window.open(notice.link, "_blank", "noopener");
      if (notice.read) return; // 이미 읽은 공지면 저장할 것이 없음

      // DB의 read 값을 true로 바꿉니다: notices 테이블에서 id가 이 공지인 줄을 수정
      const { error } = await db.from("notices").update({ read: true }).eq("id", notice.id);
      if (error) return showSaveError(error);

      notice.read = true; // DB 저장이 성공하면 화면 데이터도 바꾸고 다시 그림
      render();
    });

    list.appendChild(li);
  });
}

// ---------- 중복 정리 ----------

// 제목 비교용 글자: 앞뒤 공백을 빼고, 띄어쓰기 여러 개는 하나로 봅니다.
function titleKey(title) {
  return title.trim().replace(/\s+/g, " ");
}

// 지금 폴더에서 제목이 같은 공지가 2건 이상인 묶음 목록 (새로운 공지, 확인한 공지 모두)
function dupGroups(folderId) {
  const byTitle = new Map(); // 제목 -> 그 제목의 공지들
  noticesInFolder(folderId).forEach((notice) => {
    const key = titleKey(notice.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(notice);
  });
  return Array.from(byTitle.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([title, list]) => ({ title, list }));
}

// 중복 정리 화면: 묶음 제목 줄(▶ 접힘 / ▼ 펼침)과 펼친 묶음 안의 공지들
function renderDup() {
  const groups = dupGroups(currentFolderId);
  document.querySelector("#dup-count").textContent = groups.length;
  document.querySelector("#dup-all").checked = false;

  const list = document.querySelector("#dup-list");
  list.innerHTML = "";
  if (groups.length === 0) {
    list.innerHTML = `<li class="empty">이 폴더에는 제목이 같은 공지가 없습니다.</li>`;
    return;
  }

  groups.forEach((group) => {
    const open = openDupGroups.has(group.title);
    const li = document.createElement("li");
    li.className = "dup-group";
    li.innerHTML = `
      <button type="button" class="dup-head">
        <span class="dup-icon">${open ? "▼" : "▶"}</span>
        <span class="dup-title"></span>
        <span class="dup-num">${group.list.length}건</span>
      </button>
      <ul class="dup-items${open ? "" : " hidden"}"></ul>`;
    li.querySelector(".dup-title").textContent = group.title;

    // 제목 줄을 누르면 펼치고 접습니다.
    li.querySelector(".dup-head").addEventListener("click", () => {
      if (openDupGroups.has(group.title)) openDupGroups.delete(group.title);
      else openDupGroups.add(group.title);
      render();
    });

    const items = li.querySelector(".dup-items");
    group.list.forEach((notice) => {
      const site = findSite(notice.site_id);
      const row = document.createElement("li");
      row.className = "notice";
      if (!notice.read) row.classList.add("unread");
      row.innerHTML = `
        <input type="checkbox" class="notice-check" data-id="${notice.id}">
        <div class="notice-body">
          <a class="notice-title" href="${notice.link}"></a>
          <div class="notice-meta">
            <span>${formatDate(notice.collected_at)}</span>
            <span>${notice.read ? "확인한 공지" : "새로운 공지"}</span>
          </div>
        </div>`;
      // 묶음 안에서는 제목이 모두 같으므로, 제목 대신 게시판 이름을 보여 줍니다. (누르면 그 게시판의 원문)
      row.querySelector(".notice-title").textContent = site ? site.name : notice.site_name || "(지운 게시판)";
      row.querySelector(".notice-title").addEventListener("click", async (event) => {
        event.preventDefault();
        window.open(notice.link, "_blank", "noopener");
        if (notice.read) return;
        const { error } = await db.from("notices").update({ read: true }).eq("id", notice.id);
        if (error) return showSaveError(error);
        notice.read = true;
        render();
      });
      items.appendChild(row);
    });
    list.appendChild(li);
  });
}

// ---------- 스크랩 ----------

// 이 링크를 스크랩했는지 찾습니다 (스크랩은 링크로 구분, 같은 링크는 한 번만)
function findScrap(link) {
  return scraps.find((scrap) => scrap.link === link);
}

// 공지 줄의 별 버튼: 빈 별(☆)을 누르면 스크랩, 채운 별(★)을 누르면 스크랩 해제
function setupScrapButton(button, notice) {
  const scrapped = !!findScrap(notice.link); // !! : 찾았으면 true, 없으면 false
  button.textContent = scrapped ? "★" : "☆";
  button.classList.toggle("on", scrapped);
  button.title = scrapped ? "스크랩 해제" : "스크랩";

  button.addEventListener("click", async () => {
    const scrap = findScrap(notice.link);
    if (scrap) {
      await removeScraps([scrap.id]);
      return;
    }
    await addScraps([notice]);
  });
}

// 공지 여러 개를 스크랩합니다 (별 버튼은 1개, "스크랩" 버튼은 체크한 공지 전부).
// 이미 스크랩한 공지는 건너뜁니다.
async function addScraps(noticeList) {
  if (!scrapReady) {
    alert("스크랩 표가 아직 없습니다. Supabase SQL Editor 에서 supabase-scrap.sql 을 먼저 실행해 주세요.");
    return;
  }
  // 공지 정보를 스크랩 표에 복사해 둡니다 (나중에 공지를 지워도 스크랩은 남도록)
  const rows = noticeList
    .filter((notice) => !findScrap(notice.link))
    .map((notice) => {
      const site = findSite(notice.site_id);
      return {
        folder_id: folderOfNotice(notice),
        site_name: site ? site.name : notice.site_name || "",
        title: notice.title,
        link: notice.link,
      };
    });
  if (rows.length === 0) return render(); // 모두 이미 스크랩됨 (체크만 풀어 줌)

  // 여러 줄을 한 번에 넣고(insert 에 배열), 만들어진 줄들을 돌려받습니다(select).
  const { data, error } = await db.from("scraps").insert(rows).select();
  if (error) return showSaveError(error);
  scraps.unshift(...data); // unshift: 목록 맨 앞에 넣기 (최근 스크랩이 위로), ... 은 배열을 하나씩 풀어 넣기
  render();
}

// 스크랩 여러 개를 해제(삭제)합니다. 공지 자체는 지워지지 않습니다.
async function removeScraps(ids) {
  const { error } = await db.from("scraps").delete().in("id", ids);
  if (error) return showSaveError(error);
  scraps = scraps.filter((scrap) => !ids.includes(scrap.id));
  render();
}

// 왼쪽 "스크랩" 항목: 스크랩 화면일 때 강조, 오른쪽에 스크랩 개수
function renderScrapNav() {
  document.querySelector("#scrap-nav").classList.toggle("active", viewMode === "scrap");
  const countBadge = document.querySelector("#scrap-nav-count");
  countBadge.textContent = scraps.length;
  countBadge.classList.toggle("hidden", scraps.length === 0);
}

// 스크랩 화면: 폴더 고르기(전체 / 폴더별)와 스크랩 목록
function renderScrap() {
  // 폴더 고르기 칸: 맨 위 "전체", 그 아래 폴더 순서대로
  const select = document.querySelector("#scrap-folder");
  const sorted = folders.slice().sort((a, b) => a.sort_order - b.sort_order);
  select.innerHTML = `<option value="all">전체</option>`;
  sorted.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  });
  // 고른 폴더가 지워졌으면 전체로
  if (scrapFolderFilter !== "all" && !folders.some((f) => f.id === scrapFolderFilter)) {
    scrapFolderFilter = "all";
  }
  select.value = String(scrapFolderFilter);

  const items = scraps
    .filter((scrap) => scrapFolderFilter === "all" || scrap.folder_id === scrapFolderFilter)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)); // 최근 스크랩 순서

  document.querySelector("#folder-title").textContent = "스크랩";
  document.querySelector("#folder-sub").textContent = scrapReady
    ? "별(☆)을 눌러 모아 둔 공지입니다. 공지 목록에서 지워도 스크랩은 남습니다."
    : "스크랩 표가 아직 없습니다. Supabase SQL Editor 에서 supabase-scrap.sql 을 실행해 주세요.";
  document.querySelector("#scrap-count").textContent = items.length;
  document.querySelector("#scrap-all").checked = false;

  const list = document.querySelector("#scrap-list");
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = `<li class="empty">스크랩한 공지가 없습니다.</li>`;
    return;
  }

  items.forEach((scrap) => {
    const li = document.createElement("li");
    li.className = "notice";
    li.innerHTML = `
      <input type="checkbox" class="notice-check" data-id="${scrap.id}">
      <div class="notice-body">
        <a class="notice-title scrap-title" href="${scrap.link}"></a>
        <div class="notice-meta">
          <span class="folder-tag"></span>
          <span class="site-tag"></span>
          <span>${formatDate(scrap.created_at)}</span>
        </div>
      </div>
      <button class="scrap-btn on" title="스크랩 해제">★</button>`;
    li.querySelector(".notice-title").textContent = scrap.title;
    li.querySelector(".site-tag").textContent = scrap.site_name || "";

    // 전체를 볼 때만 어느 폴더의 스크랩인지 표시
    const folder = folders.find((f) => f.id === scrap.folder_id);
    const folderTag = li.querySelector(".folder-tag");
    if (scrapFolderFilter === "all" && folder) folderTag.textContent = folder.name;
    else folderTag.remove();

    // 제목 클릭: 원문을 새 탭으로 열고, 아직 안 읽은 공지면 읽음 처리
    li.querySelector(".notice-title").addEventListener("click", async (event) => {
      event.preventDefault();
      window.open(scrap.link, "_blank", "noopener");
      const notice = notices.find((n) => n.link === scrap.link && !n.read);
      if (!notice) return;
      const { error } = await db.from("notices").update({ read: true }).eq("id", notice.id);
      if (error) return showSaveError(error);
      notice.read = true;
      render();
    });

    li.querySelector(".scrap-btn").addEventListener("click", () => removeScraps([scrap.id]));
    list.appendChild(li);
  });
}

// 가운데: 새로운 공지와 확인한 공지
function renderNotices() {
  const items = noticesInFolder(currentFolderId);
  const newItems = items.filter((n) => !n.read);
  const readItems = items.filter((n) => n.read);

  document.querySelector("#new-count").textContent = newItems.length;
  document.querySelector("#read-count").textContent = readItems.length;

  renderNoticeList("#new-list", newItems, "새로운 공지가 없습니다.");
  renderNoticeList("#read-list", readItems, "확인한 공지가 없습니다.");

  // 다시 그렸으니 전체 선택 체크도 풀어 둡니다.
  document.querySelector("#new-all").checked = false;
  document.querySelector("#read-all").checked = false;
}

// 오른쪽: 이 폴더의 사이트 목록과 수집 상태
function renderSites() {
  const list = document.querySelector("#site-list");
  list.innerHTML = "";
  const folderSites = sitesInFolder(currentFolderId);

  if (folderSites.length === 0) {
    list.innerHTML = `<li class="empty">등록된 사이트가 없습니다. 설정에서 추가하세요.</li>`;
  }

  folderSites.forEach((site) => {
    const li = document.createElement("li");
    li.className = "site";
    li.innerHTML = `
      <div class="site-info">
        <div class="site-name"></div>
        <div class="site-keywords"></div>
      </div>
      <span class="status status-${site.last_status}">${STATUS_TEXT[site.last_status]}</span>`;
    li.querySelector(".site-name").textContent = site.name;
    li.querySelector(".site-keywords").textContent =
      site.keywords.length > 0 ? "키워드: " + site.keywords.join(", ") : "키워드 없음 (전체)";
    list.appendChild(li);
  });

  // 설정 버튼은 지금 폴더를 주소에 붙여서 엽니다 (예: settings.html?folder=2)
  document.querySelector("#settings-link").href = `settings.html?folder=${currentFolderId}`;
}

// 화면 전체를 다시 그립니다.
function render() {
  renderFolders();
  renderScrapNav();
  renderStorageMeter();

  // 스크랩 화면과 공지 화면에서 보이는 칸을 바꿉니다 (style.css 의 scrap-mode)
  document.body.classList.toggle("scrap-mode", viewMode === "scrap");
  document.querySelector("#scrap-filter").classList.toggle("hidden", viewMode !== "scrap");
  document.querySelector("#panel-scrap").classList.toggle("hidden", viewMode !== "scrap");
  if (viewMode === "scrap") {
    document.querySelector("#storage-alert").classList.add("hidden");
    renderScrap();
    return;
  }

  // 폴더가 하나도 없으면 안내만 보여 줍니다.
  if (currentFolderId === null) {
    document.querySelector("#folder-title").textContent = "폴더가 없습니다";
    document.querySelector("#folder-sub").textContent = "왼쪽 + 버튼으로 폴더를 추가해 주세요.";
    return;
  }

  renderHead();
  renderSites();

  // 중복 정리 버튼: 묶음 수 표시, 중복 정리 화면에서는 "공지 목록"으로 돌아가는 버튼
  const dupCount = dupGroups(currentFolderId).length;
  document.querySelector("#dup-btn").innerHTML =
    viewMode === "dup" ? "공지 목록으로" : `중복 정리 <span class="count">${dupCount}</span>`;
  document.body.classList.toggle("dup-mode", viewMode === "dup");
  document.querySelector("#panel-dup").classList.toggle("hidden", viewMode !== "dup");
  if (viewMode === "dup") renderDup();
  else renderNotices();
}

// DB 사용량을 조회합니다. (SQL Editor에서 만든 get_db_size 함수를 rpc 로 부름)
// 실패해도 공지 화면은 그대로 보여야 하므로, 오류는 Console에만 남기고 넘어갑니다.
async function loadStorageUsage() {
  await authReady; // 로그인한 사람만 조회 가능
  const { data, error } = await db.rpc("get_db_size"); // 결과: 바이트 단위 숫자
  if (error) {
    console.warn("저장 용량 조회 실패:", error);
    storageUsage.failed = true;
    return;
  }
  storageUsage.failed = false;
  storageUsage.used_mb = data / 1024 / 1024; // 바이트를 MB로 (1MB = 1024 x 1024 바이트)
}

// DB에서 폴더, 사이트, 공지, 수집 기록을 읽어 온 뒤 화면을 그립니다.
async function loadData() {
  try {
    folders = await loadTable("folders", "sort_order");
    if (folders.length === 0) {
      // 처음 가입한 사람: 폴더가 하나도 없으면 기본 폴더를 하나 만들어 줍니다.
      const { data, error } = await db.from("folders").insert({ name: "내 공지", sort_order: 1 }).select().single();
      if (error) throw error;
      folders = [data];
    }
    sites = await loadTable("sites", "id");
    notices = await loadTable("notices", "collected_at", false); // false: 최근 것부터
    // 스크랩: 표가 아직 없어도(SQL 실행 전) 공지 화면은 보이도록 따로 처리
    try {
      scraps = await loadTable("scraps", "created_at", false);
      scrapReady = true;
    } catch (error) {
      console.warn("스크랩 읽기 실패 (supabase-scrap.sql 실행 여부 확인):", error);
      scraps = [];
      scrapReady = false;
    }
    const collectorRows = await loadTable("collector", "id");
    collector = collectorRows[0] || { last_collect: null }; // 기록이 없으면 빈 값
    await loadStorageUsage();

    // 주소의 폴더가 없으면 첫 번째 폴더로 (폴더가 아예 없으면 null)
    if (!folders.some((f) => f.id === currentFolderId)) {
      currentFolderId = folders.length > 0 ? folders[0].id : null;
    }
    render();
  } catch (error) {
    // try 안에서 오류가 나면 여기로 옵니다. 화면에 알리고, 자세한 내용은 Console에 남깁니다.
    console.error("DB 읽기 실패:", error);
    document.querySelector("#folder-title").textContent = "데이터를 불러오지 못했습니다";
    document.querySelector("#folder-sub").textContent = error.message;
  }
}


// ---------- 버튼 연결 ----------

// 폴더 추가: + 버튼으로 입력칸을 열고 닫습니다.
document.querySelector("#add-folder-btn").addEventListener("click", () => {
  const form = document.querySelector("#add-folder-form");
  form.classList.toggle("hidden");
  document.querySelector("#new-folder-name").focus();
});

// 폴더 추가: 입력칸에서 추가를 누르면 폴더를 만듭니다.
document.querySelector("#add-folder-form").addEventListener("submit", async (event) => {
  event.preventDefault(); // 폼의 기본 동작(페이지 새로고침)을 막음
  const input = document.querySelector("#new-folder-name");
  const name = input.value.trim();
  if (name === "") return;

  // 맨 아래 순서 번호 = 지금 가장 큰 번호 + 1
  const maxOrder = folders.reduce((max, f) => Math.max(max, f.sort_order), 0);

  // DB에 새 폴더를 넣고(insert), 만들어진 줄을 그대로 돌려받습니다(select, single).
  // id는 DB가 자동으로 붙여 주므로, 돌려받은 줄에서 꺼내 씁니다.
  const { data: newFolder, error } = await db
    .from("folders")
    .insert({ name: name, sort_order: maxOrder + 1 })
    .select()
    .single();
  if (error) return showSaveError(error);

  folders.push(newFolder);
  currentFolderId = newFolder.id;
  viewMode = "folder";

  input.value = "";
  document.querySelector("#add-folder-form").classList.add("hidden");
  render();
});

// 전체 선택과 선택 삭제 (section 은 "new" 또는 "read")
function setupListTools(section) {
  const checkAll = document.querySelector(`#${section}-all`);

  checkAll.addEventListener("change", () => {
    document.querySelectorAll(`#${section}-list .notice-check`).forEach((box) => {
      box.checked = checkAll.checked;
    });
  });

  document.querySelector(`#${section}-delete`).addEventListener("click", async () => {
    const checked = document.querySelectorAll(`#${section}-list .notice-check:checked`);
    if (checked.length === 0) return;

    const ids = Array.from(checked).map((box) => Number(box.dataset.id));

    // DB에서 고른 공지를 삭제합니다: id가 ids 목록 안에 있는(in) 줄 전부
    const { error } = await db.from("notices").delete().in("id", ids);
    if (error) return showSaveError(error);

    // 화면 데이터에서도 뺍니다. 뒤에서부터 지워야 순서가 꼬이지 않습니다.
    for (let i = notices.length - 1; i >= 0; i--) {
      if (ids.includes(notices[i].id)) notices.splice(i, 1);
    }
    render();
  });
}

setupListTools("new");
setupListTools("read");
setupListTools("dup"); // 중복 정리 화면의 전체 선택, 선택 삭제 (같은 방식)

// 중복 정리 버튼: 폴더 공지 화면 <-> 중복 정리 화면
document.querySelector("#dup-btn").addEventListener("click", () => {
  viewMode = viewMode === "dup" ? "folder" : "dup";
  render();
});

// 왼쪽 "스크랩" 항목: 스크랩 화면 열기
document.querySelector("#scrap-nav").addEventListener("click", () => {
  viewMode = "scrap";
  render();
});

// 스크랩 화면의 폴더 고르기: 전체 또는 폴더 하나
document.querySelector("#scrap-folder").addEventListener("change", (event) => {
  const value = event.target.value;
  scrapFolderFilter = value === "all" ? "all" : Number(value);
  render();
});

// 스크랩 전체 선택과 선택한 스크랩 해제
document.querySelector("#scrap-all").addEventListener("change", (event) => {
  document.querySelectorAll("#scrap-list .notice-check").forEach((box) => {
    box.checked = event.target.checked;
  });
});
document.querySelector("#scrap-delete").addEventListener("click", () => {
  const checked = document.querySelectorAll("#scrap-list .notice-check:checked");
  if (checked.length === 0) return;
  removeScraps(Array.from(checked).map((box) => Number(box.dataset.id)));
});

// 체크한 공지의 id 목록 (section 은 "new" 또는 "read")
function checkedIds(section) {
  const checked = document.querySelectorAll(`#${section}-list .notice-check:checked`);
  return Array.from(checked).map((box) => Number(box.dataset.id));
}

// 읽음: 새로운 공지에서 고른 공지를 확인한 공지로 옮깁니다 (읽지 않음의 반대).
document.querySelector("#new-read").addEventListener("click", async () => {
  const ids = checkedIds("new");
  if (ids.length === 0) return;

  const { error } = await db.from("notices").update({ read: true }).in("id", ids);
  if (error) return showSaveError(error);

  notices.forEach((notice) => {
    if (ids.includes(notice.id)) notice.read = true;
  });
  render();
});

// 스크랩: 체크한 공지를 한꺼번에 스크랩합니다 (새로운 공지, 확인한 공지 칸 모두)
["new", "read"].forEach((section) => {
  document.querySelector(`#${section}-scrap`).addEventListener("click", () => {
    const ids = checkedIds(section);
    if (ids.length === 0) return;
    addScraps(notices.filter((notice) => ids.includes(notice.id)));
  });
});

// 읽지 않음: 확인한 공지에서 고른 공지를 새로운 공지로 되돌립니다.
document.querySelector("#read-unread").addEventListener("click", async () => {
  const checked = document.querySelectorAll("#read-list .notice-check:checked");
  if (checked.length === 0) return;

  const ids = Array.from(checked).map((box) => Number(box.dataset.id));

  // DB에서 고른 공지의 read 값을 false로 바꿉니다.
  const { error } = await db.from("notices").update({ read: false }).in("id", ids);
  if (error) return showSaveError(error);

  notices.forEach((notice) => {
    if (ids.includes(notice.id)) notice.read = false;
  });
  render();
});

// 읽음: 새로운 공지에서 고른 공지를 확인한 공지로 옮깁니다 (읽지 않음의 반대, 원문은 열지 않음).
document.querySelector("#new-read").addEventListener("click", async () => {
  const checked = document.querySelectorAll("#new-list .notice-check:checked");
  if (checked.length === 0) return;

  const ids = Array.from(checked).map((box) => Number(box.dataset.id));

  // DB에서 고른 공지의 read 값을 true로 바꿉니다.
  const { error } = await db.from("notices").update({ read: true }).in("id", ids);
  if (error) return showSaveError(error);

  notices.forEach((notice) => {
    if (ids.includes(notice.id)) notice.read = true;
  });
  render();
});

// 사이드바 숨기기: body에 sidebar-hidden 클래스를 붙였다 뗐다 하면, style.css가 폴더 칸을 숨깁니다.
document.querySelector("#toggle-sidebar").addEventListener("click", () => {
  document.body.classList.toggle("sidebar-hidden");
});

// 저장 공간 알림의 x 버튼
document.querySelector("#storage-alert-close").addEventListener("click", () => {
  alertClosed = true;
  document.querySelector("#storage-alert").classList.add("hidden");
});

// 처음 화면 그리기: DB를 읽은 뒤에 그립니다.
loadData();
