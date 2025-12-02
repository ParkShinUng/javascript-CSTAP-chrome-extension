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
 * 1) 홈/관리 페이지: 새 글쓰기 탭 열기
 *************************/

async function openNewPostFromHome() {
  try {
    console.log("[Tistory Auto Poster] 홈/관리 페이지에서 글쓰기 버튼 클릭 시도.");

    let newPostBtn = null;

    try {
      // 티스토리 상단 탭 기반 글쓰기 버튼 (필요하면 여기 셀렉터 조정)
      newPostBtn = await waitFor('a.link_tab[href$="/manage/newpost"]', 5000);
    } catch (e) {
      console.warn("[Tistory Auto Poster] a.link_tab[href$=\"/manage/newpost\"] 버튼을 찾지 못했습니다. 텍스트 기반으로 재시도.", e);
    }

    if (!newPostBtn) {
      const clicked = clickByText(["a", "button"], "글쓰기");
      if (!clicked) throw new Error("글쓰기 버튼을 찾을 수 없습니다. 홈 페이지 UI를 확인해주세요.");
      console.log("[Tistory Auto Poster] 텍스트 기반으로 글쓰기 버튼 클릭 완료.");
    } else {
      newPostBtn.click();
      console.log("[Tistory Auto Poster] 링크 기반 글쓰기 버튼 클릭 완료.");
    }

    // 여기서는 새 탭이 열리기만 하면 됨. 이후 작업은 background + 새 탭에서 처리.
  } catch (err) {
    console.error("[Tistory Auto Poster] openNewPostFromHome Error:", err);
    sendError(err);
  }
}


/*************************
 * 2) 글쓰기 탭: 실제 포스팅 로직
 *************************/

function setCodeMirrorValueSafe(htmlContent) {
    const scriptContent = `
        (function() {
            try {
                const cmElement = document.querySelector('.mce-codeblock-content .CodeMirror');
                
                if (cmElement && cmElement.CodeMirror) {
                    cmElement.CodeMirror.setValue(\`${htmlContent}\`);
                    cmElement.CodeMirror.save(); // 변경사항 저장
                    console.log("✅ [Tistory Auto Poster] CodeMirror API로 값 설정 완료");
                } else {
                    console.error("❌ [Tistory Auto Poster] CodeMirror 인스턴스를 찾을 수 없습니다.");
                }
            } catch (e) {
                console.error("❌ [Tistory Auto Poster] 오류 발생:", e);
            }
        })();
    `;

    // 2. script 태그를 생성하여 DOM에 추가합니다. (즉시 실행됨)
    const script = document.createElement('script');
    script.textContent = scriptContent;
    (document.head || document.documentElement).appendChild(script);

    // 3. 실행 후 흔적을 지우기 위해 태그를 제거합니다.
    script.remove();
}

async function runPostingForFile(fileIndex, file) {
  try {
    console.log("[Tistory Auto Poster] 글쓰기 탭에서 포스팅 시작. fileIndex =", fileIndex, "파일명 =", file && file.name);

    if (!file || !file.content) {
      throw new Error('파일 내용이 비어 있습니다.');
    }

    const htmlContent = file.content;

    // URL 확인
    if (!/\/manage\/newpost/.test(location.href)) {
      throw new Error("현재 탭은 /manage/newpost 글쓰기 페이지가 아닙니다.");
    }

    /*********************
     *  1. HTML Block 입력
     *********************/
    console.log("[Tistory Auto Poster] HTML 블럭 버튼을 찾는 중...");

    const moreBtn = await waitFor('button#more-plugin-btn-open');
    if (!moreBtn) throw new Error("HTML 블럭을 여는 버튼(더보기)을 찾을 수 없습니다.");
    moreBtn.click();
    await sleep(500);

    const htmlBlockBtn = await waitFor("div#plugin-html-block");
    if (!htmlBlockBtn) throw new Error("HTML 블럭 플러그인 버튼을 찾을 수 없습니다.");
    htmlBlockBtn.click();
    await sleep(500);

    // const htmlTextArea = await waitFor('.CodeMirror textarea', 3000);
    // if (!htmlTextArea) throw new Error("HTML 블럭 입력 영역을 찾을 수 없습니다.");
    // htmlTextArea.setValue = htmlContent;
    // htmlTextArea.dispatchEvent(new Event("input", { bubbles: true }));

    // const cmContainer = document.querySelector('.CodeMirror');
    // cmContainer.CodeMirror.setValue = htmlContent;

    // 1.
    const container = await waitFor('.mce-codeblock-content', 3000);
    if (container) {
        const htmlTextArea = container.querySelector('.CodeMirror textarea[tabindex="0"]', 3000);
        if (!htmlTextArea) throw new Error("HTML 블럭 입력 영역을 찾을 수 없습니다.");
        htmlTextArea.value = htmlContent;
        htmlTextArea.dispatchEvent(new Event("input", { bubbles: true }));
        htmlTextArea.dispatchEvent(new Event("change", { bubbles: true }));
        htmlTextArea.focus();
    } else {
        console.error("❌ .mce-codeblock-content 컨테이너를 찾을 수 없습니다.");
    }


    // 2.
    const cmElement = await waitFor('.mce-codeblock-content .CodeMirror', 3000);
    if (cmElement && cmElement.CodeMirror) {
        const cmInstance = cmElement.CodeMirror;
        cmInstance.setValue = htmlContent;
        cmInstance.save();
    }

    // 3.
    const mceCodeblock = await waitFor('div.mce-codeblock-content', 3000);
    await sleep(100); // DOM이 안정화되도록 잠시 대기

    if (mceCodeblock) {
        const codeMirror = mceCodeblock.querySelector('div.CodeMirror');
        
        if (codeMirror) {
            const htmlTextArea = codeMirror.querySelector('textarea[tabindex="0"]');

            if (htmlTextArea) {
                htmlTextArea.value = htmlContent;
                htmlTextArea.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(500);
                
            } else {
                console.error("오류: CodeMirror 내부에서 textarea 요소를 찾을 수 없습니다.");
            }
        } else {
            console.error("오류: div.mce-codeblock-content 내부에서 div.CodeMirror 요소를 찾을 수 없습니다.");
        }
    } else {
        console.error("오류: div.mce-codeblock-content 요소를 찾을 수 없습니다.");
    }

    // 4.
    const htmlTextArea = await waitFor('div.mce-codeblock-content div.CodeMirror textarea', 2000);
    if (!htmlTextArea) throw new Error('HTML textarea 을 찾을 수 없습니다.');
    setCodeMirrorValueSafe(htmlContent); // 방법 1의 함수 사용
    
    await sleep(500);
    return;

    const submitBtn = await waitFor("div.mce-codeblock-btn-submit button");
    if (!submitBtn) throw new Error("확인 버튼을 찾을 수 없습니다.");
    submitBtn.click();

    /*********************
     * 2. 제목 + 본문 입력
     *********************/
    console.log("[Tistory Auto Poster] 제목/본문 입력을 시작합니다.");
    
    // HTML 내용 파싱 (첫 번째 h1 → 제목, 나머지 → 본문)
    const { title, bodyHtml } = splitHtmlToTitleAndBody(htmlContent);
    console.log("[Tistory Auto Poster] 추출된 제목:", title);

    
    // 제목 입력 필드
    const titleInput = await waitFor("textarea#post-title-inp", 3000).catch(() => null);
    if (!titleInput) throw new Error("제목 입력 필드를 찾을 수 없습니다.");

    // 제목 입력
    titleInput.value = title;
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(500);

    // // tinymce 인스턴스 (에디터)
    // TinyMCE 인스턴스 목록을 확인 : window.tinymce.editors(console 입력)
    // const editorInstance = window.tinymce && window.tinymce.get('editor-tistory');
    // const editorInstance = window.tinymce && window.tinymce.get('.Editor-inner');
    // if (!editorInstance) throw new Error("본문 입력 영역(tinymce 에디터)을 찾을 수 없습니다.");

    // // 본문 입력 (기존 내용을 덮어씀)
    // const currentContent = editorInstance.getContent() || "";
    // editorInstance.setContent(currentContent + bodyHtml);
    // editorInstance.fire("change");
    // await sleep(500);

    /*********************
     * 3. 발행 레이어 열기
     *********************/
    console.log("[Tistory Auto Poster] 발행 레이어를 여는 버튼을 찾는 중...");

    const completeBtn = document.querySelector("button#publish-layer-btn");
    if (!completeBtn) {
      throw new Error("발행 레이어 호출 버튼(publish-layer-btn)을 찾을 수 없습니다.");
    }
    completeBtn.click();

    /*********************
     * 4. 공개 라디오 + 발행 버튼 클릭
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

    await sleep(3000);

    /*********************
     * 5. 완료 알림
     *********************/
    chrome.runtime.sendMessage({
      type: "FILE_POSTED",
      fileIndex
    });

     console.log("[Tistory Auto Poster] FILE_POSTED 전송 완료. fileIndex =", fileIndex);
  } catch (err) {
    console.error("[Tistory Auto Poster] runPostingForFile Error:", err);
    sendError(err);
  }
}

/*************************
 * 메시지 리스너
 *************************/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_NEW_POST") {
    // 홈/관리 페이지에서 새 글쓰기 탭 열기
    openNewPostFromHome();
    sendResponse({ ok: true });
  } else if (msg.type === "RUN_POSTING_FOR_FILE") {
    // 글쓰기 탭에서 실제 포스팅 로직 실행
    runPostingForFile(msg.fileIndex, msg.file);
    sendResponse({ ok: true });
  }
  return true;
});