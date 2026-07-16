const closeBtn = document.getElementById('closeBtn');
const searchInput = document.getElementById('searchInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadDropdownBtn = document.getElementById('uploadDropdownBtn');
const uploadDropdownMenu = document.getElementById('uploadDropdownMenu');
const uploadDropdownItems = document.querySelectorAll('.upload-dropdown-item');
const backBtn = document.getElementById('backBtn');
const fileList = document.getElementById('fileList');
const fmBody = document.getElementById('fmBody');
const emptyState = document.getElementById('emptyState');
const emptyText = document.getElementById('emptyText');
const pathText = document.getElementById('pathText');
const fileCount = document.getElementById('fileCount');
const deleteBtn = document.getElementById('deleteBtn');
const fmPanel = document.getElementById('fmPanel');
const modalOverlay = document.getElementById('modalOverlay');
const modalIcon = document.getElementById('modalIcon');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalInput = document.getElementById('modalInput');
const modalButtons = document.getElementById('modalButtons');
const viewBtns = document.querySelectorAll('.view-btn');

let currentFiles = [];
let currentPath = '';
let searchTimeout = null;

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
    modalInput.style.display = 'none';
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

function showInputModal({ type = 'question', title, message, defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    modalIcon.className = 'modal-icon ' + type;
    modalIcon.innerHTML = ICONS[type] || ICONS.question;
    modalTitle.textContent = title || '';
    modalMessage.textContent = message || '';
    modalInput.value = defaultValue || '';
    modalInput.placeholder = placeholder || '';
    modalInput.style.display = 'block';
    modalButtons.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn secondary';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = () => {
      modalOverlay.classList.remove('active');
      resolve(null);
    };
    modalButtons.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'modal-btn primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => {
      const val = modalInput.value.trim();
      modalOverlay.classList.remove('active');
      resolve(val || null);
    };
    modalButtons.appendChild(confirmBtn);

    modalOverlay.classList.add('active');
    setTimeout(() => modalInput.focus(), 50);

    const handleKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = modalInput.value.trim();
        modalOverlay.classList.remove('active');
        modalInput.removeEventListener('keydown', handleKey);
        resolve(val || null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        modalOverlay.classList.remove('active');
        modalInput.removeEventListener('keydown', handleKey);
        resolve(null);
      }
    };
    modalInput.addEventListener('keydown', handleKey);
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
  
  iconLoadQueue.length = 0;
  iconLoading = false;

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

    item.addEventListener('click', (e) => {
      if (e.target.closest('.file-action-btn')) return;
      item.classList.toggle('selected');
      updateDeleteBtnState();
    });

    // 原生拖拽：mousedown + mousemove 触发 startDrag，支持拖出到桌面/资源管理器
    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.file-action-btn')) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;

      const onMove = (ev) => {
        if (dragStarted) return;
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        dragStarted = true;
        cleanup();
        // 获取图标 dataUrl
        const iconImg = item.querySelector('.file-icon img');
        const iconDataUrl = iconImg ? iconImg.src : null;
        item.classList.add('dragging');
        window.electronAPI.startDrag(file.path, iconDataUrl).then(() => {
          item.classList.remove('dragging');
        });
      };

      const onUp = () => cleanup();
      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    item.addEventListener('dragover', (e) => {
      // 文件夹接受所有拖放，文件项仅接受外部文件
      if (file.isDirectory || e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move';
        if (file.isDirectory) {
          item.classList.add('drop-target');
        }
      }
    });

    item.addEventListener('dragleave', (e) => {
      item.classList.remove('drop-target');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drop-target');

      if (!file.isDirectory) return;

      // 外部文件拖放 → 上传到该文件夹
      if (e.dataTransfer.files.length > 0) {
        const externalFiles = e.dataTransfer.files;
        let successCount = 0;
        for (const extFile of externalFiles) {
          const isDir = await window.electronAPI.isDirectory(extFile.path);
          if (isDir) {
            const uploadResult = await window.electronAPI.uploadFolder({ sourceFolder: extFile.path, destDir: file.path });
            if (uploadResult.duplicate) {
              const choice = await showModal({
                type: 'question',
                title: '文件夹已存在',
                message: `"${extFile.name}" 已存在，是否覆盖？`,
                buttons: [
                  { text: '覆盖', style: 'danger' },
                  { text: '取消', style: 'secondary' }
                ]
              });
              if (choice === 0) {
                await window.electronAPI.deleteFile(uploadResult.destPath);
                const retry = await window.electronAPI.uploadFolder({ sourceFolder: extFile.path, destDir: file.path });
                if (retry.success) successCount++;
              }
            } else if (uploadResult.success) {
              successCount++;
            }
          } else {
            const result = await window.electronAPI.uploadFile({ sourcePath: extFile.path, fileName: extFile.name, destDir: file.path });
            if (result.duplicate) {
              const choice = await showModal({
                type: 'question',
                title: '文件已存在',
                message: `"${extFile.name}" 已存在，是否覆盖？`,
                buttons: [
                  { text: '覆盖', style: 'danger' },
                  { text: '取消', style: 'secondary' }
                ]
              });
              if (choice === 0) {
                const overwriteResult = await window.electronAPI.uploadFile({ sourcePath: extFile.path, fileName: extFile.name, overwrite: true, destDir: file.path });
                if (overwriteResult.success) successCount++;
              }
            } else if (result.success) {
              successCount++;
            }
          }
        }
        if (successCount > 0) {
          iconDataUrlCache.clear();
          loadFiles(currentPath, false);
        }
        return;
      }

      // 内部文件拖放 → 移动到该文件夹
      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath || sourcePath === file.path) return;

      const result = await window.electronAPI.moveFile({ sourcePath, destDir: file.path });
      if (result.success) {
        loadFiles(currentPath, false);
      } else if (result.duplicate) {
        const choice = await showModal({
          type: 'question',
          title: '文件已存在',
          message: `"${sourcePath.split(/[\\/]/).pop()}" 已存在，是否覆盖？`,
          buttons: [
            { text: '覆盖', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });
        if (choice === 0) {
          await window.electronAPI.deleteFile(result.destPath);
          const retryResult = await window.electronAPI.moveFile({ sourcePath, destDir: file.path });
          if (retryResult.success) {
            loadFiles(currentPath, false);
          }
        }
      } else {
        await showModal({
          type: 'error',
          title: '移动失败',
          message: result.error,
          buttons: [{ text: '确定', style: 'primary' }]
        });
      }
    });

    frag.appendChild(item);

    if (!file.isDirectory) {
      const iconKey = file.name.toLowerCase().endsWith('.lnk') || file.name.toLowerCase().endsWith('.url') 
        ? file.path.replace(/\\/g, '\\\\').toLowerCase() 
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

async function loadFiles(dirPath) {
  const result = await window.electronAPI.listFiles(dirPath);
  if (result.success) {
    currentPath = result.currentPath;
    pathText.textContent = currentPath;
    updateBackButton();
    updateSidebarActive();
    renderFiles(result.files);
    deleteBtn.disabled = true;
    // 同步当前路径到主进程，供浮窗上传时使用
    if (window.electronAPI.syncCurrentPath) {
      window.electronAPI.syncCurrentPath(currentPath);
    }
  } else {
    fileList.innerHTML = '';
    emptyState.classList.add('active');
    emptyText.textContent = '加载失败：' + result.error;
  }
}

function getParentPath(p) {
  if (!p) return '';
  // 去掉末尾分隔符后取父级
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (idx <= 0) return '';
  // 保留根盘符（如 C:\）
  if (/^[a-zA-Z]:$/.test(trimmed.substring(0, idx))) {
    return trimmed.substring(0, idx) + '\\';
  }
  return trimmed.substring(0, idx);
}

function updateBackButton() {
  // 返回按钮：当前路径有父级目录时启用
  if (currentPath) {
    const parentPath = getParentPath(currentPath);
    if (parentPath && parentPath !== currentPath) {
      backBtn.classList.add('active');
      return;
    }
  }
  backBtn.classList.remove('active');
}

function goBack() {
  if (!currentPath) return;
  const parentPath = getParentPath(currentPath);
  if (parentPath && parentPath !== currentPath) {
    loadFiles(parentPath);
  }
}

// 上传文件（带重名检测）
async function uploadFileWithCheck(sourcePath, fileName) {
  const result = await window.electronAPI.uploadFile({ sourcePath, fileName, destDir: currentPath });

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
        overwrite: true,
        destDir: currentPath
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
      iconDataUrlCache.clear();
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
          iconDataUrlCache.clear();
          loadFiles(currentPath, false);
        }
      };
      input.click();
    } else if (action === 'folder') {
      const result = await window.electronAPI.selectDirectory();
      if (!result) return;

      const folderName = result.split(/[\\/]/).pop();
      const uploadResult = await window.electronAPI.uploadFolder({ sourceFolder: result, destDir: currentPath });

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
            const retryResult = await window.electronAPI.uploadFolder({ sourceFolder: result, destDir: currentPath });
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

// 删除选中文件
function updateDeleteBtnState() {
  const hasSelection = fileList.querySelectorAll('.file-item.selected').length > 0;
  deleteBtn.disabled = !hasSelection;
}

deleteBtn.addEventListener('click', async () => {
  const selectedItems = fileList.querySelectorAll('.file-item.selected');
  if (selectedItems.length === 0) return;

  const paths = Array.from(selectedItems).map(el => el.dataset.path);
  const names = paths.map(p => p.split(/[\\/]/).pop());
  const choice = await showModal({
    type: 'warning',
    title: '删除文件',
    message: `确定要将选中的 ${paths.length} 个文件/文件夹移到回收站吗？\n${names.slice(0, 5).join('、')}${names.length > 5 ? '...' : ''}`,
    buttons: [
      { text: '删除', style: 'danger' },
      { text: '取消', style: 'secondary' }
    ]
  });

  if (choice !== 0) return;

  let successCount = 0;
  let lastError = '';
  for (const p of paths) {
    const result = await window.electronAPI.deleteFile(p);
    if (result.success) {
      successCount++;
    } else {
      lastError = result.error || '未知错误';
    }
  }

  if (successCount > 0) {
    iconDataUrlCache.clear();
    loadFiles(currentPath);
  }
  if (successCount < paths.length) {
    await showModal({
      type: 'error',
      title: '部分删除失败',
      message: `${successCount}/${paths.length} 成功删除。错误：${lastError}`,
      buttons: [{ text: '确定', style: 'primary' }]
    });
  }
});

// 外部文件拖放上传到当前路径（整个文件展示栏区域）
fmBody.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const types = Array.from(e.dataTransfer.types);
  if (types.includes('Files') || types.includes('application/x-moz-file')) {
    e.dataTransfer.dropEffect = 'copy';
  }
});

fmBody.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const types = Array.from(e.dataTransfer.types);
  if (!types.includes('Files') && !types.includes('application/x-moz-file')) return;

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  let successCount = 0;
  for (const file of files) {
    const isDirectory = await window.electronAPI.isDirectory(file.path);

    if (isDirectory) {
      const folderName = file.name;
      const uploadResult = await window.electronAPI.uploadFolder({ sourceFolder: file.path, destDir: currentPath });

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
            const retryResult = await window.electronAPI.uploadFolder({ sourceFolder: file.path, destDir: currentPath });
            if (retryResult.success) successCount++;
          }
        }
      } else if (uploadResult.success) {
        successCount++;
      }
    } else {
      const ok = await uploadFileWithCheck(file.path, file.name);
      if (ok) successCount++;
    }
  }

  if (successCount > 0) {
    iconDataUrlCache.clear();
    loadFiles(currentPath, false);
  }
});

window.electronAPI.onFocusSearch(() => {
  searchInput.focus();
  searchInput.select();
});

// 文件变化时自动刷新（浮窗上传后通知）
window.electronAPI.onFilesChanged((data) => {
  if (data && data.dir) {
    // 如果变化发生在当前路径或其子路径，刷新列表
    const normalizedCurrent = currentPath.replace(/[\\/]+$/, '').toLowerCase();
    const normalizedChanged = data.dir.replace(/[\\/]+$/, '').toLowerCase();
    if (normalizedCurrent === normalizedChanged) {
      iconDataUrlCache.clear();
      loadFiles(currentPath);
    }
  }
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
  const iconKey = filePath.replace(/\\/g, '\\\\').toLowerCase();
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

// ========== 侧边栏分区功能 ==========

const partitionList = document.getElementById('partitionList');
const addPartitionBtn = document.getElementById('addPartitionBtn');
const partitionContextMenu = document.getElementById('partitionContextMenu');
const pathContextMenu = document.getElementById('pathContextMenu');

let partitions = [];
let contextPartitionId = null;
let contextPathIndex = -1;
let preferredPath = '';

const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const STAR_ICON = '<svg class="star-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

async function loadPartitions() {
  try {
    const [parts, pref] = await Promise.all([
      window.electronAPI.getPartitions(),
      window.electronAPI.getPreferredPath()
    ]);
    partitions = parts;
    preferredPath = pref || '';
    renderPartitions();
    return preferredPath;
  } catch (e) {
    console.error('加载分区失败:', e);
    return '';
  }
}

function renderPartitions() {
  partitionList.innerHTML = '';
  partitions.forEach((partition) => {
    const group = document.createElement('div');
    group.className = 'partition-group';
    group.dataset.partitionId = partition.id;

    const header = document.createElement('div');
    header.className = 'partition-header';
    header.dataset.partitionId = partition.id;
    header.innerHTML = `
      <div class="partition-title">
        ${CHEVRON_ICON}
        <span>${partition.name}</span>
      </div>
      <button class="partition-add-btn" title="添加路径">
        ${PLUS_ICON}
      </button>
    `;

    const titleEl = header.querySelector('.partition-title');
    titleEl.addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });

    const addBtn = header.querySelector('.partition-add-btn');
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await addPathToPartition(partition.id);
    });

    // 分区头部接受路径拖放
    header.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-path-item')) {
        e.preventDefault();
        header.classList.add('drag-over');
      }
    });
    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
    });
    header.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('drag-over');
      const data = e.dataTransfer.getData('text/x-path-item');
      if (!data) return;
      const { fromPartitionId, pathIndex } = JSON.parse(data);
      if (fromPartitionId === partition.id) return; // 同分区不处理
      const result = await window.electronAPI.movePathToPartition(fromPartitionId, pathIndex, partition.id);
      if (result.success) {
        loadPartitions();
      } else {
        await showModal({
          type: 'error',
          title: '移动失败',
          message: result.error || '未知错误',
          buttons: [{ text: '确定', style: 'primary' }]
        });
      }
    });

    group.appendChild(header);

    const pathsContainer = document.createElement('div');
    pathsContainer.className = 'partition-paths';

    (partition.paths || []).forEach((item, pathIndex) => {
      const div = document.createElement('div');
      div.className = 'sidebar-item';
      div.dataset.partitionId = partition.id;
      div.dataset.pathIndex = pathIndex;
      div.draggable = true;
      if (item.path.toLowerCase() === (currentPath || '').toLowerCase()) {
        div.classList.add('active');
      }
      const isPreferred = preferredPath && item.path.toLowerCase() === preferredPath.toLowerCase();
      if (isPreferred) {
        div.classList.add('preferred');
      }
      div.innerHTML = `${FOLDER_ICON}<span title="${item.path}">${item.name}</span>${isPreferred ? STAR_ICON : ''}`;
      div.addEventListener('click', () => {
        loadFiles(item.path);
      });
      // 路径项拖拽：携带来源分区ID和路径索引
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-path-item', JSON.stringify({ fromPartitionId: partition.id, pathIndex }));
        e.dataTransfer.effectAllowed = 'move';
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
      });
      pathsContainer.appendChild(div);
    });

    group.appendChild(pathsContainer);
    partitionList.appendChild(group);
  });
}

function updateSidebarActive() {
  const items = partitionList.querySelectorAll('.sidebar-item');
  items.forEach((div) => {
    const partitionId = div.dataset.partitionId;
    const pathIndex = parseInt(div.dataset.pathIndex);
    const partition = partitions.find(p => p.id === partitionId);
    const item = partition && partition.paths && partition.paths[pathIndex];
    if (item && item.path.toLowerCase() === (currentPath || '').toLowerCase()) {
      div.classList.add('active');
    } else {
      div.classList.remove('active');
    }
  });
}

function showContextMenu(menu, x, y) {
  partitionContextMenu.classList.remove('active');
  pathContextMenu.classList.remove('active');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('active');
}

function hideAllContextMenus() {
  partitionContextMenu.classList.remove('active');
  pathContextMenu.classList.remove('active');
  contextPartitionId = null;
  contextPathIndex = -1;
}

async function addPathToPartition(partitionId) {
  const dirPath = await window.electronAPI.selectDirectory();
  if (!dirPath) return;

  const defaultName = dirPath.split(/[\\/]/).filter(Boolean).pop() || dirPath;
  const name = await showInputModal({
    type: 'question',
    title: '添加路径',
    message: '请输入显示名称：',
    defaultValue: defaultName,
    confirmText: '添加',
    cancelText: '取消'
  });
  if (!name) return;

  const result = await window.electronAPI.addPathToPartition(partitionId, name.trim(), dirPath);
  if (result.success) {
    loadPartitions();
  } else {
    await showModal({
      type: 'error',
      title: '添加失败',
      message: result.error || '未知错误',
      buttons: [{ text: '确定', style: 'primary' }]
    });
  }
}

partitionList.addEventListener('contextmenu', (e) => {
  const pathItem = e.target.closest('.sidebar-item');
  const partitionHeader = e.target.closest('.partition-header');
  if (pathItem) {
    e.preventDefault();
    e.stopPropagation();
    contextPartitionId = pathItem.dataset.partitionId;
    contextPathIndex = parseInt(pathItem.dataset.pathIndex);
    showContextMenu(pathContextMenu, e.clientX, e.clientY);
  } else if (partitionHeader) {
    e.preventDefault();
    e.stopPropagation();
    const group = partitionHeader.closest('.partition-group');
    if (group) {
      contextPartitionId = group.dataset.partitionId;
      contextPathIndex = -1;
      showContextMenu(partitionContextMenu, e.clientX, e.clientY);
    }
  }
});

document.addEventListener('click', (e) => {
  const ctxItem = e.target.closest('.ctx-item');
  if (ctxItem) {
    const menu = ctxItem.closest('.sidebar-context-menu');
    if (!menu) return;
    handleContextMenuAction(menu.id, ctxItem.dataset.action);
    return;
  }
  if (!e.target.closest('.sidebar-context-menu') && !e.target.closest('.sidebar-item') && !e.target.closest('.partition-header')) {
    hideAllContextMenus();
  }
});

async function handleContextMenuAction(menuId, action) {
  try {
    const pId = contextPartitionId;
    const pIdx = contextPathIndex;
    hideAllContextMenus();

    if (menuId === 'partitionContextMenu') {
      if (!pId) return;
      const partition = partitions.find(p => p.id === pId);
      if (!partition) return;

      if (action === 'addPath') {
        await addPathToPartition(partition.id);
      } else if (action === 'renamePartition') {
        const newName = await showInputModal({
          type: 'question',
          title: '重命名分区',
          message: '请输入分区新名称：',
          defaultValue: partition.name,
          confirmText: '确定',
          cancelText: '取消'
        });
        if (newName) {
          await window.electronAPI.updatePartition(partition.id, newName);
          loadPartitions();
        }
      } else if (action === 'deletePartition') {
        if (partition.id === 'default') {
          await showModal({
            type: 'warning',
            title: '无法删除',
            message: '默认分区不能删除',
            buttons: [{ text: '确定', style: 'primary' }]
          });
          return;
        }
        const result = await showModal({
          type: 'question',
          title: '删除分区',
          message: `确定要删除分区 "${partition.name}" 吗？该分区下的所有路径也会被移除。`,
          buttons: [
            { text: '删除', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });
        if (result === 0) {
          await window.electronAPI.removePartition(partition.id);
          loadPartitions();
        }
      }
    } else if (menuId === 'pathContextMenu') {
      if (!pId || pIdx < 0) return;
      const partition = partitions.find(p => p.id === pId);
      const pathItem = partition && partition.paths && partition.paths[pIdx];
      if (!pathItem) return;

      if (action === 'setPreferred') {
        const result = await window.electronAPI.setPreferredPath(pathItem.path);
        if (result.success) {
          preferredPath = pathItem.path;
          renderPartitions();
        } else {
          await showModal({
            type: 'error',
            title: '设置失败',
            message: result.error || '未知错误',
            buttons: [{ text: '确定', style: 'primary' }]
          });
        }
      } else if (action === 'renamePath') {
        const newName = await showInputModal({
          type: 'question',
          title: '重命名',
          message: '请输入新名称：',
          defaultValue: pathItem.name,
          confirmText: '确定',
          cancelText: '取消'
        });
        if (newName) {
          await window.electronAPI.updatePartitionPath(pId, pIdx, newName);
          loadPartitions();
        }
      } else if (action === 'removePath') {
        const result = await showModal({
          type: 'question',
          title: '移除路径',
          message: `确定要从分区中移除 "${pathItem.name}" 吗？`,
          buttons: [
            { text: '移除', style: 'danger' },
            { text: '取消', style: 'secondary' }
          ]
        });
        if (result === 0) {
          await window.electronAPI.removePartitionPath(pId, pIdx);
          loadPartitions();
        }
      }
    }
  } catch (err) {
    console.error('右键菜单操作失败:', err);
  }
}

addPartitionBtn.addEventListener('click', async () => {
  const name = await showInputModal({
    type: 'question',
    title: '新建分区',
    message: '请输入分区名称：',
    placeholder: '例如：工作、学习、娱乐',
    confirmText: '创建',
    cancelText: '取消'
  });
  if (!name) return;

  const result = await window.electronAPI.addPartition(name.trim());
  if (result.success) {
    loadPartitions();
  } else {
    await showModal({
      type: 'error',
      title: '创建失败',
      message: result.error || '未知错误',
      buttons: [{ text: '确定', style: 'primary' }]
    });
  }
});

fileList.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('.file-action-btn');
  if (!actionBtn) return;

  e.preventDefault();
  e.stopPropagation();

  const action = actionBtn.dataset.action;
  const filePath = actionBtn.dataset.path;
  if (!filePath) return;

  if (action === 'locate') {
    window.electronAPI.openFileLocation(filePath);
  } else if (action === 'open') {
    window.electronAPI.openFile(filePath);
  }
});

// 初始化加载：先加载分区和首选路径，再加载文件列表
(async function init() {
  const pref = await loadPartitions();
  if (pref) {
    loadFiles(pref);
  } else {
    loadFiles();
  }
})();
