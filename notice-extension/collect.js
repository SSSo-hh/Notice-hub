// collect.js
// ⑧단계 1차 빠른 수집 + ⑨단계 2차 탭 수집: 게시판 주소를 탭 없이 받아(fetch) 저장한 규칙으로 공지 제목과 주소를 꺼냅니다.
// 아직 DB에 저장하지 않고 결과만 돌려줍니다. (저장은 ⑩단계)
// 1차에서 0건이면 목록을 자바스크립트로 그리는 사이트일 수 있어 ⑨단계 2차(실제 탭)로 넘깁니다.
// background.js 에서 importScripts 로 불러옵니다. (fetchText 는 linkfinder.js 에 있음)

// 보이지 않는 문서(offscreen.html)가 없으면 만듭니다. 확장 하나에 하나만 둘 수 있습니다.
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const exists = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (exists.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "게시판 HTML에서 공지 제목과 주소를 읽기 위해",
    });
  } catch (e) {
    // 동시에 두 번 만들려고 하면 나는 오류는 무시합니다.
    if (!String(e.message || e).includes("single offscreen")) throw e;
  }
}

async function parseInOffscreen(html, rule, baseUrl) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", type: "parse", html, rule, baseUrl });
}

// 게시판 하나를 1차로 수집합니다.
// 돌려주는 값: { id, name, ok, count, items, stage: "fetch", needTab, error }
async function collectFirst(site) {
  const result = { id: site.id, name: site.name, stage: "fetch", ok: false, count: 0, items: [], needTab: false, error: null };
  try {
    const res = await withTimeout(fetchText(site.board_url), 15000);
    if (res.status >= 400) {
      result.error = "접속 거부 (" + res.status + ")";
      return result;
    }
    const parsed = await parseInOffscreen(res.text, site.rule, res.url || site.board_url);
    if (!parsed || parsed.error) {
      result.error = "목록 읽기 실패: " + (parsed ? parsed.error : "응답 없음");
      return result;
    }
    result.items = parsed.items;
    result.count = parsed.items.length;
    if (result.count === 0) {
      // 0건: 목록을 자바스크립트로 그리거나, 로그인이 풀렸거나, 사이트 구조가 바뀐 경우
      result.needTab = true;
      result.error = parsed.hasPassword ? "로그인 필요할 수 있음 (비밀번호 입력칸이 보임)" : "1차 0건 (2차 탭 수집 필요)";
      return result;
    }
    result.ok = true;
  } catch (e) {
    result.error = String(e.message || e);
    result.needTab = true;
  }
  return result;
}

// ---------- ⑨ 2차 수집: 실제 탭 ----------
// 1차에서 0건이거나 받아 오기에 실패한 게시판만, 최소화한 창의 탭에서 실제로 열어 읽습니다.
// (목록을 자바스크립트로 그리는 사이트, 열 때 로그인 연결(SSO)을 거치는 사이트)
let collectWindowId = null;

async function getCollectWindow() {
  if (collectWindowId !== null) {
    try { await chrome.windows.get(collectWindowId); return collectWindowId; } catch (e) { collectWindowId = null; }
  }
  // 최소화한 창을 하나 만들어 그 안에서만 탭을 엽니다. (사용자가 보는 창의 탭 줄을 건드리지 않음)
  const win = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
  collectWindowId = win.id;
  return collectWindowId;
}

async function closeCollectWindow() {
  if (collectWindowId === null) return;
  try { await chrome.windows.remove(collectWindowId); } catch (e) { /* 이미 닫힘 */ }
  collectWindowId = null;
}

// 게시판 하나를 탭에서 읽습니다. 목록이 나타날 때까지 최대 10초 기다립니다.
async function collectByTab(site) {
  const result = { id: site.id, name: site.name, stage: "tab", ok: false, count: 0, items: [], needTab: false, error: null };
  let tabId = null;
  try {
    const windowId = await getCollectWindow();
    const tab = await chrome.tabs.create({ windowId, url: site.board_url, active: false });
    tabId = tab.id;
    await waitTabComplete(tabId);
    const until = Date.now() + 10000;
    let last = null;
    while (Date.now() < until) {
      last = await runInTab(tabId, (rule, base) => ({
        items: self.NoticeRules.applyRule(document, rule, location.href || base),
        hasPassword: !!document.querySelector('input[type="password"]'),
      }), [site.rule, site.board_url]).catch(() => null);
      if (last && last.items.length) break;
      await sleep(700);
    }
    if (last && last.items.length) {
      result.ok = true;
      result.items = last.items;
      result.count = last.items.length;
    } else {
      result.error = last && last.hasPassword ? "로그인 필요 (탭에서도 비밀번호 입력칸이 보임)" : "탭에서도 0건 (구조 변경 또는 로그인 확인 필요)";
    }
  } catch (e) {
    result.error = "탭 수집 실패: " + String(e.message || e);
  } finally {
    if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
  }
  return result;
}

// ---------- 여러 페이지 읽기 (처음 수집, 옛 공지 가져오기) ----------
// 실제 탭에서 2 ~ pages 페이지를 차례로 엽니다. 페이지 번호 줄이 있으면 번호를 누르고,
// 없으면 아래로 내려 더 불러오는 목록(무한 스크롤)으로 보고 맨 아래로 내립니다.
// 돌려주는 값: { items: 2페이지부터 새로 나온 공지, pages: 실제로 읽은 페이지 수, how: "pager" | "scroll" | "none" }
async function collectMorePages(site, pages) {
  const first = await readPages(site, pages, false);
  // 아래로 내리는 게시판이 최소화한 창에서 안 넘어가면, 작은 창을 잠깐 띄워 다시 시도합니다.
  // (화면에 보여야 다음 목록을 불러오는 사이트가 있음)
  if (first.how === "scroll" && first.pages === 1) {
    const again = await readPages(site, pages, true);
    if (again.pages > 1) { again.how = "scroll-visible"; return again; }
  }
  return first;
}

async function readPages(site, pages, visible) {
  const out = { items: [], pages: 1, how: "none" };
  if (pages <= 1) return out;
  let tabId = null;
  let ownWindow = null;
  const readItems = () => runInTab(tabId, (rule) => self.NoticeRules.applyRule(document, rule, location.href), [site.rule]).catch(() => null);
  try {
    if (visible) {
      // 앞에 보이는 창이어야 하므로 잠깐 앞으로 띄웁니다 (끝나면 바로 닫음)
      const win = await chrome.windows.create({ url: site.board_url, state: "normal", focused: true, width: 520, height: 720 });
      ownWindow = win.id;
      tabId = win.tabs[0].id;
    } else {
      const windowId = await getCollectWindow();
      const tab = await chrome.tabs.create({ windowId, url: site.board_url, active: false });
      tabId = tab.id;
    }
    await waitTabComplete(tabId);

    // 첫 페이지 목록이 나타날 때까지 (최대 10초)
    let prev = null;
    for (let i = 0; i < 15 && !(prev && prev.length); i++) { prev = await readItems(); if (!(prev && prev.length)) await sleep(700); }
    if (!prev || !prev.length) return out;
    const seen = new Set(prev.map((it) => it.link));

    const hasPager = await runInTab(tabId, (areas) => !!self.NoticeRules.findPager(document, areas), [site.rule.areas]).catch(() => false);
    out.how = hasPager ? "pager" : "scroll";

    for (let p = 2; p <= pages; p++) {
      const sig = prev.map((it) => it.link).join("|");
      let moved;
      if (hasPager) {
        // 번호 누르기는 페이지 자체 환경(MAIN)에서 합니다. "javascript:함수()" 주소로 된 번호는
        // 확장 쪽(ISOLATED)에서 누르면 크롬 보안 규칙으로 막힙니다.
        moved = await runInTab(tabId, (areas, p) => self.NoticeRules.clickPage(document, areas, p), [site.rule.areas, p], "MAIN").catch(() => false);
      } else {
        // 맨 아래로 바로 이동(부드러운 스크롤 무시) + 마지막 줄을 화면에 보이게
        moved = await runInTab(tabId, (areas) => {
          const items = self.NoticeRules.findItems(document, areas);
          if (items.length) items[items.length - 1].row.scrollIntoView({ block: "end", behavior: "instant" });
          const se = document.scrollingElement || document.documentElement;
          se.scrollTop = se.scrollHeight;
          window.scrollTo({ top: se.scrollHeight, behavior: "instant" });
          return true;
        }, [site.rule.areas]).catch(() => false);
      }
      if (!moved) break;
      // 목록이 바뀔 때까지 기다립니다. 번호를 누르면 페이지가 새로 열리기도 하고(무거운 사이트는 10초 넘게 걸림),
      // 그 자리에서 바뀌기도 합니다. 페이지가 열리는 중이면 최대 25초, 아니면 8초까지 봅니다.
      let now = null;
      const start = Date.now();
      while (true) {
        await sleep(500);
        const t = await chrome.tabs.get(tabId).catch(() => null);
        const loading = t && t.status === "loading";
        now = loading ? null : await readItems();
        if (now && now.length && now.map((it) => it.link).join("|") !== sig) break;
        now = null;
        const waited = Date.now() - start;
        if (waited > 25000 || (!loading && waited > 8000)) break;
      }
      if (!now) break; // 더 넘어가지 않음 (마지막 페이지)
      now.forEach((it) => { if (!seen.has(it.link)) { seen.add(it.link); out.items.push(it); } });
      out.pages = p;
      prev = now;
    }
  } catch (e) {
    console.warn("[여러 페이지] " + site.name + ": " + (e.message || e));
  } finally {
    if (ownWindow !== null) chrome.windows.remove(ownWindow).catch(() => {});
    else if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
  }
  return out;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과 (" + ms / 1000 + "초)")), ms))]);
}

// 규칙이 있는 게시판 전체를 1차로 수집해 결과 목록을 돌려줍니다. (동시에 3곳씩)
// sitesOut: 읽은 게시판 정보(키워드, seen_links)를 저장 단계에서 다시 쓰려고 넘겨받는 배열
async function previewCollect(sitesOut) {
  const { data: sites, error } = await db
    .from("sites")
    .select("id, name, board_url, rule, last_status, keywords, seen_links, last_collected_at, folder_id")
    .neq("last_status", "norule")
    .not("rule", "is", null)
    .order("id");
  if (error) throw error;
  if (sitesOut) sitesOut.push(...sites);

  const results = [];
  const queue = sites.slice();
  async function worker() {
    while (queue.length) {
      const site = queue.shift();
      const r = await collectFirst(site);
      results.push(r);
      console.log(`[1차] ${r.name}: ${r.ok ? r.count + "건" : r.error}`, r.items.slice(0, 3));
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  // 1차에서 못 읽은 곳은 탭으로 한 곳씩 다시 읽습니다.
  const retry = results.filter((r) => r.needTab);
  try {
    for (const first of retry) {
      const site = sites.find((x) => x.id === first.id);
      const r = await collectByTab(site);
      r.firstError = first.error; // 1차에서 왜 넘어왔는지
      results[results.indexOf(first)] = r;
      console.log(`[2차] ${r.name}: ${r.ok ? r.count + "건" : r.error}`, r.items.slice(0, 3));
    }
  } finally {
    await closeCollectWindow();
  }
  results.sort((a, b) => a.id - b.id);
  return results;
}

// ---------- ⑩ 새 공지만 저장 ----------
const SEEN_MAX = 300; // 게시판마다 기억하는 최근 링크 수

// 새 글 판단용 비교 열쇠
// 날짜 값이 있어야 글이 열리는 게시판(noDrop)은 저장 주소에 날짜가 붙어 날마다 바뀝니다.
// 제목 고르기 때 그 게시판에서 실제로 확인한 칸(rule.link.volatile)만 빼고 비교합니다. (다른 게시판은 주소 그대로)
function seenKey(link, rule) {
  const names = (rule && rule.link && rule.link.volatile) || [];
  if (!names.length) return link;
  try {
    const u = new URL(link);
    names.forEach((k) => u.searchParams.delete(k));
    return u.href;
  } catch (e) {
    return link;
  }
}

// 공지 한 줄: 게시판을 지워도 공지가 남도록 폴더와 게시판 이름도 함께 저장합니다.
function noticeRow(site, it) {
  return { site_id: site.id, folder_id: site.folder_id, site_name: site.name, title: it.title, link: it.link };
}

// 키워드가 있으면 제목에 하나라도 들어간 공지만 (영문은 대소문자 무시)
function matchKeywords(title, keywords) {
  const list = (keywords || []).map((k) => k.trim()).filter(Boolean);
  if (!list.length) return true;
  const t = title.toLowerCase();
  return list.some((k) => t.includes(k.toLowerCase()));
}

// 게시판 하나의 수집 결과를 DB에 반영합니다.
async function saveResult(site, r) {
  const now = new Date().toISOString();
  const update = { last_collected_at: now, last_found: r.count, last_error: r.ok ? null : r.error };
  if (!r.ok) {
    // 0건이나 오류: "확인 필요". seen_links 는 그대로 둠 (다음에 정상으로 돌아오면 이어서 비교)
    update.last_status = "check";
    update.last_saved = 0;
    const { error } = await db.from("sites").update(update).eq("id", site.id);
    if (error) throw error;
    return 0;
  }

  const seen = Array.isArray(site.seen_links) ? site.seen_links : [];
  const seenSet = new Set(seen);
  const firstTime = !site.last_collected_at && seen.length === 0; // 처음 수집: 첫 페이지 공지를 모두 새 공지로
  const fresh = r.items.filter((it) => firstTime || !seenSet.has(seenKey(it.link, site.rule)));
  const toSave = fresh.filter((it) => matchKeywords(it.title, site.keywords));

  let saved = 0;
  if (toSave.length) {
    // 같은 링크가 이미 있으면 건너뜀 (user_id + link 중복 금지)
    const rows = toSave.map((it) => noticeRow(site, it));
    const { data, error } = await db.from("notices")
      .upsert(rows, { onConflict: "user_id,link", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    saved = data ? data.length : 0;
  }

  // 이번에 본 링크를 앞에 두고, 최근 300개만 기억
  const nowKeys = r.items.map((it) => seenKey(it.link, site.rule));
  const merged = [...new Set([...nowKeys, ...seen])].slice(0, SEEN_MAX);
  Object.assign(update, { last_status: "ok", last_saved: saved, seen_links: merged });
  const { error } = await db.from("sites").update(update).eq("id", site.id);
  if (error) throw error;
  return saved;
}

// 전체 수집: 1차, 2차로 읽은 뒤 새 공지만 저장하고 수집 시각을 남깁니다.
let collecting = false;
async function collectAndSave() {
  if (collecting) return { ok: false, error: "이미 수집 중입니다." };
  collecting = true;
  try {
    const sites = [];
    const results = await previewCollect(sites);
    const pages = await getPageSetting();
    for (const r of results) {
      const site = sites.find((x) => x.id === r.id);
      // 처음 수집하는 게시판은 설정한 페이지 수만큼 옛 공지도 함께 읽습니다.
      const firstTime = !site.last_collected_at && !(site.seen_links || []).length;
      if (r.ok && firstTime && pages > 1) {
        const more = await collectMorePages(site, pages);
        r.items = r.items.concat(more.items);
        r.count = r.items.length;
        r.pagesRead = more.pages;
      }
      try {
        r.saved = await saveResult(site, r);
      } catch (e) {
        r.saved = 0;
        r.saveError = String(e.message || e);
      }
      console.log(`[저장] ${r.name}: 찾음 ${r.count}, 새로 저장 ${r.saved}${r.saveError ? " (저장 오류 " + r.saveError + ")" : ""}`);
    }
    await closeCollectWindow();
    // 마지막 수집 시각 (collector 는 한 줄)
    const now = new Date().toISOString();
    const { data } = await db.from("collector").select("id").limit(1);
    if (data && data.length) await db.from("collector").update({ last_collect: now }).eq("id", data[0].id);
    else await db.from("collector").insert({ last_collect: now });
    return { ok: true, results, at: now };
  } finally {
    collecting = false;
  }
}

// 처음 수집, 옛 공지 가져오기에서 읽을 페이지 수 (팝업에서 고름, 기본 5)
async function getPageSetting() {
  const { firstPages } = await chrome.storage.local.get("firstPages");
  return Number(firstPages) || 5;
}

// 고른 게시판만 수집합니다.
//  mode "new": 규칙을 막 저장한 게시판. 첫 페이지(1차, 안 되면 2차 탭) + 설정한 페이지 수만큼 옛 페이지까지 읽어 저장
//  mode "old": 옛 공지 가져오기. 2 ~ pages 페이지를 읽어, 아직 못 본 공지만 저장 (이미 저장한 공지, 사용자가 지운 공지는 다시 넣지 않음)
async function collectSites(siteIds, mode, pagesArg) {
  if (collecting) return { ok: false, error: "이미 수집 중입니다." };
  collecting = true;
  try {
    const pages = pagesArg || (await getPageSetting());
    const { data: sites, error } = await db
      .from("sites")
      .select("id, name, board_url, rule, keywords, seen_links, last_collected_at, folder_id, last_status")
      .in("id", siteIds);
    if (error) throw error;
    const results = [];
    for (const site of sites) {
      if (!site.rule) continue;
      if (mode === "new") {
        let r = await collectFirst(site);
        if (r.needTab) { const first = r; r = await collectByTab(site); r.firstError = first.error; }
        if (r.ok && pages > 1) {
          const more = await collectMorePages(site, pages);
          r.items = r.items.concat(more.items);
          r.count = r.items.length;
          r.pagesRead = more.pages;
        }
        try { r.saved = await saveResult(site, r); } catch (e) { r.saved = 0; r.saveError = String(e.message || e); }
        console.log(`[새 게시판] ${r.name}: 찾음 ${r.count}, 저장 ${r.saved}`);
        results.push(r);
        continue;
      }
      // mode "old"
      const r = { id: site.id, name: site.name, ok: true, count: 0, saved: 0, items: [], pagesRead: 1 };
      if (site.rule.link && site.rule.link.mode === "list") { r.ok = false; r.error = "글 주소가 없는 게시판이라 건너뜀"; results.push(r); continue; }
      const more = await collectMorePages(site, pages);
      r.pagesRead = more.pages;
      r.items = more.items;
      r.count = more.items.length;
      if (more.pages <= 1) { r.ok = false; r.error = more.how === "none" ? "목록을 읽지 못함" : "다음 페이지로 넘어가지 않음 (" + (more.how === "pager" ? "페이지 번호" : "아래로 내리기") + ")"; }
      try {
        const seen = Array.isArray(site.seen_links) ? site.seen_links : [];
        const seenSet = new Set(seen);
        const fresh = more.items.filter((it) => !seenSet.has(seenKey(it.link, site.rule)));
        const toSave = fresh.filter((it) => matchKeywords(it.title, site.keywords));
        if (toSave.length) {
          const rows = toSave.map((it) => noticeRow(site, it));
          const { data, error: e1 } = await db.from("notices").upsert(rows, { onConflict: "user_id,link", ignoreDuplicates: true }).select("id");
          if (e1) throw e1;
          r.saved = data ? data.length : 0;
        }
        // 옛 공지 링크는 기억 목록 뒤쪽에 붙입니다 (최근 링크가 앞, 최대 300개)
        const merged = [...new Set([...seen, ...fresh.map((it) => seenKey(it.link, site.rule))])].slice(0, SEEN_MAX);
        const { error: e2 } = await db.from("sites").update({ seen_links: merged }).eq("id", site.id);
        if (e2) throw e2;
      } catch (e) {
        r.saveError = String(e.message || e);
      }
      console.log(`[옛 공지] ${r.name}: ${r.pagesRead}페이지까지, 찾음 ${r.count}, 저장 ${r.saved}`);
      results.push(r);
    }
    await closeCollectWindow();
    return { ok: true, results };
  } finally {
    collecting = false;
  }
}
