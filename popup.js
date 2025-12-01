// popup.js

let loadedFiles = []; // { name, content } 배열

const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const startBtn = document.getElementById('startBtn');
const statusMsg = document.getElementById('statusMsg');

function setStatus(message, type = '') {
  statusMsg.textContent = message;
  statusMsg.className = 'status ' + type;
}

// 파일 리스트 UI 업데이트
function renderFileList() {
  if (!loadedFiles.length) {
    fileListEl.textContent = 'HTML 파일을 선택하세요.';
    return;
  }
  fileListEl.innerHTML = '';
  loadedFiles.forEach((f, idx) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = `${idx + 1}. ${f.name}`;
    fileListEl.appendChild(div);
  });
}

// 파일 선택 시 읽기
fileInput.addEventListener('click', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) {
    setStatus('선택된 파일이 없습니다.', 'error');
    return;
  }

  loadedFiles = [];
  setStatus('파일 내용을 읽는 중...', '');

  for (const file of files) {
    const text = await file.text();
    loadedFiles.push({ name: file.name, content: text });
  }
  renderFileList();
  chrome.storage.local.set({
    tistoryAutoPosterFiles: loadedFiles,
    tistoryAutoPosterSession: {
      isRunning: false,
      currentIndex: 0
    }
  }, () => {
    setStatus(`${loadedFiles.length}개의 HTML 파일을 불러왔습니다.`, 'success');
  });
});

// 자동 포스팅 시작
startBtn.addEventListener('click', () => {
  if (!loadedFiles.length) {
    setStatus('먼저 HTML 파일을 업로드 하세요.', 'error');
    return;
  }

  // 세션 초기화 후 시작
  chrome.storage.local.set({
    tistoryAutoPosterFiles: loadedFiles,
    tistoryAutoPosterSession: {
      isRunning: true,
      currentIndex: 0
    }
  }, () => {
    chrome.runtime.sendMessage({ type: 'START_POSTING' }, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus('백그라운드와 통신 중 오류가 발생했습니다.', 'error');
        return;
      }
      if (resp && resp.ok) {
        setStatus('자동 포스팅을 시작했습니다. (현재 탭의 티스토리 페이지에서 진행)', 'success');
      } else {
        setStatus('자동 포스팅 시작에 실패했습니다. 티스토리 페이지가 열려 있는지 확인하세요.', 'error');
      }
    });
  });
});

// background에서 오는 에러/상태 메시지 받기
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'POSTING_ERROR') {
    setStatus('오류로 인해 작업이 중단되었습니다: ' + (msg.message || ''), 'error');
  }
  if (msg.type === 'POSTING_DONE') {
    setStatus('모든 HTML 파일 발행을 완료했습니다.', 'success');
  }
});
