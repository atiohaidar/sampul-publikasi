/**
 * Service worker for Springer Cover & Metadata Scraper
 * Handles background download operations and tab management.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Springer Scraper] Extension successfully installed.');
});

const pendingDownloadsById = new Map();
const pendingDownloadsByUrl = new Map();

// Pastikan nama file yang kita tentukan (misal: book-covers/1.pdf) tidak ditimpa
// oleh server header (Content-Disposition) atau MIME handler bawaan Chrome
if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const config = pendingDownloadsById.get(item.id) ||
                   pendingDownloadsByUrl.get(item.url) ||
                   pendingDownloadsByUrl.get(item.finalUrl);

    if (config && config.filename) {
      suggest({
        filename: config.filename,
        conflictAction: config.conflictAction || 'uniquify'
      });
      pendingDownloadsById.delete(item.id);
      pendingDownloadsByUrl.delete(item.url);
      if (item.finalUrl) pendingDownloadsByUrl.delete(item.finalUrl);
      return;
    }

    // Jika diinisiasi oleh ekstensi ini dan memiliki path/filename
    if (item.byExtensionId === chrome.runtime.id && item.filename) {
      suggest({
        filename: item.filename,
        conflictAction: 'uniquify'
      });
      return;
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'DOWNLOAD_FILE') {
    const { url, filename, conflictAction = 'uniquify' } = request;

    if (!url) {
      sendResponse({ success: false, error: 'URL download tidak boleh kosong.' });
      return true;
    }

    pendingDownloadsByUrl.set(url, { filename, conflictAction });

    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        conflictAction: conflictAction,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          pendingDownloadsByUrl.delete(url);
          console.error('[Springer Scraper] Download failed:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          if (downloadId) {
            pendingDownloadsById.set(downloadId, { filename, conflictAction });
          }
          sendResponse({ success: true, downloadId: downloadId });
        }
      }
    );
    return true; // Keep message channel open for async response
  }

  if (request.action === 'OPEN_DASHBOARD') {
    const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
    chrome.tabs.create({ url: dashboardUrl });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'OPEN_POPOUT') {
    const autoParam = request.autostart ? '&autostart=1' : '';
    const popoutUrl = chrome.runtime.getURL(`popup/popup.html?mode=popout${autoParam}`);
    chrome.windows.create({
      url: popoutUrl,
      type: 'popup',
      width: 500,
      height: 740,
      focused: true
    }, (w) => {
      sendResponse({ success: true, windowId: w ? w.id : null });
    });
    return true;
  }

  if (request.action === 'OPEN_SIDE_PANEL') {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.windows.getCurrent((w) => {
        if (w && w.id) {
          chrome.sidePanel.open({ windowId: w.id })
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        } else {
          sendResponse({ success: false, error: 'Tidak dapat menemukan window aktif.' });
        }
      });
    } else {
      sendResponse({ success: false, error: 'Side panel tidak didukung pada versi Chrome ini.' });
    }
    return true;
  }
});
