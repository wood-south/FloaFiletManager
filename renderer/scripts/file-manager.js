const closeBtn = document.getElementById('closeBtn');
const searchInput = document.getElementById('searchInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadDropdownBtn = document.getElementById('uploadDropdownBtn');
const uploadDropdownMenu = document.getElementById('uploadDropdownMenu');
const uploadDropdownItems = document.querySelectorAll('.upload-dropdown-item');
const backBtn = document.getElementById('backBtn');
const fileList = document.getElementById('fileList');
const emptyState = document.getElementById('emptyState');
const emptyText = document.getElementById('emptyText');
const pathText = document.getElementById('pathText');
const fileCount = document.getElementById('fileCount');
const openFolderBtn = document.getElementById('openFolderBtn');
const dropZone = document.getElementById('dropZone');
const fmPanel = document.getElementById('fmPanel');
const modalOverlay = document.getElementById('modalOverlay');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalButtons = document.getElementById('modalButtons');
const viewBtns = document.querySelectorAll('.view-btn');

let currentFiles = [];
let currentPath = '';
let searchTimeout = null;
let rootPath = '';
let pathHistory = [];

// 自定义模态框
const ICONS = {
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
};

function showModal({ type = 'question', title, message, buttons }) {
  return new Promise((resolve) => {
    modalIcon.className = 'modal-icon ' + type;
    modalIcon.innerHTML = ICONS[type] || ICONS.question;
    modalTitle.textContent = title || '';
    modalMessage.textContent = message || '';
    modalButtons.innerHTML = '';

    buttons.forEach((btn, index) => {
      const el = document.createElement('button');
      el.className = 'modal-btn ' + (btn.style || 'secondary');
      el.textContent = btn.text;
      el.onclick = () => {
        modalOverlay.classList.remove('active');
        resolve(index);
      };
      modalButtons.appendChild(el);
    });

    modalOverlay.classList.add('active');
  });
}
let currentView = 'list';
const iconDataUrlCache = new Map();
const iconLoadQueue = [];
let iconLoadTimer = null;
let iconLoading = false;

function processIconQueue() {
  if (iconLoading || iconLoadQueue.length === 0) return;
  iconLoading = true;
  const seen = new Set();
  const batch = [];
  while (batch.length < 3 && iconLoadQueue.length > 0) {
    const item = iconLoadQueue.shift();
    if (seen.has(item.iconKey)) continue;
    if (iconDataUrlCache.has(item.iconKey)) {
      const cached = iconDataUrlCache.get(item.iconKey);
      if (cached && item.iconEl && item.iconEl.isConnected) {
        item.iconEl.innerHTML = `<img src="${cached}" alt="">`;
        item.iconEl.style.background = 'transparent';
      }
      continue;
    }
    seen.add(item.iconKey);
    batch.push(item);
  }
  if (batch.length === 0) {
    iconLoading = false;
    if (iconLoadQueue.length > 0) processIconQueue();
    return;
  }
  batch.forEach(item => {
    if (item.iconEl && item.iconEl.isConnected) {
      item.iconEl.classList.add('loading');
    }
  });
  const promises = batch.map(item =>
    window.electronAPI.getFileIcon(item.filePath, false).then(dataUrl => {
      if (dataUrl) {
        iconDataUrlCache.set(item.iconKey, dataUrl);
        if (item.iconEl && item.iconEl.isConnected) {
          item.iconEl.innerHTML = `<img src="${dataUrl}" alt="">`;
          item.iconEl.style.background = 'transparent';
          item.iconEl.classList.remove('loading');
        }
      }
    })
  );
  Promise.all(promises).finally(() => {
    iconLoading = false;
    if (iconLoadQueue.length > 0) {
      setTimeout(processIconQueue, 50);
    }
  });
}

function scheduleIconLoad() {
  if (iconLoadQueue.length === 0) return;
  if (iconLoadTimer) clearTimeout(iconLoadTimer);
  iconLoadTimer = null;
  processIconQueue();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const day = 24 * 60 * 60 * 1000;

  if (diff < day) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return '刚刚';
    return `${hours}小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)}天前`;
  } else {
    return date.toLocaleDateString('zh-CN');
  }
}

function getFileIcon(name, isDirectory, targetIsDirectory) {
  if (isDirectory) {
    return `<div class="file-icon folder">
      <svg viewBox="0 0 24 24">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="#f59e0b"/>
        <path d="M22 18H10" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2h-8l-2-2z" fill="none" stroke="#d97706" stroke-width="1.5"/>
      </svg>
    </div>`;
  }

  const ext = name.split('.').pop().toLowerCase();

  if (ext === 'lnk') {
    if (targetIsDirectory) {
      return `<div class="file-icon folder-link">
        <svg viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="#f59e0b"/>
          <path d="M22 18H10" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2h-8l-2-2z" fill="none" stroke="#d97706" stroke-width="1.5"/>
          <circle cx="18" cy="6" r="2" fill="#3b82f6"/>
        </svg>
      </div>`;
    }
    return `<div class="file-icon lnk">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 7h-4v2h4c1.65 0 3 1.35 3 3s-1.35 3-3 3h-4v2h4c2.76 0 5-2.24 5-5s-2.24-5-5-5zM7 15h4v-2H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h4V5H7c-2.76 0-5 2.24-5 5s2.24 5 5 5z"></path>
        <path d="M8 11h8v2H8z"></path>
      </svg>
    </div>`;
  }

  if (ext === 'url') {
    return `<div class="file-icon url">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM18.92 8h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.91-4.33-3.56zm2.95-8H5.08c.96-1.65 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"></path>
      </svg>
    </div>`;
  }

  let color = '#667eea';

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
    color = '#f59e0b';
  } else if (['mp4', 'avi', 'mov', 'wmv', 'mkv'].includes(ext)) {
    color = '#ef4444';
  } else if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) {
    color = '#10b981';
  } else if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) {
    color = '#3b82f6';
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    color = '#8b5cf6';
  }

  return `<div class="file-icon" style="background: ${color}15;">
    <svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
  </div>`;
}

function renderFiles(files) {
  currentFiles = files;
  fileList.innerHTML = '';

  if (currentView === 'grid') {
    fileList.classList.add('grid-view');
  } else {
    fileList.classList.remove('grid-view');
  }

  if (files.length === 0) {
    emptyState.classList.add('active');
    fileCount.textContent = '0 个文件';
    return;
  }

  emptyState.classList.remove('active');

  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  const frag = document.createDocumentFragment();
  sorted.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.path = file.path;
    item.innerHTML = `
      ${getFileIcon(file.name, file.isDirectory, file.targetIsDirectory)}
      <div class="file-info">
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-meta">
          <span>${file.isDirectory ? '文件夹' : formatFileSize(file.size)}</span>
          <span>${formatDate(file.mtime)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-action-btn" title="打开位置" data-action="locate" data-path="${file.path}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>
        ${!file.isDirectory ? `
        <button class="file-action-btn" title="打开文件" data-action="open" data-path="${file.path}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>` : ''}
        <button class="file-action-btn delete-btn" title="删除" data-action="delete" data-path="${file.path}" data-name="${file.name}" data-isdir="${file.isDirectory}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6M14 11v6"></path>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    item.addEventListener('dblclick', (e) => {
      if (file.isDirectory) {
        loadFiles(file.path);
      } else {
        window.electronAPI.openFile(file.path);
      }
    });

    const locateBtn = item.querySelector('[data-action="locate"]');
    if (locateBtn) {
      locateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.openFileLocation(file.path);
      });
    }

    const openBtn = item.querySelector('[data-action="open"]');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.electronAPI.openFile(file.path);
      });
    }

    const deleteBtn = item.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const typeText = file.isDirectory ? '文件夹' : '文件';
        const choice = await showModal({
          type: 'warning',
          title: `删除${typeText}`,
          message: `确定要将 "${file.name}" 移到回收站吗？`,
          buttons: [
            { text: '删除', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });
        if (choice === 0) {
          const result = await window.electronAPI.deleteFile(file.path);
          if (result.success) {
            loadFiles(currentPath, false);
          } else {
            await showModal({
              type: 'error',
              title: '删除失败',
              message: result.error,
              buttons: [{ text: '确定', style: 'primary' }]
            });
          }
        }
      });
    }

    frag.appendChild(item);

    if (!file.isDirectory) {
      const iconKey = file.name.toLowerCase().endsWith('.lnk') || file.name.toLowerCase().endsWith('.url') 
        ? file.path.toLowerCase() 
        : (file.name.split('.').pop() || '').toLowerCase();
      const iconEl = item.querySelector('.file-icon');
      if (iconDataUrlCache.has(iconKey)) {
        const dataUrl = iconDataUrlCache.get(iconKey);
        if (dataUrl) {
          iconEl.innerHTML = `<img src="${dataUrl}" alt="">`;
          iconEl.style.background = 'transparent';
        } else {
          iconLoadQueue.push({ iconKey, filePath: file.path, iconEl });
        }
      } else {
        iconLoadQueue.push({ iconKey, filePath: file.path, iconEl });
      }
    }
  });

  fileList.appendChild(frag);

  const dirCount = files.filter(f => f.isDirectory).length;
  const fileCountNum = files.filter(f => !f.isDirectory).length;
  let countText = '';
  if (dirCount > 0) countText += `${dirCount} 个文件夹`;
  if (fileCountNum > 0) countText += (countText ? '，' : '') + `${fileCountNum} 个文件`;
  fileCount.textContent = countText || '0 个文件';
  scheduleIconLoad();
}

async function loadFiles(dirPath, addToHistory = true) {
  const result = await window.electronAPI.listFiles(dirPath);
  if (result.success) {
    if (addToHistory && currentPath && currentPath !== result.currentPath) {
      pathHistory.push(currentPath);
    }
    if (!rootPath) {
      rootPath = result.currentPath;
    }
    currentPath = result.currentPath;
    pathText.textContent = currentPath;
    updateBackButton();
    renderFiles(result.files);
  } else {
    fileList.innerHTML = '';
    emptyState.classList.add('active');
    emptyText.textContent = '加载失败：' + result.error;
  }
}

function updateBackButton() {
  if (currentPath && rootPath && currentPath !== rootPath) {
    backBtn.classList.add('active');
  } else {
    backBtn.classList.remove('active');
  }
}

function goBack() {
  if (pathHistory.length > 0) {
    const prevPath = pathHistory.pop();
    loadFiles(prevPath, false);
  }
}

// 上传文件（带重名检测）
async function uploadFileWithCheck(sourcePath, fileName) {
  const result = await window.electronAPI.uploadFile({ sourcePath, fileName });

  if (result.duplicate) {
    const choice = await showModal({
      type: 'question',
      title: '文件已存在',
      message: `"${fileName}" 已存在，是否覆盖？`,
      buttons: [
        { text: '覆盖', style: 'danger' },
        { text: '取消', style: 'secondary' }
      ]
    });

    if (choice === 0) {
      const overwriteResult = await window.electronAPI.uploadFile({
        sourcePath,
        fileName,
        overwrite: true
      });
      return overwriteResult.success;
    }
    return false;
  }

  return result.success;
}

async function doSearch(keyword) {
  if (!keyword.trim()) {
    loadFiles(currentPath, false);
    return;
  }

  const result = await window.electronAPI.searchFiles(keyword.trim());
  if (result.success) {
    pathText.textContent = `搜索结果: "${keyword}"`;
    backBtn.classList.remove('active');
    renderFiles(result.files);
    emptyText.textContent = '未找到匹配的文件';
  }
}

searchInput.addEventListener('input', (e) => {
  const keyword = e.target.value;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    doSearch(keyword);
  }, 300);
});

closeBtn.addEventListener('click', () => {
  window.electronAPI.closeFileManager();
});

uploadBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = e.target.files;
    let successCount = 0;
    for (const file of files) {
      const ok = await uploadFileWithCheck(file.path, file.name);
      if (ok) successCount++;
    }
    if (successCount > 0) {
      loadFiles(currentPath, false);
    }
  };
  input.click();
});

// 上传下拉菜单
uploadDropdownBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  uploadDropdownMenu.classList.toggle('active');
});

uploadDropdownItems.forEach(item => {
  item.addEventListener('click', async () => {
    uploadDropdownMenu.classList.remove('active');
    const action = item.dataset.action;
    
    if (action === 'file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async (e) => {
        const files = e.target.files;
        let successCount = 0;
        for (const file of files) {
          const ok = await uploadFileWithCheck(file.path, file.name);
          if (ok) successCount++;
        }
        if (successCount > 0) {
          loadFiles(currentPath, false);
        }
      };
      input.click();
    } else if (action === 'folder') {
      const result = await window.electronAPI.selectDirectory();
      if (!result) return;

      const folderName = result.split(/[\\/]/).pop();
      const uploadResult = await window.electronAPI.uploadFolder(result);

      if (uploadResult.duplicate) {
        const choice = await showModal({
          type: 'question',
          title: '文件夹已存在',
          message: `"${folderName}" 已存在，是否覆盖？`,
          buttons: [
            { text: '覆盖', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });

        if (choice === 0) {
          const deleteResult = await window.electronAPI.deleteFile(uploadResult.destPath);
          if (deleteResult.success) {
            const retryResult = await window.electronAPI.uploadFolder(result);
            if (retryResult.success) {
              loadFiles(currentPath, false);
            } else {
              await showModal({
                type: 'error',
                title: '上传失败',
                message: retryResult.error,
                buttons: [{ text: '确定', style: 'primary' }]
              });
            }
          }
        }
      } else if (uploadResult.success) {
        loadFiles(currentPath, false);
      } else {
        await showModal({
          type: 'error',
          title: '上传失败',
          message: uploadResult.error,
          buttons: [{ text: '确定', style: 'primary' }]
        });
      }
    }
  });
});

// 点击其他地方关闭下拉菜单
document.addEventListener('click', (e) => {
  if (!uploadDropdownMenu.contains(e.target) && e.target !== uploadDropdownBtn) {
    uploadDropdownMenu.classList.remove('active');
  }
});

// 返回按钮
backBtn.addEventListener('click', () => {
  goBack();
});

openFolderBtn.addEventListener('click', () => {
  if (currentPath) {
    window.electronAPI.openFileLocation(currentPath);
  }
});

fmPanel.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('active');
});

fmPanel.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('active');
});

fmPanel.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.target === fmPanel || e.target === dropZone) {
    dropZone.classList.remove('active');
  }
});

fmPanel.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('active');

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  let successCount = 0;
  for (const file of files) {
    const isDirectory = await window.electronAPI.isDirectory(file.path);
    
    if (isDirectory) {
      // 上传文件夹
      const folderName = file.name;
      const uploadResult = await window.electronAPI.uploadFolder(file.path);
      
      if (uploadResult.duplicate) {
        const choice = await showModal({
          type: 'question',
          title: '文件夹已存在',
          message: `"${folderName}" 已存在，是否覆盖？`,
          buttons: [
            { text: '覆盖', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });

        if (choice === 0) {
          const deleteResult = await window.electronAPI.deleteFile(uploadResult.destPath);
          if (deleteResult.success) {
            const retryResult = await window.electronAPI.uploadFolder(file.path);
            if (retryResult.success) successCount++;
          }
        }
      } else if (uploadResult.success) {
        successCount++;
      }
    } else {
      // 上传文件
      const ok = await uploadFileWithCheck(file.path, file.name);
      if (ok) successCount++;
    }
  }

  if (successCount > 0) {
    loadFiles(currentPath, false);
  }
});

window.electronAPI.onFocusSearch(() => {
  searchInput.focus();
  searchInput.select();
});

viewBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view === currentView) return;
    currentView = view;
    viewBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFiles(currentFiles);
  });
});

window.electronAPI.onIconUpdated((data) => {
  const { filePath, iconDataUrl } = data;
  const iconKey = filePath.toLowerCase();
  iconDataUrlCache.set(iconKey, iconDataUrl);
  // 更新所有匹配的文件图标
  const items = document.querySelectorAll('.file-item');
  items.forEach(item => {
    const dataPath = item.dataset.path;
    if (dataPath && dataPath.toLowerCase() === iconKey) {
      const iconEl = item.querySelector('.file-icon');
      if (iconEl) {
        iconEl.innerHTML = `<img src="${iconDataUrl}" alt="">`;
        iconEl.style.background = 'transparent';
      }
    }
  });
});

loadFiles();
