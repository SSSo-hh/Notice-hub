// linkfinder.js
// ⑦-2: 글 주소를 만드는 방법을 찾아 검증합니다. (background.js 가 importScripts 로 불러 씀)
//
// 하는 일
// 1. 뒤에서 게시판을 탭으로 엽니다. (사용자 화면은 그대로)
// 2. 제목 링크가 실제 주소면 그 주소 모양을 쓰고, 그 주소로 글이 열리는지 확인합니다.
// 3. 아니면 사용자가 고른 제목을 대신 눌러 보고, 브라우저가 한 일(주소 이동, 새 창, POST 전송, 주소만 바뀜)을 관찰합니다.
// 4. 관찰한 주소 안의 값 중 그 줄의 속성(onclick 등)에도 들어 있는 값을 "글 번호"로 보고 주소 틀을 만듭니다.
// 5. 주소 틀로 글이 실제로 열리는지(고른 제목이 보이는지) 확인합니다. 실패하면 목록 주소 방식으로 둡니다.

// ---------- 공용 도우미 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 탭이 다 열릴 때까지 기다립니다. (최대 timeout 밀리초)
function waitTabComplete(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") finish(true); };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(true); }).catch(() => finish(false));
    setTimeout(() => finish(false), timeout);
  });
}

// 탭을 다른 주소로 옮기고 새 페이지 로딩이 끝날 때까지 기다립니다.
// (옮기자마자 상태를 보면 이전 페이지의 "complete" 가 보일 수 있어, "loading" 을 본 뒤의 "complete" 를 기다립니다.
//  주소의 # 뒷부분만 바뀌어 로딩이 일어나지 않으면 3초 뒤 그대로 진행합니다.)
function navigateTab(tabId, url, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false, loading = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") loading = true;
      if (info.status === "complete" && loading) finish(true);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch(() => finish(false));
    setTimeout(() => { if (!loading) finish(true); }, 3000);
    setTimeout(() => finish(false), timeout);
  });
}

// 탭 안에서 함수를 실행하고 결과를 받습니다. 먼저 rules.js 를 넣어 NoticeRules 를 쓸 수 있게 합니다.
async function runInTab(tabId, func, args = [], world = "ISOLATED") {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["rules.js"], world });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  return res ? res.result : null;
}

// 주소의 글을 받아 글자로 돌려줍니다. 옛 한국 사이트의 EUC-KR 글자도 깨지지 않게 문자셋을 읽어 변환합니다.
async function fetchText(url) {
  const res = await fetch(url, { credentials: "include", redirect: "follow" });
  const buf = await res.arrayBuffer();
  let charset = ((res.headers.get("content-type") || "").match(/charset=([^;]+)/i) || [])[1];
  if (!charset) {
    // 응답 헤더에 없으면 HTML 앞부분의 <meta charset> 을 봅니다.
    const head = new TextDecoder("ascii").decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  let text;
  try { text = new TextDecoder((charset || "utf-8").trim().toLowerCase()).decode(buf); }
  catch (e) { text = new TextDecoder("utf-8").decode(buf); }
  return { status: res.status, url: res.url, text };
}

// 비교용 글자 정리: 태그와 공백을 지우고, 자주 쓰는 HTML 기호를 글자로 바꿉니다.
function plainKey(text) {
  return (text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, "");
}

// 목록에 보이는 제목은 "..." 로 잘려 있을 수 있어 앞부분(최대 20자)만 비교합니다.
function titleKey(title) {
  return plainKey(title).replace(/(\.\.\.|…)+$/, "").slice(0, 20);
}

// 제목 조각 여러 개(앞, 가운데, 뒤). 목록에서만 붙는 말머리("추천", "NEW")나 꼬리(댓글 수)가 있어도 글 화면에서 찾을 수 있게 합니다.
function titleKeys(title) {
  const t = plainKey(title).replace(/(\.\.\.|…)+$/, "");
  // 조각 길이: 12자 이하 제목은 전체, 그보다 길면 제목의 70% (최대 20자)
  const w = t.length <= 12 ? t.length : Math.min(20, Math.ceil(t.length * 0.7));
  const mid = Math.floor((t.length - w) / 2);
  return [...new Set([t.slice(0, w), t.slice(mid, mid + w), t.slice(-w)])];
}
function hasTitle(page, title) {
  return titleKeys(title).some((k) => page.includes(k));
}

// 글 화면이 맞는지 판단: 고른 제목이 있고, 다른 제목들은 대부분 없어야 합니다.
function looksLikePost(pageText, sampleTitle, otherTitles) {
  const page = plainKey(pageText);
  if (!hasTitle(page, sampleTitle)) return false;
  const others = otherTitles.filter((t) => plainKey(t).length >= 4);
  const seen = others.filter((t) => hasTitle(page, t)).length;
  return !(others.length >= 3 && seen >= Math.max(3, Math.ceil(others.length / 2)));
}

// 주소로 글이 열리는지 확인합니다. 먼저 빠르게 받아 보고(fetch), 안 되면 탭으로 열어 화면이 그려진 뒤 확인합니다.
async function verifyLink(url, sampleTitle, otherTitles, tabId) {
  try {
    const r = await fetchText(url);
    if (r.status < 400 && looksLikePost(r.text, sampleTitle, otherTitles)) return "fetch";
  } catch (e) { /* 받아 오기 실패: 탭으로 확인 */ }
  try {
    await navigateTab(tabId, url);
    // 글 내용을 JS 로 늦게 그리는 사이트를 위해 최대 5초 동안 확인을 반복합니다.
    for (let i = 0; i < 10; i++) {
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        });
        if (res && looksLikePost(res.result, sampleTitle, otherTitles)) return "tab";
      } catch (e) { /* 페이지가 바뀌는 중이면 잠시 뒤 다시 */ }
      await sleep(500);
    }
  } catch (e) { /* 탭 확인도 실패 */ }
  return null;
}

// ---------- 관찰 ----------

// 탭에서 사용자가 고른 제목을 대신 눌러 보고, 그 뒤 4초 동안 일어난 일을 모읍니다.
async function observeClick(tabId, areas, sampleTitle) {
  const seen = { requests: [], newTabUrls: [], stateUrls: [], opened: null, before: null };

  // (1) 화면 이동 요청 (GET, POST 모두). POST 는 보낸 폼 칸(formData)까지 기록
  const onRequest = (d) => {
    if (d.tabId !== tabId || d.type !== "main_frame") return;
    seen.requests.push({ url: d.url, method: d.method, formData: d.requestBody && d.requestBody.formData });
  };
  // (2) 새 탭, 새 창이 열림
  const newTabs = new Set();
  const onCreated = (t) => { if (t.openerTabId === tabId) newTabs.add(t.id); };
  const onUpdated = (id, info) => {
    if (newTabs.has(id) && info.url && info.url !== "about:blank") seen.newTabUrls.push(info.url);
  };
  // (3) 페이지는 그대로인데 주소만 바뀜 (앱형 사이트, #/view/123)
  const onState = (d) => { if (d.tabId === tabId && d.frameId === 0) seen.stateUrls.push(d.url); };

  chrome.webRequest.onBeforeRequest.addListener(onRequest, { urls: ["<all_urls>"], tabId }, ["requestBody"]);
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onState);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(onState);

  try {
    // 페이지 안(MAIN)에서 window.open 을 잠시 바꿔, 새 창 주소를 기록합니다.
    // (확장이 대신 누르면 크롬 팝업 차단 때문에 새 창이 안 열릴 수 있어서, 열려던 주소를 직접 받습니다)
    const result = await runInTab(tabId, (areas, sampleTitle) => {
      const R = self.NoticeRules;
      const item = R.findSample(R.findItems(document, areas), sampleTitle);
      if (!item) return { error: "고른 제목을 뒤 탭에서 찾지 못했습니다." };
      window.__ntOpened = null;
      window.open = (url) => { window.__ntOpened = url ? new URL(url, location.href).href : null; return null; };
      const before = location.href;
      // 제목 요소가 링크나 처리기가 아니면 안쪽의 링크(처리기)를 누릅니다. 없으면 제목 요소를 눌러 줄의 처리기로 전달되게 합니다.
      const t = item.titleEl;
      const target = t.matches("a, [onclick]") ? t : (t.querySelector("a, [onclick]") || t);
      setTimeout(() => target.click(), 0);
      return { before };
    }, [areas, sampleTitle], "MAIN");
    if (result && result.error) return { error: result.error };
    seen.before = result && result.before;

    await sleep(4000);

    // 페이지가 그대로라면 window.open 으로 열려던 주소를 꺼냅니다.
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__ntOpened, world: "MAIN" });
      seen.opened = res && res.result;
    } catch (e) { /* 다른 페이지로 넘어갔으면 실패해도 됨 */ }
  } finally {
    chrome.webRequest.onBeforeRequest.removeListener(onRequest);
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.webNavigation.onHistoryStateUpdated.removeListener(onState);
    chrome.webNavigation.onReferenceFragmentUpdated.removeListener(onState);
    newTabs.forEach((id) => chrome.tabs.remove(id).catch(() => {}));
  }

  // 관찰 결과 하나로 정리 (우선순위: 화면 이동 요청 > 새 창 > 주소만 바뀜)
  const req = seen.requests.find((r) => r.url !== seen.before) || seen.requests[0];
  if (req && req.method === "POST") return { kind: "post", url: req.url, formData: req.formData || {} };
  if (req) return { kind: "get", url: req.url };
  if (seen.opened) return { kind: "newtab", url: seen.opened };
  if (seen.newTabUrls.length) return { kind: "newtab", url: seen.newTabUrls[0] };
  const state = seen.stateUrls.find((u) => u !== seen.before);
  if (state) return { kind: "state", url: state };
  return { kind: "none" };
}

// 관찰한 주소에서 "글 번호 후보" 값들을 뽑습니다. 각 후보는 주소 틀 만드는 방법을 함께 가집니다.
// 숫자로 된 값, 긴 값을 먼저 시도합니다.
function idCandidates(observed) {
  const list = [];
  const add = (value, makeTemplate) => {
    if (value && value.length >= 1 && value.length <= 80) list.push({ value, makeTemplate });
  };
  const u = new URL(observed.url);
  if (observed.kind === "post") {
    // POST 로 보낸 폼 칸을 주소 뒤에 붙여 GET 주소 틀을 만듭니다.
    const fields = Object.entries(observed.formData).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
    fields.forEach(([key, value]) => add(value, () => {
      const t = new URL(u.href);
      fields.forEach(([k, v]) => t.searchParams.set(k, k === key ? "__NTID__" : v));
      return t.href.replace("__NTID__", "{id}");
    }));
  } else {
    u.searchParams.forEach((value, key) => add(value, () => {
      const t = new URL(u.href);
      t.searchParams.set(key, "__NTID__");
      return t.href.replace("__NTID__", "{id}");
    }));
    // 주소 경로 조각 (/post/123) 과 해시 조각 (#/view/123)
    u.pathname.split("/").forEach((seg, i, all) => add(decodeURIComponent(seg), () => {
      const parts = all.slice();
      parts[i] = "{id}";
      return u.origin + parts.join("/") + u.search + u.hash;
    }));
    u.hash.replace(/^#/, "").split(/[/?&=]/).forEach((seg) => add(seg, () =>
      u.origin + u.pathname + u.search + u.hash.replace(seg, "{id}")));
  }
  const score = (c) => (/^\d+$/.test(c.value) ? 1000 : 0) + c.value.length;
  return list
    .filter((c, i) => list.findIndex((d) => d.value === c.value) === i)
    .sort((a, b) => score(b) - score(a));
}

// ---------- 전체 흐름 ----------

// boardUrl: 게시판 주소, areas: 고르기에서 만든 목록 영역, sampleTitle: 사용자가 고른 제목
// 돌려주는 값: { link: 규칙의 link 부분, verified: true/false, via, observed, count, note }
// 페이지 로딩이 끝난 뒤에도 목록을 자바스크립트로 늦게 채우는 사이트가 있어,
// 고른 제목이 나타날 때까지 최대 10초 기다립니다.
async function waitListReady(tabId, areas, sampleTitle, maxMs = 10000) {
  await waitTabComplete(tabId);
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const found = await runInTab(tabId, (areas, sampleTitle) =>
      !!self.NoticeRules.findSample(self.NoticeRules.findItems(document, areas), sampleTitle), [areas, sampleTitle]).catch(() => false);
    if (found) return true;
    await sleep(500);
  }
  return false;
}

async function findLinkRule(boardUrl, areas, sampleTitle) {
  const tab = await chrome.tabs.create({ url: boardUrl, active: false });
  const tabId = tab.id;
  try {
    await waitListReady(tabId, areas, sampleTitle);

    // 1. 목록 다시 확인 + 제목 링크가 실제 주소인지
    const info = await runInTab(tabId, (areas, sampleTitle, base) => {
      const R = self.NoticeRules;
      const items = R.findItems(document, areas);
      const sample = R.findSample(items, sampleTitle);
      if (!sample) return { error: "고른 제목을 뒤 탭에서 찾지 못했습니다.", count: items.length };
      const titles = items.map((it) => it.title);
      const withDrop = R.deriveHrefRule(items, sample, base);
      const noDrop = withDrop && withDrop.drop.length ? R.deriveHrefRule(items, sample, base, { noDrop: true }) : null;
      return {
        count: items.length,
        titles,
        hrefRule: withDrop,
        hrefRuleNoDrop: noDrop,
        sampleLink: withDrop ? R.linkOf(sample, withDrop, base) : null,
        sampleLinkNoDrop: noDrop ? R.linkOf(sample, noDrop, base) : null,
        sampleTitle: sample.title, // 지금 화면의 제목 (조회수 등 숫자가 바뀌었을 수 있음)
      };
    }, [areas, sampleTitle, boardUrl]);
    if (!info || info.error) return { link: { mode: "list" }, verified: false, note: info ? info.error : "목록을 읽지 못했습니다." };
    sampleTitle = info.sampleTitle;
    const others = info.titles.filter((t) => t !== sampleTitle);

    // 2. 실제 주소 방식 (날짜 값을 뺀 주소 먼저, 안 열리면 뺀 값 없이)
    if (info.hrefRule) {
      const via = await verifyLink(info.sampleLink, sampleTitle, others, tabId);
      if (via) return { link: info.hrefRule, verified: true, via, observed: "href", count: info.count };
      if (info.hrefRuleNoDrop) {
        const via2 = await verifyLink(info.sampleLinkNoDrop, sampleTitle, others, tabId);
        if (via2) return { link: info.hrefRuleNoDrop, verified: true, via: via2, observed: "href", count: info.count };
      }
      // 주소가 있어도 안 열리면(자바스크립트로만 열리는 등) 아래에서 클릭을 관찰합니다.
      await navigateTab(tabId, boardUrl);
      await waitListReady(tabId, areas, sampleTitle);
    }

    // 3. 대신 눌러 보고 관찰
    const observed = await observeClick(tabId, areas, sampleTitle);
    if (observed.error || observed.kind === "none") {
      return { link: { mode: "list" }, verified: false, observed: observed.kind || "error", count: info.count,
        note: observed.error || "눌러도 주소가 바뀌지 않아(같은 화면 레이어 등) 목록 주소로 연결합니다." };
    }

    // 4. 관찰한 값 중 줄 속성에도 있는 값 = 글 번호
    await navigateTab(tabId, boardUrl);
    await waitListReady(tabId, areas, sampleTitle);
    const candidates = idCandidates(observed);
    for (const cand of candidates) {
      const source = await runInTab(tabId, (areas, sampleTitle, value) => {
        const R = self.NoticeRules;
        const items = R.findItems(document, areas);
        const sample = R.findSample(items, sampleTitle);
        return sample ? R.deriveIdSource(items, sample, value) : null;
      }, [areas, sampleTitle, cand.value]);
      if (!source) continue;

      const template = cand.makeTemplate();
      const sampleUrl = template.replace("{id}", encodeURIComponent(cand.value));
      // 5. 검증: 만든 주소로 고른 글이 열리는지
      const via = await verifyLink(sampleUrl, sampleTitle, others, tabId);
      if (via) {
        return { link: { mode: "template", source, url: template }, verified: true, via, observed: observed.kind, count: info.count };
      }
      // 이 후보로 만든 주소가 안 열리면 다음 후보를 시도 (탭을 목록으로 되돌림)
      await navigateTab(tabId, boardUrl);
      await waitListReady(tabId, areas, sampleTitle);
    }
    return { link: { mode: "list" }, verified: false, observed: observed.kind, count: info.count,
      note: "글 번호로 주소를 만들었지만 열리지 않아 목록 주소로 연결합니다." };
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}
