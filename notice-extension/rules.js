// rules.js
// 공지 찾기 규칙 엔진입니다. 제목 고르기(picker), 1차 수집(offscreen), 2차 수집(실제 탭)이 모두 이 파일 하나를 씁니다.
// 특정 사이트용 코드는 넣지 않습니다. 사용자가 고른 제목 하나에서 "같은 모양으로 반복되는 줄"을 찾아 규칙을 만듭니다.
//
// 규칙(rule)의 모양
// {
//   areas: [ { container: "목록 영역 선택자", row: "줄 태그", title: "줄 안에서 제목까지의 경로" } ],
//   link:  { mode: "href",     pattern: "주소 모양(정규식)" }                         // 제목 링크가 실제 주소
//        | { mode: "template", source: {...}, url: "https://...{id}..." }              // 줄 속성의 번호로 주소를 만듦
//        | { mode: "list" }                                                            // 주소를 못 만들면 게시판 목록 주소로
// }

(function (global) {
  // ---------- 작은 도우미 ----------

  // 글자 정리: 줄바꿈과 여러 칸 띄어쓰기를 한 칸으로
  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // 정규식 특수문자를 글자 그대로 쓰도록 바꿈 (예: "?" 를 "\?" 로)
  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 오래 버티는 클래스인지 판단합니다.
  // 자동 생성된 이름(css-1x2y3z, 숫자가 많은 이름)이나 상태 표시(on, active, new)는 페이지마다 바뀔 수 있어 쓰지 않습니다.
  const STATE_CLASSES = ["on", "active", "selected", "hover", "focus", "current", "open", "new", "read", "visited", "first", "last", "odd", "even"];
  function isStableClass(name) {
    if (!name) return false;
    if (STATE_CLASSES.includes(name.toLowerCase())) return false;
    if (/\d{3,}/.test(name)) return false;                                   // 숫자가 세 자리 이상 들어간 이름
    if (/^(css|sc|jsx|emotion|svelte|styled|chakra)-/i.test(name)) return false; // CSS-in-JS 자동 이름
    if (/[A-Za-z]/.test(name) && /\d/.test(name) && name.length >= 6 && !/[-_]/.test(name)) return false; // a1b2c3 같은 무작위 이름
    if (/^[A-Za-z]{5,8}$/.test(name) && /[a-z]/.test(name) && (name.match(/[A-Z]/g) || []).length >= 2 && !/^[A-Z]?[a-z]+([A-Z][a-z]+)+$/.test(name)) return false; // bGuPlO 같은 무작위 이름 (camelCase 단어는 제외)
    return true;
  }

  // 요소 하나를 "태그.클래스" 모양 글자로 (예: td.title)
  function stepOf(el, withClasses = true) {
    let step = el.tagName.toLowerCase();
    if (withClasses) {
      const classes = [...el.classList].filter(isStableClass);
      classes.forEach((c) => { step += "." + CSS.escape(c); });
    }
    return step;
  }

  // from 요소에서 to 요소까지 내려가는 경로 (예: "td.title > a"). 같은 요소면 ""
  function relPath(from, to, withClasses = true) {
    const steps = [];
    let el = to;
    while (el && el !== from) {
      steps.unshift(stepOf(el, withClasses));
      el = el.parentElement;
    }
    return el === from ? steps.join(" > ") : null;
  }

  // 줄 안에서 경로로 제목 요소를 찾습니다. 클래스까지 맞는 것이 없으면 태그만으로 한 번 더 찾습니다.
  function findByPath(row, path, loosePath) {
    if (!path) return row;
    try {
      return row.querySelector(":scope > " + path) || (loosePath ? row.querySelector(":scope > " + loosePath) : null);
    } catch (e) {
      return null;
    }
  }

  // ---------- 1. 제목 요소 정하기 ----------

  // 사용자가 클릭한 요소에서 "제목"으로 쓸 요소를 정합니다.
  // 링크(a) 안을 눌렀으면 그 링크, 아니면 누른 요소 자체(예: 표의 제목 칸)
  function resolveTitleElement(target) {
    if (!target) return null;
    const anchor = target.closest("a");
    if (anchor && cleanText(anchor.textContent).length >= 2) {
      // 카드 전체가 링크인 경우(분야, 회사, D-day, 조회수까지 한 링크 안): 안에 제목(h1~h6)이 하나 있으면 그것을 제목으로 씁니다.
      const heads = [...anchor.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => cleanText(h.textContent).length >= 2);
      if (heads.length === 1 && cleanText(anchor.textContent).length > cleanText(heads[0].textContent).length + 5) return heads[0];
      return anchor;
    }
    // 글자가 거의 없는 요소(아이콘 등)를 눌렀으면 글자가 있는 부모로 올라갑니다.
    let el = target;
    while (el && cleanText(el.textContent).length < 2) el = el.parentElement;
    if (!el) return el;
    // 링크 옆 빈 곳이나 링크 앞 표시(예: "주요공지" 배지)를 눌렀을 때:
    // 위로 3단계 안에서 글자 대부분을 차지하는 링크가 하나 있으면 그 링크를 제목으로 씁니다.
    let up = el;
    for (let i = 0; up && i < 3; i++, up = up.parentElement) {
      const total = cleanText(up.textContent).length;
      const links = [...up.querySelectorAll("a")].filter((a) => cleanText(a.textContent).length >= 2);
      if (links.length === 1 && cleanText(links[0].textContent).length >= total * 0.5) return links[0];
      if (links.length > 1) break;
    }
    return el;
  }

  // ---------- 2. 목록 구조 찾기 ----------

  // 제목 요소에서 위로 올라가며, "같은 태그이고 같은 위치에 글자가 있는 형제"가 가장 많은 단계를 줄(row)로 정합니다.
  // 표(tr), 목록(li), 카드(div) 어느 모양이든 태그를 가정하지 않습니다.
  function deriveStructure(titleEl) {
    const doc = titleEl.ownerDocument;
    let best = null;
    let el = titleEl;
    let depth = 0;
    while (el && el.parentElement && el !== doc.body && depth < 8) {
      const parent = el.parentElement;
      const path = relPath(el, titleEl, true);
      const loose = relPath(el, titleEl, false);
      // 같은 태그이고, 같은 경로(클래스까지 같은)에 글자가 있는 형제만 "비슷한 줄"로 봅니다.
      // 경로가 ""(제목 요소 자신)일 때는 형제 자신의 태그와 클래스도 같아야 합니다.
      const similar = [...parent.children].filter((sib) => {
        if (sib === el || sib.tagName !== el.tagName) return false;
        if (!path && stepOf(sib) !== stepOf(el)) return false;
        const t = findByPath(sib, path, null);
        return t && cleanText(t.textContent).length >= 2;
      });
      // 비슷한 형제가 모두 같은 가로줄에 나란히 있으면(표의 칸처럼) 줄이 아니라 칸이므로 건너뜁니다.
      // (화면 위치를 알 수 있을 때만 판단. 카드가 여러 줄로 배치된 경우는 줄로 인정)
      const top = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const sideBySide = top && top.height > 0 && similar.length > 0 &&
        similar.every((sib) => Math.abs(sib.getBoundingClientRect().top - top.top) < 2);
      // 형제가 많을수록 "반복되는 줄"일 가능성이 큽니다. 같은 개수면 위쪽(큰 단위)을 택합니다.
      if (similar.length >= 1 && !sideBySide && (!best || similar.length >= best.count)) {
        best = { row: el, count: similar.length, path, loose };
      }
      el = parent;
      depth++;
    }
    if (!best) return null;

    const container = best.row.parentElement;
    return {
      area: {
        container: selectorFor(container),
        row: best.row.tagName.toLowerCase(),
        title: best.path,
        titleLoose: best.loose,
      },
      sampleRow: best.row,
    };
  }

  // 목록 영역(container)을 다시 찾을 수 있는 선택자를 만듭니다.
  // 오래 버티는 id 가 있으면 id, 없으면 "태그.클래스"를 위로 이어 붙여 페이지 안에서 하나로 좁혀지게 합니다.
  function selectorFor(el) {
    const doc = el.ownerDocument;
    const parts = [];
    let cur = el;
    // "tbody" 처럼 이름표(클래스, id)가 없는 선택자는 나중에 다른 표가 생기면 헷갈리므로,
    // 페이지에서 하나로 좁혀지고 이름표가 하나 이상 들어갈 때까지 위로 올라갑니다.
    for (let i = 0; cur && cur !== doc.documentElement && i < 8; i++) {
      if (cur.id && isStableClass(cur.id) && !/\s/.test(cur.id)) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      parts.unshift(stepOf(cur, true));
      const sel = parts.join(" > ");
      const hasLabel = /[.#]/.test(sel);
      if (hasLabel && doc.querySelectorAll(sel).length === 1) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  // 규칙의 목록 영역들에서 줄과 제목을 모두 찾습니다.
  // 돌려주는 값: [{ row, titleEl, title }]
  function findItems(doc, areas) {
    const items = [];
    const seen = new Set();
    areas.forEach((area) => {
      let containers = [];
      try { containers = [...doc.querySelectorAll(area.container)]; } catch (e) { containers = []; }
      containers.forEach((box) => {
        [...box.children].forEach((row) => {
          if (row.tagName.toLowerCase() !== area.row || seen.has(row)) return;
          const titleEl = findByPath(row, area.title, area.titleLoose);
          if (!titleEl) return;
          const title = cleanText(titleEl.textContent);
          if (title.length < 2) return;
          seen.add(row);
          items.push({ row, titleEl, title });
        });
      });
    });
    return items;
  }

  // 두 번째 클릭(빠진 고정공지 등)으로 찾은 영역을 기존 영역 목록에 더합니다. 같은 영역이면 더하지 않습니다.
  function mergeAreas(areas, area) {
    const same = areas.some((a) => a.container === area.container && a.row === area.row && a.title === area.title);
    return same ? areas : areas.concat([area]);
  }

  // ---------- 3. 글 주소 ----------

  // 주소에 붙는 세션 값(jsessionid 등)을 빼서, 같은 글이 매번 다른 주소로 저장되지 않게 합니다.
  const SESSION_PARAMS = ["jsessionid", "phpsessid", "sessionid", "sid", "aspsessionid"];
  function normalizeLink(url, drop) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/;jsessionid=[^/?#]*/i, "");
      [...u.searchParams.keys()].forEach((key) => {
        if (SESSION_PARAMS.includes(key.toLowerCase()) || (drop && drop.includes(key))) u.searchParams.delete(key);
      });
      u.hash = u.hash === "#" || u.hash === "#none" ? "" : u.hash;
      return u.href;
    } catch (e) {
      return url;
    }
  }

  // 모든 줄의 주소에 똑같이 붙어 있으면서 날짜나 시각처럼 보이는 값(예: 2026/11/13, 1763012345678)을 찾습니다.
  // 이런 값은 다음 날 바뀌어서 같은 글이 새 글로 잡히므로 저장할 주소에서 뺍니다. (⑦-2에서 빼도 글이 열리는지 확인)
  function volatileParams(urls) {
    if (urls.length < 2) return [];
    const first = new URL(urls[0]);
    const drop = [];
    first.searchParams.forEach((value, key) => {
      const allSame = urls.every((x) => new URL(x).searchParams.get(key) === value);
      const looksDate = /^(19|20)\d{2}[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])/.test(value) ||
        /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(value);      // 2026/11/13, 2026-11-13, 20261113
      const looksStamp = /^1\d{9,12}$/.test(value);                              // 1763012345 같은 시각 숫자
      const timeKey = /^(t|ts|time|timestamp|_|rnd|nocache|cachebust)$/i.test(key); // 캐시 방지용 이름
      const looksTime = looksDate || looksStamp || timeKey;
      if (allSame && looksTime) drop.push(key);
    });
    return drop;
  }

  // 제목에 딸린 링크 요소: 제목이 링크면 그것, 아니면 제목 안이나 위의 링크
  function anchorOf(item) {
    return item.titleEl.closest("a") || item.titleEl.querySelector("a");
  }

  // 실제 주소인 href 만 돌려줍니다. (#, #none, javascript: 는 주소가 아님)
  function realHref(anchor, baseUrl) {
    if (!anchor) return null;
    const raw = (anchor.getAttribute("href") || "").trim();
    if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
    try { return new URL(raw, baseUrl).href; } catch (e) { return null; }
  }

  // 주소 모양 만들기
  // 고른 글의 주소와 다른 줄들의 주소를 조각(/, ?, &, = 로 나눈 부분) 단위로 비교해서,
  // 줄마다 달라지는 조각만 "아무 값"으로 바꿉니다. (숫자 번호든 /hello-world 같은 글자든)
  // 비교할 줄이 부족하면 숫자 부분만 "아무 숫자"로 바꿉니다.
  function splitUrl(url) {
    const u = new URL(url);
    return (u.pathname + u.search).split(/([\/?&=;])/);
  }
  function hrefPatternOf(sampleUrl, otherUrls) {
    const tokens = splitUrl(sampleUrl);
    const sameShape = (otherUrls || []).map(splitUrl).filter((t) => t.length === tokens.length &&
      t.every((tok, i) => (i % 2 === 1 ? tok === tokens[i] : true)));
    if (sameShape.length >= 2) {
      const pattern = tokens.map((tok, i) => {
        if (i % 2 === 1) return escapeRegex(tok);                       // 구분 기호는 그대로
        const varies = sameShape.some((t) => t[i] !== tok);
        if (!varies) return escapeRegex(tok).replace(/\d+/g, "\\d+");  // 모든 줄이 같은 조각은 그대로(숫자만 아무 숫자로)
        return /^\d+$/.test(tok) && sameShape.every((t) => /^\d+$/.test(t[i])) ? "\\d+" : "[^/?&=;#]+";
      }).join("");
      return "^" + pattern + "$";
    }
    return "^" + escapeRegex(tokens.join("")).replace(/\d+/g, "\\d+") + "$";
  }

  function matchesPatterns(url, patterns) {
    const u = new URL(url);
    const target = u.pathname + u.search;
    return patterns.some((p) => new RegExp(p).test(target));
  }

  function fitToPattern(url, patterns) {
    try {
      const u = new URL(url);
      for (const p of patterns) {
        const names = [...p.matchAll(/(?:\\\?|&)([^=&\\]+)=/g)].map((m) => m[1]);
        if (!names.length || !names.every((n) => u.searchParams.has(n))) continue;
        const v = new URL(u.origin + u.pathname);
        names.forEach((n) => v.searchParams.append(n, u.searchParams.get(n)));
        const fitted = u.origin + u.pathname + "?" + names.map((n) => n + "=" + encodeURIComponent(u.searchParams.get(n)).replace(/%2F/gi, "/")).join("&");
        if (matchesPatterns(fitted, [p])) return fitted;
        if (matchesPatterns(v.href, [p])) return v.href;
      }
    } catch (e) { /* 주소가 아니면 그냥 실패 */ }
    return null;
  }

  // href 방식이 가능한지 판단합니다: 대부분(70% 이상)의 줄에 실제 주소가 있고 서로 다르면 가능
  // options.noDrop: 날짜 값을 빼면 글이 안 열리는 사이트일 때(⑦-2 검증 결과) 빼지 않고 다시 만듭니다.
  function deriveHrefRule(items, sampleItem, baseUrl, options) {
    const sampleHref = realHref(anchorOf(sampleItem), baseUrl);
    if (!sampleHref) return null;
    const raw = items.map((it) => realHref(anchorOf(it), baseUrl)).filter(Boolean);
    const volatile = volatileParams(raw); // 모든 줄에 같은 날짜/시각 값으로 붙은 칸 (이 게시판에서 실제로 본 것만)
    const drop = options && options.noDrop ? [] : volatile;
    const others = raw.map((h) => normalizeLink(h, drop));
    const patterns = [hrefPatternOf(normalizeLink(sampleHref, drop), others)];
    const links = others.filter((h) => matchesPatterns(h, patterns));
    const distinct = new Set(links).size;
    if (distinct >= Math.max(1, Math.ceil(items.length * 0.7))) {
      // volatile: 저장 주소에서는 못 뺐더라도(noDrop) 새 글 비교 때는 빼고 비교할 칸
      return { mode: "href", patterns, drop, volatile: options && options.noDrop ? volatile : [] };
    }
    return null;
  }

  // 글 번호(idValue)가 줄의 어느 속성에 들어 있는지 찾아 "속성 틀"을 만듭니다.
  // 예: onclick="goDetail('1187')" 에서 1187 을 찾으면 → 속성 onclick, 정규식 ^goDetail\('(.+?)'\)$
  // 다른 숫자(예: 페이지 번호)는 "아무 숫자"로 바꿔 줄마다 달라도 맞게 합니다.
  function deriveIdSource(items, sampleItem, idValue) {
    const tokenRe = new RegExp("(^|[^A-Za-z0-9])" + escapeRegex(idValue) + "($|[^A-Za-z0-9])");
    // 살펴볼 요소: 제목 요소부터 줄까지 올라가는 길 + 줄 안의 모든 요소
    const candidates = [];
    for (let el = sampleItem.titleEl; el; el = el.parentElement) {
      candidates.push(el);
      if (el === sampleItem.row) break;
    }
    sampleItem.row.querySelectorAll("*").forEach((el) => { if (!candidates.includes(el)) candidates.push(el); });

    for (const el of candidates) {
      for (const attr of [...el.attributes]) {
        const value = attr.value;
        if (!tokenRe.test(value)) continue;
        // 번호 자리를 (.+?) 로, 나머지 숫자는 \d+ 로 바꾼 정규식
        const idx = value.search(tokenRe);
        const start = value.indexOf(idValue, idx);
        const before = escapeRegex(value.slice(0, start)).replace(/\d+/g, "\\d+");
        const after = escapeRegex(value.slice(start + idValue.length)).replace(/\d+/g, "\\d+");
        const source = {
          element: relPath(sampleItem.row, el, true) || "", // 줄 기준 위치 ("" 이면 줄 자신)
          elementLoose: relPath(sampleItem.row, el, false) || "",
          attr: attr.name,
          regex: "^" + before + "(.+?)" + after + "$",
        };
        // 다른 줄들에서도 같은 방식으로 번호가 나오는지 확인 (70% 이상, 서로 달라야 함)
        const ids = items.map((it) => idFromSource(it, source)).filter(Boolean);
        if (new Set(ids).size >= Math.max(1, Math.ceil(items.length * 0.7))) return source;
      }
    }
    return null;
  }

  // 속성 틀로 한 줄에서 글 번호를 꺼냅니다.
  function idFromSource(item, source) {
    let el = source.element ? findByPath(item.row, source.element, source.elementLoose) : item.row;
    // 제목 쪽(제목 요소의 위)에 있는 속성이면 제목 요소에서 위로 찾아봅니다.
    if (!el || !el.hasAttribute(source.attr)) {
      el = item.titleEl.closest("[" + CSS.escape(source.attr) + "]");
      if (el && !item.row.contains(el) && el !== item.row) el = null;
    }
    if (!el) return null;
    const m = (el.getAttribute(source.attr) || "").match(new RegExp(source.regex));
    return m ? m[1] : null;
  }

  // 제목 글자로 만드는 대체 링크 (주소를 끝내 못 만들 때): 게시판 주소 + #nt-제목해시
  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // 한 줄의 글 주소를 규칙대로 만듭니다. 못 만들면 null (그 줄은 공지로 인정하지 않음)
  function linkOf(item, link, baseUrl) {
    if (link.mode === "href") {
      const href = realHref(anchorOf(item), baseUrl);
      if (!href) return null;
      const normalized = normalizeLink(href, link.drop);
      if (matchesPatterns(normalized, link.patterns)) return normalized;
      // 2페이지 이후 글 주소에는 목록 상태 값(예: 지금 페이지 번호)이 더 붙는 사이트가 있어,
      // 주소 모양에 들어 있는 값들만 남겨 다시 맞춰 봅니다. 맞으면 첫 페이지와 같은 모양의 주소로 저장
      return fitToPattern(normalized, link.patterns);
    }
    if (link.mode === "template") {
      const id = idFromSource(item, link.source);
      return id ? link.url.replace("{id}", encodeURIComponent(id)) : null;
    }
    if (link.mode === "list") {
      return normalizeLink(baseUrl).replace(/#.*$/, "") + "#nt-" + hashText(item.title);
    }
    return null;
  }

  // ---------- 4. 규칙 적용 (수집 때 사용) ----------

  // 문서에 규칙을 적용해 [{ title, link }] 를 돌려줍니다. 같은 링크는 한 번만.
  function applyRule(doc, rule, baseUrl) {
    const items = findItems(doc, rule.areas);
    const result = [];
    const seen = new Set();
    items.forEach((item) => {
      const link = linkOf(item, rule.link, baseUrl);
      if (!link || seen.has(link)) return;
      seen.add(link);
      result.push({ title: item.title, link });
    });
    return result;
  }

  // 고른 제목과 같은 줄을 찾습니다. 다시 열면 조회수, D-day 같은 숫자가 바뀌어 있을 수 있어
  // 정확히 같은 제목이 없으면 숫자와 공백을 뺀 글자로 비교합니다.
  function findSample(items, sampleTitle) {
    const exact = items.find((it) => it.title === sampleTitle);
    if (exact) return exact;
    const norm = (t) => (t || "").replace(/[\s\d,.:]+/g, "");
    const key = norm(sampleTitle);
    if (!key) return null;
    return items.find((it) => norm(it.title) === key) || null;
  }

  // ---------- 페이지 넘기기 (처음 수집, 옛 공지 가져오기) ----------
  // 페이지 번호 줄: 자식 칸들의 글자가 1, 2, 3 처럼 이어지는 숫자인 요소. 목록보다 뒤에 있는 것을 우선합니다.
  function findPager(doc, areas) {
    const list = areas && areas.length ? (() => { try { return doc.querySelector(areas[0].container); } catch (e) { return null; } })() : null;
    const cands = [...doc.querySelectorAll("body *")].filter((el) => {
      if (list && (list.contains(el) || el.contains(list))) return false;
      const nums = [...el.children].map((c) => cleanText(c.textContent)).filter((t) => /^\d{1,3}$/.test(t)).map(Number);
      if (nums.length < 2) return false;
      for (let i = 1; i < Math.min(3, nums.length); i++) if (nums[i] !== nums[i - 1] + 1) return false;
      // 번호가 2개뿐(2페이지 게시판)이면 1, 2 이고 목록 뒤에 있을 때만 인정 (다른 숫자 칸을 잘못 잡지 않게)
      if (nums.length === 2) return nums[0] === 1 && !!list && !!(list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      return true;
    });
    if (!cands.length) return null;
    const after = list ? cands.filter((el) => list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : [];
    return (after.length ? after : cands)[0];
  }

  // 페이지 번호 p 를 누릅니다. 눌렀으면 true, 그 번호가 없으면 false
  function clickPage(doc, areas, p) {
    const pager = findPager(doc, areas);
    if (!pager) return false;
    const cell = [...pager.children].find((c) => cleanText(c.textContent) === String(p));
    if (!cell) return false;
    const target = cell.matches("a, button, [onclick]") ? cell : (cell.querySelector("a, button, [onclick]") || cell);
    target.click();
    return true;
  }

  // 바깥(picker, offscreen, background)에서 쓸 수 있게 내보냅니다.
  global.NoticeRules = {
    cleanText,
    resolveTitleElement,
    findSample,
    deriveStructure,
    mergeAreas,
    findItems,
    deriveHrefRule,
    deriveIdSource,
    idFromSource,
    realHref,
    anchorOf,
    normalizeLink,
    linkOf,
    applyRule,
    findPager,
    clickPage,
  };
})(typeof self !== "undefined" ? self : window);
