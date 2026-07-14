const closeBtn = document.getElementById('closeBtn');
const savePathInput = document.getElementById('savePathInput');
const browseBtn = document.getElementById('browseBtn');
const saveBtn = document.getElementById('saveBtn');
const pathHistoryList = document.getElementById('pathHistoryList');
const pathHistory = document.getElementById('pathHistory');

let currentConfig = null;

function renderPathHistory() {
  const history = currentConfig.pathHistory || [];
  // 过滤掉当前路径，只显示其他历史路径
  const others = history.filter(p => p !== currentConfig.savePath);
  if (others.length === 0) {
    pathHistory.style.display = 'none';
    return;
  }
  pathHistory.style.display = '';
  pathHistoryList.innerHTML = '';
  others.forEach(p => {
    const item = document.createElement('div');
    item.className = 'path-history-item';
    item.title = p;
    item.textContent = p;
    item.addEventListener('click', () => {
      savePathInput.value = p;
    });
    pathHistoryList.appendChild(item);
  });
}

async function init() {
  currentConfig = await window.electronAPI.getConfig();
  savePathInput.value = currentConfig.savePath;
  renderPathHistory();
}

closeBtn.addEventListener('click', () => {
  window.electronAPI.closeSettings();
});

browseBtn.addEventListener('click', async () => {
  const dir = await window.electronAPI.selectDirectory();
  if (dir) {
    savePathInput.value = dir;
  }
});

saveBtn.addEventListener('click', async () => {
  const newPath = savePathInput.value.trim();
  if (!newPath) {
    alert('请输入保存路径');
    return;
  }
  const result = await window.electronAPI.setSavePath(newPath);
  if (result) {
    alert('设置保存成功！路径：' + newPath);
    window.electronAPI.closeSettings();
  } else {
    alert('设置保存失败，请检查路径是否有效');
  }
});

init();
