// demo.js
// 로그인하지 않고 들어온 사람에게 보여 주는 "체험 화면"용 가짜 DB입니다.
// - 진짜 Supabase 대신 브라우저 안의 예시 데이터로 화면을 그립니다. (진짜 DB에는 아무것도 저장하지 않음)
// - 읽음, 삭제, 스크랩, 폴더와 게시판 설정 같은 변경은 지금 보는 동안에만 반영됩니다.
// - 다른 화면(설정 등)으로 옮겨 가도 유지되고(sessionStorage), 새로고침하면 처음 예시로 돌아갑니다.
// supabase-config.js 가 로그인 정보가 없을 때 createDemoDb() 를 불러 db 대신 씁니다.

const DEMO_KEY = "notice-demo-db";

// ---------- 예시 데이터 ----------
// 공지 링크는 실제 게시판 목록 주소 뒤에 #demo-번호 를 붙여 만듭니다. (누르면 그 게시판 목록이 열림)
function demoSeed() {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600 * 1000).toISOString(); // h시간 전 시각

  const folders = [
    { id: 1, name: "장학", sort_order: 1 },
    { id: 2, name: "학교 공지", sort_order: 2 },
    { id: 3, name: "학과 공지", sort_order: 3 },
    { id: 4, name: "취업/현장실습", sort_order: 4 },
    { id: 5, name: "공모전", sort_order: 5 },
  ];

  const site = (id, folder_id, name, board_url, keywords, found) => ({
    id, folder_id, name, board_url, keywords, last_status: "ok",
    last_found: found, last_saved: 0, last_error: null, last_collected_at: hoursAgo(1),
  });
  const sites = [
    site(1, 1, "드림스폰", "https://www.dreamspon.com/scholarship/list.html", [], 15),
    site(2, 1, "한국장학재단", "https://www.kosaf.go.kr", ["장학금"], 10),
    site(3, 2, "한양대 전체 공지", "https://www.hanyang.ac.kr/notice_all", [], 20),
    site(4, 2, "비교과 프로그램", "https://hylu-s.hanyang.ac.kr/ko/notice/notice_all", [], 20),
    site(5, 3, "수학과 공지사항", "https://math.hanyang.ac.kr", [], 8),
    site(6, 3, "자연과학대학 학부", "https://cns.hanyang.ac.kr", [], 20),
    site(7, 4, "현장실습", "https://hywep.hanyang.ac.kr/data/list.do?type=S_NOTICE", [], 10),
    site(8, 4, "링커리어 대외활동", "https://linkareer.com/list/activity", [], 32),
    site(9, 5, "위비티 공모전", "https://www.wevity.com", ["공모전", "공모"], 12),
  ];
  // 규칙 미설정 예시 하나 (설정 화면과 사이트 상태 표시를 보여 주기 위해)
  sites.push({ id: 10, folder_id: 5, name: "새로 추가한 게시판", board_url: "https://example.com/board",
    keywords: [], last_status: "norule", last_collected_at: null });

  // [게시판 id, 제목, 몇 시간 전, 읽음 여부]
  const rows = [
    [1, "2026 하반기 지역인재 장학생 선발 공고", 2, false],
    [1, "OO문화재단 대학생 생활비 장학금 모집 (월 50만원)", 5, false],
    [1, "이공계 우수 학부생 장학 프로그램 신청 안내", 20, true],
    [2, "2027학년도 1학기 국가장학금 1차 신청 안내", 3, false],
    [2, "푸른등대 기부장학금 추천 대상자 모집", 26, true],
    [3, "2026학년도 동계 계절학기 수강신청 일정 안내", 1, false],
    [3, "2학기 기말고사 기간 열람실 연장 운영", 4, false],
    [3, "학위수여식 참석 신청 안내", 30, true],
    [3, "캠퍼스 셔틀버스 겨울방학 운행 시간표", 50, true],
    [4, "겨울방학 데이터 분석 실무 특강 참가자 모집", 6, false],
    [4, "취업 역량 강화 모의면접 프로그램 신청", 28, true],
    [5, "2027학년도 1학기 전공 설명회 개최 안내", 2, false],
    [5, "졸업논문 제출 일정 및 양식 안내", 40, true],
    [6, "자연과학대학 학부생 연구 참여 프로그램 모집", 8, false],
    [6, "학과 사무실 동계 방학 근무 시간 변경", 60, true],
    [7, "2027 동계 현장실습 참여 기업 추가 모집", 3, false],
    [7, "현장실습 사전교육 이수 안내", 22, false],
    [7, "현장실습 결과 보고서 제출 기한 안내", 70, true],
    [8, "IT 기업 대학생 서포터즈 5기 모집", 1, false],
    [8, "청년 금융 교육 봉사단 모집", 9, false],
    [8, "글로벌 탐방 프로그램 참가자 모집", 33, true],
    [9, "제5회 대학생 데이터 시각화 공모전", 2, false],
    [9, "친환경 아이디어 공모전 (총상금 1,000만원)", 12, false],
    [9, "AI 활용 숏폼 영상 공모전", 45, true],
    // 중복 정리 체험용: 같은 폴더의 다른 게시판에 같은 제목
    [1, "2027학년도 1학기 국가장학금 1차 신청 안내", 4, true],
    [4, "2026학년도 동계 계절학기 수강신청 일정 안내", 2, false],
  ];
  const notices = rows.map(([siteId, title, h, read], i) => {
    const s = sites.find((x) => x.id === siteId);
    return { id: i + 1, site_id: siteId, folder_id: s.folder_id, site_name: s.name,
      title, link: s.board_url + "#demo-" + (i + 1), collected_at: hoursAgo(h), read };
  });

  const scraps = [notices[1], notices[21]].map((n, i) => ({
    id: i + 1, folder_id: n.folder_id, site_name: n.site_name, title: n.title, link: n.link,
    created_at: hoursAgo(1 + i),
  }));

  return { folders, sites, notices, scraps, collector: [{ id: 1, last_collect: hoursAgo(1) }] };
}

// ---------- 체험 데이터 불러오기 / 저장 ----------
// 새로고침이면 처음 예시로, 다른 화면에서 넘어왔으면 보던 상태 그대로
function demoLoad() {
  const nav = performance.getEntriesByType("navigation")[0];
  const isReload = nav && nav.type === "reload";
  const saved = sessionStorage.getItem(DEMO_KEY);
  if (!isReload && saved) return JSON.parse(saved);
  const fresh = demoSeed();
  sessionStorage.setItem(DEMO_KEY, JSON.stringify(fresh));
  return fresh;
}

// ---------- 가짜 db ----------
// app.js, settings.js, folder-settings.js 가 쓰는 모양 그대로 흉내 냅니다.
// 예: await db.from("notices").update({ read: true }).in("id", [1, 2])
function createDemoDb() {
  const tables = demoLoad();
  const save = () => sessionStorage.setItem(DEMO_KEY, JSON.stringify(tables));
  const nextId = (rows) => rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;

  // 폴더/게시판을 지울 때 진짜 DB의 연결 규칙을 흉내 냄
  // 폴더 삭제: 그 폴더의 게시판, 공지, 스크랩도 삭제 / 게시판 삭제: 공지는 남김(site_id 비움)
  function cascade(table, removed) {
    const ids = removed.map((r) => r.id);
    if (table === "folders") {
      tables.sites = tables.sites.filter((s) => !ids.includes(s.folder_id));
      tables.notices = tables.notices.filter((n) => !ids.includes(n.folder_id));
      tables.scraps = tables.scraps.filter((s) => !ids.includes(s.folder_id));
    }
    if (table === "sites") {
      tables.notices.forEach((n) => { if (ids.includes(n.site_id)) n.site_id = null; });
    }
  }

  function from(table) {
    const q = { op: "select", filters: [], payload: null, single: false, orderBy: null };
    const builder = {
      select() { return builder; },
      insert(payload) { q.op = "insert"; q.payload = payload; return builder; },
      update(payload) { q.op = "update"; q.payload = payload; return builder; },
      delete() { q.op = "delete"; return builder; },
      eq(col, val) { q.filters.push((r) => r[col] === val); return builder; },
      in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return builder; },
      order(col, opt = {}) { q.orderBy = { col, asc: opt.ascending !== false }; return builder; },
      single() { q.single = true; return builder; },
      // await 하면 여기서 실제로 처리합니다.
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };

    function run() {
      const rows = tables[table];
      if (!rows) return { data: null, error: { message: "체험 화면에 없는 표: " + table } };
      const match = (r) => q.filters.every((f) => f(r));
      const copy = (x) => JSON.parse(JSON.stringify(x));

      if (q.op === "select") {
        let data = rows.slice();
        if (q.orderBy) {
          const { col, asc } = q.orderBy;
          data.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
        }
        return { data: copy(data), error: null };
      }
      if (q.op === "insert") {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        const added = list.map((p) => {
          const row = { id: nextId(rows), created_at: new Date().toISOString(), ...p };
          if (table === "notices" && row.read === undefined) row.read = false;
          rows.push(row);
          return row;
        });
        save();
        return { data: copy(q.single ? added[0] : added), error: null };
      }
      if (q.op === "update") {
        const changed = rows.filter(match);
        changed.forEach((r) => Object.assign(r, q.payload));
        save();
        return { data: copy(changed), error: null };
      }
      if (q.op === "delete") {
        const removed = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
        cascade(table, removed);
        save();
        return { data: copy(removed), error: null };
      }
    }
    return builder;
  }

  return {
    from,
    rpc: async () => ({ data: 11.2 * 1024 * 1024, error: null }), // 저장 공간 막대용 예시 값 (약 11MB)
    auth: { signOut: async () => {}, getSession: async () => ({ data: { session: null } }) },
  };
}
