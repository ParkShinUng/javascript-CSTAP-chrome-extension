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

    // 1) 필요하다면 메인에서 글쓰기 버튼 클릭 (선택)
    // TODO: 실제 티스토리 구조에 맞게 글쓰기 버튼 셀렉터 조정
    const url = location.href;
    if (/tistory\.com\/?$/.test(url) || /tistory\.com\/manage/.test(url)) {
      const clicked = clickByText(['a', 'button'], '글쓰기');
      if (!clicked) {
        throw new Error('글쓰기 버튼을 찾을 수 없습니다.');
      }
      // 글쓰기 페이지 로딩 대기
      await new Promise(r => setTimeout(r, 4000));
    }

    // 2) 글쓰기 에디터 화면에서 제목과 본문 입력
    // TODO: 제목 입력 필드 셀렉터 조정
    const titleInput =
      document.querySelector('input[placeholder*="제목"]') ||
      document.querySelector('input[aria-label*="제목"]') ||
      document.querySelector('input.title') ||
      document.querySelector('input.textarea_tit');

    if (!titleInput) {
      throw new Error('제목 입력 필드를 찾을 수 없습니다.');
    }

    // TODO: 본문 입력 영역 셀렉터 조정
    let contentEditable =
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('.editor-content') ||
      document.querySelector('#kakao-content') ||
      document.querySelector('.mce-edit-area');

    // 일부 에디터는 iframe 내부에 contenteditable이 있을 수 있음
    if (!contentEditable) {
      const iframe = document.querySelector('iframe');
      if (iframe && iframe.contentDocument) {
        contentEditable =
          iframe.contentDocument.querySelector('[contenteditable="true"]') ||
          iframe.contentDocument.body;
      }
    }

    if (!contentEditable) {
      throw new Error('본문 입력 영역을 찾을 수 없습니다.');
    }

    // HTML 내용 파싱
    const { title, bodyHtml } = splitHtmlToTitleAndBody(file.content);

    // 제목 입력
    titleInput.focus();
    titleInput.value = '';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.value = title;
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 본문 입력 (HTML로 삽입)
    if (contentEditable.isContentEditable) {
      contentEditable.focus();
      // 깨끗하게 비우기
      contentEditable.innerHTML = '';
      // 6, 8 번 요구사항 반영: 첫 줄 제외한 부분을 본문에 HTML로 삽입
      contentEditable.innerHTML = bodyHtml;
    } else {
      // 만약 일반 textarea인 경우
      contentEditable.value = bodyHtml;
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 10) 공개 라디오 버튼 클릭
    // TODO: 티스토리 공개/비공개 영역 구조에 맞게 수정 필요
    let openRadio = document.querySelector('input[type="radio"][value="0"]'); // 예시
    if (!openRadio) {
      // 텍스트 기반으로 클릭
      clickByText(['label', 'span'], '공개');
    } else {
      openRadio.click();
    }

    // 9, 11) 완료/발행 버튼 클릭 (티스토리 구조에 따라 다를 수 있음)
    // 보통 '발행', '등록' 텍스트로 된 버튼
    const published =
      clickByText(['button', 'a'], '발행') ||
      clickByText(['button', 'a'], '등록');

    if (!published) {
      throw new Error('발행/등록 버튼을 찾을 수 없습니다.');
    }

    // 발행 후 서버 처리 시간 고려
    await new Promise(r => setTimeout(r, 5000));

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
