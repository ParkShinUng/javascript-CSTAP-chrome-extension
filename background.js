// background.js (MV3 service worker)

let postingSession = {
  isRunning: false,
  currentIndex: 0,
  homeTabId: null
};

// 세션/파일 정보는 storage에, 런타임 상태는 메모리에 관리
async function loadFilesAndSession() {
  const data = await chrome.storage.local.get([
    "tistoryAutoPosterFiles",
    "tistoryAutoPosterSession"
  ]);
  return {
    files: data.tistoryAutoPosterFiles || [],
    session: data.tistoryAutoPosterSession || postingSession
  };
}

async function saveSession(session) {
  postingSession = session;
  await chrome.storage.local.set({
    tistoryAutoPosterSession: postingSession
  });
}

// 다음 글쓰기를 시작: 홈 탭에 "글쓰기 버튼 눌러라" 메시지 전송
async function startNextPost() {
  const { files, session } = await loadFilesAndSession();

  if (!session.isRunning || !files.length) {
    console.log("[BG] 세션이 실행 중이 아니거나 파일이 없습니다.");
    return;
  }

  if (session.currentIndex >= files.length) {
    console.log("[BG] 모든 파일 포스팅 완료.");
    session.isRunning = false;
    session.currentIndex = 0;
    await saveSession(session);
    chrome.runtime.sendMessage({ type: "POSTING_DONE" });
    return;
  }

  if (!session.homeTabId) {
    console.error("[BG] homeTabId 가 없습니다. 홈 탭에서 다시 시작해주세요.");
    session.isRunning = false;
    session.currentIndex = 0;
    await saveSession(session);
    chrome.runtime.sendMessage({
      type: "POSTING_ERROR",
      message: "홈 탭 정보를 찾을 수 없습니다. 다시 홈 화면에서 시작해주세요."
    });
    return;
  }

  console.log("[BG] 홈 탭에서 새 글쓰기 탭 오픈 요청. currentIndex =", session.currentIndex);

  // 홈 탭에 "글쓰기 버튼 눌러서 새 탭 열어라" 전달
  chrome.tabs.sendMessage(session.homeTabId, { type: "OPEN_NEW_POST" }, (resp) => {
    if (chrome.runtime.lastError) {
      console.error("[BG] 홈 탭 메시지 전송 오류:", chrome.runtime.lastError.message);
      chrome.runtime.sendMessage({
        type: "POSTING_ERROR",
        message: "홈 탭과 통신 중 오류가 발생했습니다. 홈 화면이 열려 있는지 확인해주세요."
      });
    } else {
      console.log("[BG] OPEN_NEW_POST 메시지 전송 완료.");
    }
  });
}

// popup → START_POSTING
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "START_POSTING") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        sendResponse({ ok: false, reason: "NO_ACTIVE_TAB" });
        return;
      }

      const { files } = await loadFilesAndSession();
      if (!files.length) {
        sendResponse({ ok: false, reason: "NO_FILES" });
        return;
      }

      postingSession = {
        isRunning: true,
        currentIndex: 0,
        homeTabId: tab.id
      };
      await saveSession(postingSession);

      console.log("[BG] START_POSTING: 홈 탭 =", tab.id, "파일 개수 =", files.length);

      await startNextPost();

      sendResponse({ ok: true });
    }

    // 글쓰기 탭에서 "이 파일 포스팅 끝났다" 알림
    else if (msg.type === "FILE_POSTED") {
      console.log("[BG] FILE_POSTED 수신.");

      const { files, session } = await loadFilesAndSession();

      // 현재 인덱스 증가
      session.currentIndex = (msg.fileIndex || session.currentIndex) + 1;
      await saveSession(session);

      // 다음 포스트 시작
      await startNextPost();

      sendResponse({ ok: true });
    }

    // 에러 통보
    else if (msg.type === "ERROR") {
      console.error("[BG] ERROR from contentScript:", msg.message);
      postingSession.isRunning = false;
      postingSession.currentIndex = 0;
      await saveSession(postingSession);

      chrome.runtime.sendMessage({
        type: "POSTING_ERROR",
        message: msg.message || "알 수 없는 오류"
      });

      sendResponse({ ok: true });
    }
  })();

  return true;
});

// 새 탭이 글쓰기 에디터(/manage/newpost)로 로드 완료되면 그 탭에 RUN_POSTING_FOR_FILE 전송
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (!postingSession.isRunning) return;
    if (changeInfo.status !== "complete") return;
    if (!tab.url || !/\/manage\/newpost/.test(tab.url)) return;

    const { files, session } = await loadFilesAndSession();
    if (!files.length) return;
    if (session.currentIndex >= files.length) return;

    const file = files[session.currentIndex];

    console.log("[BG] 글쓰기 탭 감지. tabId =", tabId, "파일 index =", session.currentIndex, "파일명 =", file.name);

    chrome.tabs.sendMessage(tabId, {
      type: "RUN_POSTING_FOR_FILE",
      fileIndex: session.currentIndex,
      file
    });
  } catch (e) {
    console.error("[BG] onUpdated 처리 중 오류:", e);
  }
});
