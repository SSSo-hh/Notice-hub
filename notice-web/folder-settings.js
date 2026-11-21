// folder-settings.js
// 폴더 설정 화면(folder-settings.html): 폴더 순서 변경(끌어서 놓기), 이름 변경, 추가, 삭제
// 데이터는 Supabase DB에서 읽어 오고, 바꾼 내용은 바로 DB에 저장합니다.

// DB에서 읽어 온 데이터를 담아 둘 상자
let folders = [];
let sites = []; // 폴더별 사이트 수를 세는 데 사용

// sort_order 순서대로 정렬한 폴더 목록을 돌려줍니다.
function sortedFolders() {
  return folders.slice().sort((a, b) => a.sort_order - b.sort_order);
}

// 받은 순서대로 sort_order를 1, 2, 3 ... 으로 매기고, 번호가 바뀐 폴더만 DB에 저장합니다.
async function saveOrder(list) {
  const changed = [];
  list.forEach((folder, index) => {
    if (folder.sort_order !== index + 1) {
      folder.sort_order = index + 1;
      changed.push(folder);
    }
  });

  // for...of: 목록을 하나씩 꺼내며 반복합니다. 하나씩 await 로 저장이 끝나길 기다립니다.
  for (const folder of changed) {
    const { error } = await db.from("folders").update({ sort_order: folder.sort_order }).eq("id", folder.id);
    if (error) return showSaveError(error);
  }
}

// 화면에 놓인 줄 순서 그대로 저장합니다 (끌어서 놓기가 끝났을 때 사용).
function saveOrderFromScreen() {
  const rows = document.querySelectorAll("#folder-rows .folder-row");
  const list = Array.from(rows).map((row) => folders.find((f) => f.id === Number(row.dataset.id)));
  saveOrder(list);
}

// 폴더 삭제 (그 폴더의 사이트와 공지도 같이 삭제)
async function deleteFolder(folder) {
  const folderSites = sites.filter((site) => site.folder_id === folder.id);

  if (folderSites.length > 0) {
    // confirm: 확인/취소 창을 띄우고, 확인을 누르면 true를 돌려줍니다.
    const ok = confirm(`"${folder.name}" 폴더의 사이트 ${folderSites.length}곳과 공지도 함께 삭제됩니다. 삭제할까요?`);
    if (!ok) return;
  }

  // DB에서 폴더를 지웁니다. 그 폴더의 사이트와 공지는 DB가 자동으로 같이 지웁니다(on delete cascade).
  const { error } = await db.from("folders").delete().eq("id", folder.id);
  if (error) return showSaveError(error);

  // 화면 데이터에서도 뺍니다. 뒤에서부터 지워야 순서가 꼬이지 않습니다.
  for (let i = sites.length - 1; i >= 0; i--) {
    if (sites[i].folder_id === folder.id) sites.splice(i, 1);
  }
  folders.splice(folders.indexOf(folder), 1);

  renderRows();
  await saveOrder(sortedFolders()); // 빈 번호가 생기지 않게 순서를 다시 매겨 저장
}

// ---------- 끌어서 순서 바꾸기 ----------
// pointer 이벤트: 마우스와 휴대폰 터치를 한 번에 처리하는 이벤트입니다.
//   순서: pointerdown(누름), pointermove(움직임), pointerup(뗌)
// 줄을 옮기는 동안 손잡이가 화면에서 잠깐 빠졌다 들어가므로,
// 움직임과 뗌은 손잡이가 아니라 문서 전체(document)에서 받습니다.

let dragRow = null; // 지금 끌고 있는 줄 (끌고 있지 않으면 null)

// 손잡이를 누르면 끌기 시작
function setupDrag(row, handle) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragRow = row;
    row.classList.add("dragging");
    document.body.classList.add("is-dragging");
  });
}

// 움직이는 동안: 포인터 위치에 맞춰 줄을 끼워 넣습니다.
document.addEventListener("pointermove", (event) => {
  if (!dragRow) return;
  const box = document.querySelector("#folder-rows");

  // 끌고 있는 줄을 뺀 나머지 줄 중에서, 포인터가 그 줄의 가운데보다 위에 있는 첫 줄을 찾습니다.
  const others = Array.from(box.querySelectorAll(".folder-row:not(.dragging)"));
  const next = others.find((other) => {
    const rect = other.getBoundingClientRect(); // 그 줄의 화면 위치와 크기
    return event.clientY < rect.top + rect.height / 2;
  });

  // 찾은 줄 앞에 끼워 넣고, 없으면 맨 아래로 보냅니다. (이미 그 자리면 그대로 둠)
  if (next) {
    if (dragRow.nextElementSibling !== next) box.insertBefore(dragRow, next);
  } else if (box.lastElementChild !== dragRow) {
    box.appendChild(dragRow);
  }
});

// 손을 떼거나(pointerup) 끌기가 취소되면(pointercancel) 끝내고 순서를 저장합니다.
function finishDrag() {
  if (!dragRow) return;
  dragRow.classList.remove("dragging");
  document.body.classList.remove("is-dragging");
  dragRow = null;
  saveOrderFromScreen();
}
document.addEventListener("pointerup", finishDrag);
document.addEventListener("pointercancel", finishDrag);

// 폴더 줄 목록 그리기
function renderRows() {
  const box = document.querySelector("#folder-rows");
  box.innerHTML = "";
  const list = sortedFolders();

  list.forEach((folder) => {
    const siteCount = sites.filter((site) => site.folder_id === folder.id).length;

    const row = document.createElement("div");
    row.className = "row folder-row";
    row.dataset.id = folder.id; // 끌어서 놓은 뒤 어떤 폴더인지 찾을 때 사용
    row.innerHTML = `
      <div class="cell">
        <div class="drag-handle" title="끌어서 순서 변경"><span></span><span></span><span></span></div>
      </div>
      <label class="cell"><span class="cell-label">폴더 이름</span>
        <input type="text" class="in-name" maxlength="20" placeholder="폴더 이름"></label>
      <div class="cell cell-count"><span class="site-count">${siteCount}곳</span></div>
      <div class="cell cell-del"><button class="del-btn" title="삭제">삭제</button></div>`;

    const nameInput = row.querySelector(".in-name");
    nameInput.value = folder.name;
    // change: 입력을 마치고 칸을 벗어나거나 Enter를 누를 때 한 번 생기는 이벤트 (글자마다 저장하지 않도록)
    nameInput.addEventListener("change", async () => {
      const newName = nameInput.value.trim();
      if (newName === "") {
        nameInput.value = folder.name; // 빈 이름은 받지 않고 원래 이름으로 되돌림
        return;
      }
      const { error } = await db.from("folders").update({ name: newName }).eq("id", folder.id);
      if (error) {
        nameInput.value = folder.name;
        return showSaveError(error);
      }
      folder.name = newName;
    });

    const delBtn = row.querySelector(".del-btn");
    // 폴더가 하나뿐이면 삭제할 수 없게 합니다 (공지 화면에 보여줄 폴더가 없어지므로).
    delBtn.disabled = list.length === 1;
    delBtn.addEventListener("click", () => deleteFolder(folder));

    setupDrag(row, row.querySelector(".drag-handle"));

    box.appendChild(row);
  });
}

// + 폴더 추가: 맨 아래에 빈 폴더 줄을 만들고 이름 칸에 커서를 둡니다.
document.querySelector("#add-folder-row").addEventListener("click", async () => {
  const maxOrder = folders.reduce((max, f) => Math.max(max, f.sort_order), 0);

  // DB에 새 폴더를 넣고, 만들어진 줄(DB가 붙인 id 포함)을 돌려받습니다.
  const { data: newFolder, error } = await db
    .from("folders")
    .insert({ name: "새 폴더", sort_order: maxOrder + 1 })
    .select()
    .single();
  if (error) return showSaveError(error);

  folders.push(newFolder);
  renderRows();
  const inputs = document.querySelectorAll("#folder-rows .in-name");
  const last = inputs[inputs.length - 1];
  last.focus();
  last.select(); // "새 폴더" 글자를 선택해 두면 바로 덮어쓸 수 있습니다.
});

// DB에서 폴더와 사이트를 읽은 뒤 화면을 그립니다.
async function loadData() {
  try {
    folders = await loadTable("folders", "sort_order");
    sites = await loadTable("sites", "id");
    renderRows();
  } catch (error) {
    console.error("DB 읽기 실패:", error);
    document.querySelector("#folder-rows").innerHTML =
      `<p class="empty">데이터를 불러오지 못했습니다: ${error.message}</p>`;
  }
}

loadData();
