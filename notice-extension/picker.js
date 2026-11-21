// picker.js
// 제목 고르기 화면입니다. 게시판 페이지(와 그 안의 iframe)에 넣어 실행합니다.
// - 마우스를 올린 곳에 파란 점선 테두리
// - 공지 제목을 클릭하면 같은 모양의 제목들을 노란 테두리로, 고른 제목은 빨간 테두리로 표시
// - 페이지 위쪽 안내 막대(맨 위 프레임에만)에서 저장, 빠진 제목 추가, 다시 고르기, 취소
// 고르는 동안 페이지의 원래 클릭 동작(글 열기 등)은 막습니다.

(() => {
  // 이미 들어가 있으면 처음 상태로 다시 시작만 합니다.
  if (window.__ntPicker) {
    window.__ntPicker.restart();
    return;
  }

  const R = self.NoticeRules;
  const isTop = window === window.top;
  let mode = "pick";       // pick: 고르기, add: 빠진 제목 추가, off: 끝남
  let areas = [];          // 찾은 목록 영역들
  let sampleTitle = null;  // 처음 고른 제목
  let hoverEl = null;
  const saved = new Map(); // 테두리를 칠한 요소 -> 원래 테두리 값 (끝날 때 되돌리기)

  // ---------- 테두리 칠하기 ----------
  // 사이트가 "a { outline: none !important }" 처럼 테두리를 막아 두어도 보이도록 important 로 칠합니다.
  function paint(el, outline) {
    const st = el.style;
    if (!saved.has(el)) {
      saved.set(el, {
        outline: st.getPropertyValue("outline"), outlinePri: st.getPropertyPriority("outline"),
        offset: st.getPropertyValue("outline-offset"), offsetPri: st.getPropertyPriority("outline-offset"),
      });
    }
    st.setProperty("outline", outline, "important");
    st.setProperty("outline-offset", "-2px", "important"); // 안쪽으로 그려야 overflow:hidden 칸에서도 보임
  }
  function unpaint(el) {
    const prev = saved.get(el);
    if (!prev) return;
    const st = el.style;
    st.removeProperty("outline");
    st.removeProperty("outline-offset");
    if (prev.outline) st.setProperty("outline", prev.outline, prev.outlinePri);
    if (prev.offset) st.setProperty("outline-offset", prev.offset, prev.offsetPri);
    saved.delete(el);
  }
  function clearPaint() {
    [...saved.keys()].forEach(unpaint);
    hoverEl = null;
  }

  // ---------- 안내 막대 (맨 위 프레임에만) ----------
  let host = null;
  let root = null;
  function ensureBar() {
    if (!isTop || host) return;
    host = document.createElement("div");
    host.id = "__nt_picker_host";
    host.style.cssText = "all:initial; position:fixed; top:12px; left:50%; transform:translateX(-50%); z-index:2147483647;";
    // shadow DOM: 사이트의 CSS 가 막대 모양을 망가뜨리지 않게 따로 떼어 둡니다.
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .bar { min-width: 340px; max-width: 560px; padding: 12px 14px; border-radius: 12px;
               background: #1d2129; color: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.28);
               font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
        .mark { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 6px; background: #2f5bea; font-size: 11px; }
        .msg { margin-top: 6px; }
        .sub { margin-top: 4px; color: #b9c0cc; font-size: 12px; white-space: pre-line; max-height: 110px; overflow: auto; }
        .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        button { height: 30px; padding: 0 12px; border: 1px solid #3a404c; border-radius: 8px; background: #2a2f39;
                 color: #fff; font: inherit; cursor: pointer; }
        button:hover { background: #343a46; }
        button.primary { background: #2f5bea; border-color: #2f5bea; }
        button.primary:hover { background: #2349c7; }
      </style>
      <div class="bar">
        <div class="head"><span class="mark">N</span>공지 모음: 제목 고르기</div>
        <div class="msg"></div>
        <div class="sub"></div>
        <div class="btns"></div>
      </div>`;
    document.documentElement.appendChild(host);
  }
  function setBar(msg, sub, buttons) {
    if (!isTop) return;
    ensureBar();
    root.querySelector(".msg").textContent = msg;
    root.querySelector(".sub").textContent = sub || "";
    const box = root.querySelector(".btns");
    box.innerHTML = "";
    (buttons || []).forEach((b) => {
      const el = document.createElement("button");
      el.textContent = b.label;
      if (b.primary) el.className = "primary";
      el.addEventListener("click", b.onClick);
      box.appendChild(el);
    });
  }
  function removeBar() {
    if (host) host.remove();
    host = null;
    root = null;
  }

  // 모든 프레임에 명령 보내기 (background 를 거쳐 같은 탭의 모든 프레임으로)
  function broadcast(payload) {
    chrome.runtime.sendMessage({ type: "pickerBroadcast", payload });
  }
  const cancelButton = { label: "취소", onClick: () => broadcast({ type: "pickerStop" }) };

  function showStart() {
    setBar("공지 제목 하나를 클릭하세요.", "고르는 동안에는 페이지의 원래 클릭 동작이 멈춰 있습니다.", [cancelButton]);
  }

  // ---------- 마우스 처리 ----------
  // 막대(우리 화면)를 누른 것인지
  function isOurs(e) {
    return host && (e.target === host || host.contains(e.target));
  }

  function onOver(e) {
    if (mode === "off" || isOurs(e)) return;
    const t = R.resolveTitleElement(e.target);
    if (!t || t === hoverEl) return;
    if (hoverEl && !hoverEl.__ntMarked) unpaint(hoverEl);
    hoverEl = t;
    if (!t.__ntMarked) paint(t, "2px dashed #2f5bea");
  }

  // 페이지의 원래 동작(링크 이동, onclick)을 막습니다. 클릭은 아래 onClick 에서 처리합니다.
  function block(e) {
    if (mode === "off" || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (mode === "off" || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const titleEl = R.resolveTitleElement(e.target);
    const found = titleEl && R.deriveStructure(titleEl);
    if (!found) {
      chrome.runtime.sendMessage({ type: "pickerResult", ok: false });
      return;
    }
    if (mode === "add") {
      areas = R.mergeAreas(areas, found.area);
    } else {
      areas = [found.area];
      sampleTitle = R.cleanText(titleEl.textContent);
    }
    mode = "pick";

    // 찾은 제목들 표시: 노란 테두리, 처음 고른 제목은 빨간 테두리
    clearPaint();
    const items = R.findItems(document, areas);
    items.forEach((it) => {
      it.titleEl.__ntMarked = true;
      paint(it.titleEl, it.title === sampleTitle ? "3px solid #e5484d" : "2px solid #f5b400");
    });

    chrome.runtime.sendMessage({
      type: "pickerResult",
      ok: true,
      count: items.length,
      sampleTitle,
      areas,
      frameUrl: location.href,       // iframe 안에서 골랐으면 iframe 의 주소가 게시판 주소가 됩니다.
      titles: items.map((it) => it.title),
    });
  }

  const BLOCKED = ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"];
  function listen(on) {
    const fn = on ? "addEventListener" : "removeEventListener";
    window[fn]("mouseover", onOver, true);
    window[fn]("click", onClick, true);
    BLOCKED.forEach((type) => window[fn](type, block, true));
  }

  function stop(keepBar) {
    mode = "off";
    listen(false);
    clearPaint();
    document.querySelectorAll("*").forEach((el) => { if (el.__ntMarked) delete el.__ntMarked; });
    if (!keepBar) removeBar();
  }

  // ---------- 막대 화면 단계 ----------
  function showResult(r) {
    if (!r.ok) {
      setBar("목록을 찾지 못했습니다.", "공지 제목 글자 위를 다시 클릭해 주세요.", [cancelButton]);
      return;
    }
    const preview = r.titles.slice(0, 5).map((t) => "- " + t).join("\n") + (r.titles.length > 5 ? `\n외 ${r.titles.length - 5}개` : "");
    setBar(`제목 ${r.count}개를 찾았습니다. 노란 테두리를 확인하세요.`, preview, [
      { label: "저장", primary: true, onClick: save },
      { label: "빠진 제목 추가", onClick: () => broadcast({ type: "pickerMode", mode: "add" }) },
      { label: "다시 고르기", onClick: () => broadcast({ type: "pickerReset" }) },
      cancelButton,
    ]);
  }

  async function save() {
    setBar("글 주소를 확인하고 있습니다.", "10초 정도 걸립니다. 확인을 위해 뒤에서 탭이 잠깐 열렸다 닫힙니다.", []);
    const res = await chrome.runtime.sendMessage({ type: "pickerSave" });
    if (!res || !res.ok) {
      setBar("저장하지 못했습니다.", (res && res.error) || "알 수 없는 오류", [
        { label: "다시 시도", primary: true, onClick: save },
        cancelButton,
      ]);
      return;
    }
    const how = {
      href: "제목 링크 주소", get: "클릭하면 이동하는 주소", post: "폼 전송을 주소로 바꿈",
      newtab: "새 창 주소", state: "주소만 바뀌는 화면",
    }[res.observed] || "";
    const linkLine = res.mode === "list"
      ? "글 주소: 만들 수 없어 게시판 목록 주소로 연결합니다." + (res.note ? "\n(" + res.note + ")" : "")
      : `글 주소: 확인됨 (${how})`;
    broadcast({ type: "pickerStop", keepBar: true });
    setBar(`"${res.siteName}" 게시판을 저장했습니다.`, `제목 ${res.count}개\n${linkLine}`, [
      { label: "닫기", primary: true, onClick: () => removeBar() },
    ]);
  }

  // ---------- 명령 받기 ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "pickerUpdate" && isTop) {
      if (msg.ok === false) showResult({ ok: false });
      else showResult(msg);
    } else if (msg.type === "pickerMode") {
      mode = msg.mode;
      if (isTop) setBar("빠진 제목(예: 고정공지)을 하나 클릭하세요.", "", [cancelButton]);
    } else if (msg.type === "pickerReset") {
      mode = "pick";
      areas = [];
      sampleTitle = null;
      clearPaint();
      document.querySelectorAll("*").forEach((el) => { if (el.__ntMarked) delete el.__ntMarked; });
      showStart();
    } else if (msg.type === "pickerStop") {
      stop(msg.keepBar && isTop);
    }
  });

  // ---------- 시작 ----------
  function start() {
    mode = "pick";
    areas = [];
    sampleTitle = null;
    listen(false);
    listen(true);
    showStart();
  }
  window.__ntPicker = { restart: start };
  start();
})();
