// popup.js

let loadedFiles = []; // { name, content } 배열

const fileInput     = document.getElementById('fileInput');
const dropZone      = document.getElementById('dropZone');
const fileListEl    = document.getElementById('fileList');
const uploadInfoEl  = document.getElementById('uploadInfo');
const startBtn      = document.getElementById('startBtn');
const statusMsg     = document.getElementById('statusMsg');
const progressInner = document.getElementById('progressInner');

function setStatus(message, type = '') {
  statusMsg.textContent = message;
  statusMsg.className = 'status ' + type;
}

function resetProgress() {
  progressInner.style.width = '0%';
}

function setProgress(percent) {
  progressInner.style.width = `${percent}%`;
}

// 파일 리스트 UI 업데이트
function renderFileList() {
  if (!loadedFiles.length) {
    fileListEl.textContent = 'HTML 파일을 선택하세요.';
    uploadInfoEl.textContent = '아직 업로드된 파일이 없습니다.';
    return;
  }

  fileListEl.innerHTML = '';
  loadedFiles.forEach((f, idx) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = `${idx + 1}. ${f.name}`;
    fileListEl.appendChild(div);
  });

  uploadInfoEl.textContent = `총 ${loadedFiles.length}개의 HTML 파일이 준비되었습니다.`;
}

// HTML / HTM 파일만 필터링
function filterHtmlFiles(fileList) {
  const files = Array.from(fileList || []);
  const htmlFiles = files.filter(f => /\.html?$/i.test(f.name));
  const invalidCount = files.length - htmlFiles.length;
  return { htmlFiles, invalidCount, total: files.length };
}

// 실제 파일 읽기 + storage 저장
async function handleFiles(fileList) {
  const { htmlFiles, invalidCount, total } = filterHtmlFiles(fileList);

  if (total === 0) {
    setStatus('선택된 파일이 없습니다. HTML 파일을 선택해주세요.', 'error');
    return;
  }

  if (htmlFiles.length === 0) {
    setStatus('HTML(.html, .htm) 확장자의 파일만 업로드할 수 있습니다.', 'error');
    return;
  }

  if (invalidCount > 0) {
    setStatus(`총 ${total}개 중 ${invalidCount}개는 HTML이 아니라서 제외되었습니다.`, 'error');
  } else {
    setStatus('파일 내용을 읽는 중...', '');
  }

  loadedFiles = [];
  resetProgress();

  const totalHtml = htmlFiles.length;

  for (let i = 0; i < totalHtml; i++) {
    const file = htmlFiles[i];
    const text = await file.text();
    loadedFiles.push({ name: file.name, content: text });

    // 진행률 업데이트
    const percent = Math.round(((i + 1) / totalHtml) * 100);
    setProgress(percent);
  }

  renderFileList();

  // storage 저장
  chrome.storage.local.set({
    tistoryAutoPosterFiles: loadedFiles,
    tistoryAutoPosterSession: {
      isRunning: false,
      currentIndex: 0
    }
  }, () => {
    setStatus(`${loadedFiles.length}개의 HTML 파일을 불러왔습니다.`, 'success');
  });
}

/* ---------- 파일 선택 이벤트 (클릭으로 업로드) ---------- */
dropZone.addEventListener('click', () => {
  fileInput.click();
});

// input으로 선택된 파일 처리
fileInput.addEventListener('change', async (e) => {
  await handleFiles(e.target.files);
  // 같은 파일 다시 선택해도 change 이벤트가 발생하도록 value 초기화
  e.target.value = '';
});


/* ---------- 드래그 & 드롭 업로드 ---------- */
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('hover');
  });
});

['dragleave', 'dragend', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (eventName !== 'drop') {
      dropZone.classList.remove('hover');
    }
  });
});

dropZone.addEventListener('drop', async (e) => {
  dropZone.classList.remove('hover');
  const dt = e.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) {
    setStatus('드롭된 파일이 없습니다. 다시 시도해주세요.', 'error');
    return;
  }
  await handleFiles(dt.files);
});


/* ---------- 자동 포스팅 시작 ---------- */
startBtn.addEventListener('click', () => {
  if (!loadedFiles.length) {
    setStatus('먼저 HTML 파일을 업로드 하세요.', 'error');
    return;
  }

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


/* ---------- background에서 오는 에러/상태 메시지 ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'POSTING_ERROR') {
    setStatus('오류로 인해 작업이 중단되었습니다: ' + (msg.message || ''), 'error');
  }
  if (msg.type === 'POSTING_DONE') {
    setStatus('모든 HTML 파일 발행을 완료했습니다.', 'success');
  }
});
