// background.js (MV3 service worker)

let postingSession = {
  isRunning: false,
  activeTabId: null
};

// 세션/파일 정보는 storage에, 런타임 상태는 메모리에 관리
async function loadFilesAndSession() {
  const data = await chrome.storage.local.get([
    "tistoryAutoPosterFiles",
    "tistoryAutoPosterSession"
  ]);
  return {
    files: data.tistoryAutoPosterFiles || [],
    session: data.tistoryAutoPosterSession || {
      isRunning: false,
      currentIndex: 0
    }
  };
}

async function saveSession(session) {
  await chrome.storage.local.set({
    tistoryAutoPosterSession: session
  });
}

async function resetSession() {
  postingSession = {
    isRunning: false,
    activeTabId: null
  };
  await chrome.storage.local.set({
    tistoryAutoPosterSession: {
      isRunning: false,
      currentIndex: 0
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "START_POSTING") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        sendResponse({ ok: false, reason: "NO_ACTIVE_TAB" });
        return;
      }

      // 1) 먼저 티스토리 탭인지 검사
      const url = tab.url || "";
      if (!/^https:\/\/([^.]+\.)?tistory\.com\//.test(url)) {
        console.warn("[BG] 티스토리 탭이 아니라서 자동 포스팅을 시작할 수 없습니다. url =", url);
        sendResponse({ ok: false, reason: "NOT_TISTORY" });
        return;
      }

      const { files, session } = await loadFilesAndSession();
      if (!files.length) {
        sendResponse({ ok: false, reason: "NO_FILES" });
        return;
      }

      // 세션 초기화
      const newSession = {
        isRunning: true,
        currentIndex: 0
      };
      await saveSession(newSession);

      postingSession.isRunning = true;
      postingSession.activeTabId = tab.id;

      // 2) 이 탭에 contentScript 메시지 보내기
      const sendStartPosting = () => {
        chrome.tabs.sendMessage(tab.id, { type: "START_POSTING" }, (resp) => {
          if (chrome.runtime.lastError) {
            console.error("[BG] START_POSTING 메시지 전송 중 오류:", chrome.runtime.lastError.message);
            // 여기서 응답은 이미 리턴했으므로 단순 로그 정도로만 사용
          } else {
            console.log("[BG] START_POSTING 메시지 전송 완료:", resp);
          }
        });
      };

      chrome.tabs.sendMessage(tab.id, { type: "START_POSTING" }, (resp) => {
        if (chrome.runtime.lastError) {
          // 💥 여기서 에러가 나는 게 지금 네가 본 로그 상황
          const msg = chrome.runtime.lastError.message || "";
          console.warn("[BG] 첫 번째 START_POSTING 전송 실패, contentScript 강제 주입 시도:", msg);

          // 3) contentScript 강제 주입 후 다시 보내기
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              files: ["contentScript.js"]
            },
            () => {
              if (chrome.runtime.lastError) {
                console.error("[BG] contentScript 주입 실패:", chrome.runtime.lastError.message);
                sendResponse({
                  ok: false,
                  reason: "INJECT_FAIL",
                  message: chrome.runtime.lastError.message
                });
                return;
              }

              console.log("[BG] contentScript 주입 성공. START_POSTING 재전송.");
              sendStartPosting();
              sendResponse({ ok: true });
            }
          );
        } else {
          console.log("[BG] START_POSTING 메시지 전송 성공:", resp);
          sendResponse({ ok: true });
        }
      });
    }

    // 글쓰기 탭에서 "이 파일 포스팅 끝났다" 알림
    else if (msg.type === "FILE_POSTED") {
      console.log("[BG] FILE_POSTED 수신. fileIndex =", msg.fileIndex);

      const { files, session } = await loadFilesAndSession();
      if (!files.length) {
        await resetSession();
        chrome.runtime.sendMessage({
          type: "POSTING_ERROR",
          message: "업로드된 HTML 파일이 없습니다."
        });
        sendResponse && sendResponse({ ok: false });
        return;
      }

      const baseIndex = (typeof msg.fileIndex === "number")
        ? msg.fileIndex
        : (session.currentIndex || 0);

      const nextIndex = baseIndex + 1;
      session.currentIndex = nextIndex;

      if (nextIndex >= files.length) {
        console.log("[BG] 모든 파일 포스팅 완료. 세션 종료.");

        session.isRunning = false;
        session.currentIndex = 0;
        await saveSession(session);

        postingSession.isRunning = false;
        postingSession.activeTabId = null;

        chrome.runtime.sendMessage({ type: "POSTING_DONE" });
      } else {
        console.log("[BG] 다음 파일 인덱스 =", nextIndex);
        session.isRunning = true; // 명시적으로 true 유지
        await saveSession(session);
      }

      sendResponse && sendResponse({ ok: true });
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

// 다음 글쓰기를 시작: 홈 탭에 "글쓰기 버튼 눌러라" 메시지 전송
// async function startNextPost() {
//   const { files, session } = await loadFilesAndSession();

//   if (!session.isRunning || !files.length) {
//     console.log("[BG] 세션이 실행 중이 아니거나 파일이 없습니다.");
//     return;
//   }

//   if (session.currentIndex >= files.length) {
//     console.log("[BG] 모든 파일 포스팅 완료.");
//     session.isRunning = false;
//     session.currentIndex = 0;
//     await saveSession(session);
//     chrome.runtime.sendMessage({ type: "POSTING_DONE" });
//     return;
//   }

//   if (!session.homeTabId) {
//     console.error("[BG] homeTabId 가 없습니다. 홈 탭에서 다시 시작해주세요.");
//     session.isRunning = false;
//     session.currentIndex = 0;
//     await saveSession(session);
//     chrome.runtime.sendMessage({
//       type: "POSTING_ERROR",
//       message: "홈 탭 정보를 찾을 수 없습니다. 다시 홈 화면에서 시작해주세요."
//     });
//     return;
//   }

//   console.log("[BG] 홈 탭에서 새 글쓰기 탭 오픈 요청. currentIndex =", session.currentIndex);

//   // 홈 탭에 "글쓰기 버튼 눌러서 새 탭 열어라" 전달
//   chrome.tabs.sendMessage(session.homeTabId, { type: "OPEN_NEW_POST" }, (resp) => {
//     if (chrome.runtime.lastError) {
//       console.error("[BG] 홈 탭 메시지 전송 오류:", chrome.runtime.lastError.message);
//       chrome.runtime.sendMessage({
//         type: "POSTING_ERROR",
//         message: "홈 탭과 통신 중 오류가 발생했습니다. 홈 화면이 열려 있는지 확인해주세요."
//       });
//     } else {
//       console.log("[BG] OPEN_NEW_POST 메시지 전송 완료.");
//     }
//   });
// }

// // popup → START_POSTING
// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   (async () => {
//     if (msg.type === "START_POSTING") {
//       const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       if (!tab || !tab.id) {
//         sendResponse({ ok: false, reason: "NO_ACTIVE_TAB" });
//         return;
//       }

//       const { files } = await loadFilesAndSession();
//       if (!files.length) {
//         sendResponse({ ok: false, reason: "NO_FILES" });
//         return;
//       }

//       postingSession = {
//         isRunning: true,
//         currentIndex: 0,
//         homeTabId: tab.id
//       };
//       await saveSession(postingSession);

//       console.log("[BG] START_POSTING: 홈 탭 =", tab.id, "파일 개수 =", files.length);

//       await startNextPost();

//       sendResponse({ ok: true });
//     }

//     // 글쓰기 탭에서 "이 파일 포스팅 끝났다" 알림
//     else if (msg.type === "FILE_POSTED") {
//       console.log("[BG] FILE_POSTED 수신.");

//       const { files, session } = await loadFilesAndSession();

//       // 현재 인덱스 증가
//       session.currentIndex = (msg.fileIndex || session.currentIndex) + 1;
//       await saveSession(session);

//       // 다음 포스트 시작
//       await startNextPost();

//       sendResponse({ ok: true });
//     }

//     // 에러 통보
//     else if (msg.type === "ERROR") {
//       console.error("[BG] ERROR from contentScript:", msg.message);
//       postingSession.isRunning = false;
//       postingSession.currentIndex = 0;
//       await saveSession(postingSession);

//       chrome.runtime.sendMessage({
//         type: "POSTING_ERROR",
//         message: msg.message || "알 수 없는 오류"
//       });

//       sendResponse({ ok: true });
//     }
//   })();

//   return true;
// });

// // 새 탭이 글쓰기 에디터(/manage/newpost)로 로드 완료되면 그 탭에 RUN_POSTING_FOR_FILE 전송
// chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
//   try {
//     if (!postingSession.isRunning) return;
//     if (changeInfo.status !== "complete") return;
//     if (!tab.url || !/\/manage\/newpost/.test(tab.url)) return;

//     const { files, session } = await loadFilesAndSession();
//     if (!files.length) return;
//     if (session.currentIndex >= files.length) return;

//     const file = files[session.currentIndex];

//     console.log("[BG] 글쓰기 탭 감지. tabId =", tabId, "파일 index =", session.currentIndex, "파일명 =", file.name);

//     chrome.tabs.sendMessage(tabId, {
//       type: "RUN_POSTING_FOR_FILE",
//       fileIndex: session.currentIndex,
//       file
//     });
//   } catch (e) {
//     console.error("[BG] onUpdated 처리 중 오류:", e);
//   }
// });
