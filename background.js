// background.js

// 현재 탭 가져오기 헬퍼
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 현재 파일 포스팅 시작
async function startPostingOnCurrentTab() {
  const tab = await getCurrentTab();
  if (!tab || !tab.id) return { ok: false, reason: 'NO_TAB' };

  // 세션 상태 체크
  const data = await chrome.storage.local.get(['tistoryAutoPosterFiles', 'tistoryAutoPosterSession']);
  const files = data.tistoryAutoPosterFiles || [];
  const session = data.tistoryAutoPosterSession || { isRunning: false, currentIndex: 0 };

  if (!session.isRunning || !files.length) {
    return { ok: false, reason: 'NO_SESSION_OR_FILES' };
  }

  if (session.currentIndex >= files.length) {
    // 이미 끝난 상태
    await chrome.storage.local.set({
      tistoryAutoPosterSession: { isRunning: false, currentIndex: 0 }
    });
    chrome.runtime.sendMessage({ type: 'POSTING_DONE' });
    return { ok: false, reason: 'ALREADY_DONE' };
  }

  // 현재 파일 데이터
  const fileData = files[session.currentIndex];

  // contentScript에게 메시지 전송
  chrome.tabs.sendMessage(tab.id, {
    type: 'RUN_POSTING_FOR_FILE',
    fileIndex: session.currentIndex,
    file: fileData
  });

  return { ok: true };
}

// popup에서 POSTING 시작 요청
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'START_POSTING') {
      const result = await startPostingOnCurrentTab();
      sendResponse(result);
    }
    // contentScript에서 파일 작업 완료 통보
    else if (msg.type === 'FILE_POSTED') {
      const data = await chrome.storage.local.get(['tistoryAutoPosterFiles', 'tistoryAutoPosterSession']);
      const files = data.tistoryAutoPosterFiles || [];
      let session = data.tistoryAutoPosterSession || { isRunning: false, currentIndex: 0 };

      session.currentIndex += 1;

      if (session.currentIndex >= files.length) {
        // 모든 파일 발행 완료
        session.isRunning = false;
        session.currentIndex = 0;

        await chrome.storage.local.set({ tistoryAutoPosterSession: session });
        chrome.runtime.sendMessage({ type: 'POSTING_DONE' });
      } else {
        // 다음 파일로 진행
        await chrome.storage.local.set({ tistoryAutoPosterSession: session });
        // 같은 탭에서 다음 파일 진행 (이미 발행 완료 후 글쓰기 페이지에 있다고 가정)
        await startPostingOnCurrentTab();
      }
      sendResponse({ ok: true });
    }
    // contentScript에서 에러 통보
    else if (msg.type === 'ERROR') {
      // 세션 초기화
      await chrome.storage.local.set({
        tistoryAutoPosterSession: { isRunning: false, currentIndex: 0 }
      });
      chrome.runtime.sendMessage({
        type: 'POSTING_ERROR',
        message: msg.message || '알 수 없는 오류'
      });
      sendResponse({ ok: true });
    }
  })();

  // async 응답을 쓰기 위한 설정
  return true;
});
