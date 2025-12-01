// contentScript.js

// HTML 첫 줄을 제목, 나머지를 본문으로 분리
function splitHtmlToTitleAndBody(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 첫 번째 h1 태그 찾기
  const h1 = doc.querySelector('h1');

  if (!h1) {
    return {
      title: '제목 없음',
      bodyHtml: rawHtml
    };
  }

  // h1 태그 텍스트를 제목으로 사용
  const title = h1.textContent.trim();

  // h1 태그는 본문에서 제거
  h1.remove();

  // 본문 HTML 생성
  const bodyHtml = doc.body.innerHTML.trim();

  return {
    title: title || '제목 없음',
    bodyHtml: bodyHtml || ''
  };
}

// 버튼/링크 텍스트로 엘리먼트 클릭
function clickByText(selectors, text) {
  const lower = text.toLowerCase();
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      if ((el.innerText || '').trim().toLowerCase().includes(lower)) {
        el.click();
        return true;
      }
    }
  }
  return false;
}

// 특정 시간동안 조건 만족할 때까지 기다리는 헬퍼
function waitFor(selector, timeout = 5000) {
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

// 실제 포스팅 로직
async function runPostingForFile(fileIndex, file) {
  try {
    console.log('[Tistory Auto Poster] Start posting for file:', file.name);

    const newPostBtn = await waitFor('a.link_tab[href$="/manage/newpost"]');
    if (!newPostBtn) {
        throw new Error('글쓰기 버튼을 찾을 수 없습니다.');
    }
    newPostBtn.click();
    await new Promise(r => setTimeout(r, 3000));

    // HTML Block 입력
    const moreBtn = document.querySelector('button#more-plugin-btn-open');
    moreBtn.click();
    const htmlBlockBtn = await waitFor('div#plugin-html-block', 1000);
    htmlBlockBtn.click();

    const htmlTextArea = await waitFor('div.mce-codeblock-content div.CodeMirror textarea');
    const submitBtn = document.querySelector('div.mce-codeblock-btn-submit button');

    htmlTextArea.value = file.content;
    htmlTextArea.dispatchEvent(new Event('input', { bubbles: true }));
    
    await new Promise(r => setTimeout(r, 100));

    submitBtn.click();

    // 2) 글쓰기 에디터 화면에서 제목과 본문 입력
    const titleInput = waitFor('textarea#post-title-inp');
    if (!titleInput) {
        throw new Error('제목 입력 필드를 찾을 수 없습니다.');
    }

    const editorInstance = window.tinymice && window.tinymce.get('editor-tistory');
    if (!editorInstance) {
        throw new Error('본문 입력 영역을 찾을 수 없습니다.');
    }

    // HTML 내용 파싱
    const { title, bodyHtml } = splitHtmlToTitleAndBody(file.content);

    // 제목, 본문 입력
    titleInput.value = title;
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    editorInstance.setContent(currentContent + bodyHtml);
    editorInstance.fire('change');
    await new Promise(r => setTimeout(r, 200));

    const completeBtn = document.querySelector('button#publish-layer-btn');
    completeBtn.click();

    // 공개 라디오, 완료/발행 버튼 클릭
    const openRadio = await waitFor('input#open20');
    const published = document.querySelector('button#publish-btn');

    if (!openRadio) {
      throw new Error('공개 버튼을 찾을 수 없습니다.');
    }
    if (!published) {
      throw new Error('발행/등록 버튼을 찾을 수 없습니다.');
    }

    openRadio.click();
    await new Promise(r => setTimeout(r, 200));

    published.click();

    // 발행 후 서버 처리 시간 고려
    await new Promise(r => setTimeout(r, 3000));

    // 한 파일 작업 완료를 background에 알림
    chrome.runtime.sendMessage({
      type: 'FILE_POSTED',
      fileIndex
    });
  } catch (err) {
    console.error('[Tistory Auto Poster] Error:', err);
    // 에러 발생 시 세션 초기화를 요청
    chrome.runtime.sendMessage({
      type: 'ERROR',
      message: err.message || String(err)
    });
  }
}

// background에서 메시지 수신
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_POSTING_FOR_FILE') {
    runPostingForFile(msg.fileIndex, msg.file);
    sendResponse({ ok: true });
  }
  return true;
});
