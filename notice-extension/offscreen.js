// offscreen.js
// 서비스 워커(background.js)에는 HTML을 읽는 DOMParser 가 없어서, 이 보이지 않는 문서에서 대신 읽습니다.
// 받는 메시지: { target: "offscreen", type: "parse", html, rule, baseUrl }
// 돌려주는 값: { items: [{title, link}], rows: 규칙에 맞는 줄 수, hasPassword: 비밀번호 입력칸이 있는지 }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen" || msg.type !== "parse") return false;
  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    const rows = NoticeRules.findItems(doc, msg.rule.areas).length;
    const items = NoticeRules.applyRule(doc, msg.rule, msg.baseUrl);
    const hasPassword = !!doc.querySelector('input[type="password"]');
    sendResponse({ items, rows, hasPassword });
  } catch (e) {
    sendResponse({ error: e.message || String(e) });
  }
  return false;
});
