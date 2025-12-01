// contentScript.js

/*************************
 * 공통 유틸 함수들
 *************************/

// HTML에서 첫 번째 <h1>을 제목으로 사용하고, 그 <h1> 제거한 나머지 HTML을 본문으로 사용
function splitHtmlToTitleAndBody(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  const h1 = doc.querySelector("h1");

  if (!h1) {
    console.warn("[Tistory Auto Poster] h1 태그를 찾지 못했습니다. 전체 HTML을 본문으로 사용합니다.");
    return {
      title: "제목 없음",
      bodyHtml: rawHtml
    };
  }

  const title = h1.textContent.trim();
  h1.remove(); // 본문에서 첫 번째 h1 제거

  const bodyHtml = (doc.body && doc.body.innerHTML ? doc.body.innerHTML : "").trim();

  return {
    title: title || "제목 없음",
    bodyHtml: bodyHtml || ""
  };
}

// 버튼/링크 텍스트로 엘리먼트 클릭
function clickByText(selectors, text) {
  const lower = text.toLowerCase();
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const inner = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (inner && inner.includes(lower)) {
        el.click();
        return true;
      }
    }
  }
  return false;
}

// 특정 시간동안 selector에 해당하는 요소가 나타날 때까지 기다리는 헬퍼
function waitFor(selector, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`Element not found: ${selector}`));
        return;
      }
      requestAnimationFrame(check);
    };

    check();
  });
}

// 단순 sleep
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// background 로 에러 전파
function sendError(err) {
  const message = typeof err === "string" ? err : (err && err.message) || String(err);
  chrome.runtime.sendMessage({
    type: "ERROR",
    message
  });
}


/*************************
 * 티스토리 포스팅 로직
 *************************/

async function runPostingForFile(fileIndex, file) {
  try {
    console.log('[Tistory Auto Poster] Start posting for file:', file?.name);

    if (!file || !file.content) {
      throw new Error('파일 내용이 비어 있습니다.');
    }

    /*********************
     * 1. 새 글쓰기 페이지로 이동
     *********************/
    if (!/\/manage\/newpost/.test(location.href)) {
      console.log("[Tistory Auto Poster] 새 글쓰기 버튼을 찾는 중...");

      let newPostBtn = null;

      try {
        newPostBtn = await waitFor('a.link_tab[href$="/manage/newpost"]', 3000);
      } catch (e) {
        console.warn("[Tistory Auto Poster] 지정된 a.link_tab[href$=\"/manage/newpost\"] 셀렉터로 버튼을 찾지 못했습니다. 텍스트 기반으로 재시도합니다.", e);
      }

      if (!newPostBtn) {
        const clicked = clickByText(["a", "button"], "글쓰기");
        if (!clicked) {
          throw new Error("글쓰기 버튼을 찾을 수 없습니다.");
        }
        console.log("[Tistory Auto Poster] 글쓰기 버튼을 텍스트 기반으로 클릭했습니다.");
      } else {
        console.log("[Tistory Auto Poster] 글쓰기 버튼을 클릭합니다.");
        newPostBtn.click();
      }

      await sleep(3000); // 글쓰기 화면 로딩 대기
    } else {
      console.log("[Tistory Auto Poster] 이미 /manage/newpost 페이지에 있습니다. 글쓰기 버튼 클릭은 생략합니다.");
    }

    /*********************
     * 2. HTML Block 입력 (파일 전체 HTML)
     *********************/
    console.log("[Tistory Auto Poster] HTML 블럭 버튼을 찾는 중...");

    const moreBtn = document.querySelector("button#more-plugin-btn-open");
    if (!moreBtn) {
      throw new Error("HTML 블럭을 여는 버튼(더보기)을 찾을 수 없습니다.");
    }
    moreBtn.click();

    const htmlBlockBtn = await waitFor("div#plugin-html-block", 3000);
    if (!htmlBlockBtn) {
      throw new Error("HTML 블럭 플러그인 버튼을 찾을 수 없습니다.");
    }
    htmlBlockBtn.click();

    const htmlTextArea = await waitFor("div.mce-codeblock-content div.CodeMirror textarea", 3000);
    const submitBtn = document.querySelector("div.mce-codeblock-btn-submit button");

    if (!htmlTextArea || !submitBtn) {
      throw new Error("HTML 블럭 입력 영역 또는 완료 버튼을 찾을 수 없습니다.");
    }

    console.log("[Tistory Auto Poster] HTML 블럭에 파일 전체 내용을 입력합니다.");

    htmlTextArea.value = file.content;
    htmlTextArea.dispatchEvent(new Event("input", { bubbles: true }));

    // CodeMirror 내부 동기화를 위해 약간의 프레임 대기
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    submitBtn.click();
      

    /*********************
     * 3. 글쓰기 에디터: 제목 + 본문 입력
     *********************/
    console.log("[Tistory Auto Poster] 제목/본문 입력을 시작합니다.");

    // 제목 입력 필드
    const titleInput = await waitFor("textarea#post-title-inp", 3000).catch(() => null);
    if (!titleInput) {
      throw new Error("제목 입력 필드를 찾을 수 없습니다.");
    }

    // tinymce 인스턴스 (에디터)
    const editorInstance = window.tinymce && window.tinymce.get("editor-tistory");
    if (!editorInstance) {
      throw new Error("본문 입력 영역(tinymce 에디터)을 찾을 수 없습니다.");
    }

    // HTML 내용 파싱 (첫 번째 h1 → 제목, 나머지 → 본문)
    const { title, bodyHtml } = splitHtmlToTitleAndBody(file.content);

    console.log("[Tistory Auto Poster] 추출된 제목:", title);

    // 제목 입력
    titleInput.value = title;
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    titleInput.dispatchEvent(new Event("change", { bubbles: true }));

    // 본문 입력 (기존 내용을 덮어씀)
    const currentContent = editorInstance.getContent() || "";
    editorInstance.setContent(currentContent + bodyHtml);
    editorInstance.fire("change");
    await sleep(200);

    /*********************
     * 4. 발행 레이어 열기
     *********************/
    console.log("[Tistory Auto Poster] 발행 레이어를 여는 버튼을 찾는 중...");

    const completeBtn = document.querySelector("button#publish-layer-btn");
    if (!completeBtn) {
      throw new Error("발행 레이어 호출 버튼(publish-layer-btn)을 찾을 수 없습니다.");
    }
    completeBtn.click();

    /*********************
     * 5. 공개 라디오 + 발행 버튼 클릭
     *********************/
    console.log("[Tistory Auto Poster] 공개 설정 및 발행 버튼을 찾는 중...");

    const openRadio = await waitFor("input#open20", 3000).catch(() => null);
    const published = document.querySelector("button#publish-btn");

    if (!openRadio) {
      throw new Error("공개 버튼(input#open20)을 찾을 수 없습니다.");
    }
    if (!published) {
      throw new Error("발행/등록 버튼(button#publish-btn)을 찾을 수 없습니다.");
    }

    openRadio.click();
    await sleep(200);

    published.click();
    console.log("[Tistory Auto Poster] 발행 버튼 클릭 완료. 서버 응답 대기...");

    // 발행 후 서버 처리 시간 고려
    await sleep(3000);

    /*********************
     * 6. 한 파일 작업 완료 → background에 알림
     *********************/
    chrome.runtime.sendMessage({
      type: "FILE_POSTED",
      fileIndex
    });

    console.log("[Tistory Auto Poster] 파일 처리 완료, FILE_POSTED 전송:", fileIndex);
  } catch (err) {
    console.error("[Tistory Auto Poster] Error:", err);
    sendError(err);
  }
}

/*************************
 * 메시지 리스너
 *************************/

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_POSTING_FOR_FILE') {
    // background에서 { fileIndex, file } 전달
    runPostingForFile(msg.fileIndex, msg.file);
    sendResponse({ ok: true });
  }
  return true;
});
