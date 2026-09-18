/**
 * Scraper Engine for Scopus, Springer, and IEEE Xplore
 * Handles sequential processing via Tab Automator, cover downloading, PDF rendering, and progress reporting.
 */

class SpringerScraperEngine {
  constructor() {
    this.isCancelled = false;
    this.isRunning = false;
    this.results = [];
    this.tabAutomator = new TabAutomator();
  }

  cancel() {
    this.isCancelled = true;
    if (this.tabAutomator) {
      this.tabAutomator.cancel();
    }
  }

  skipCurrent() {
    if (this.tabAutomator) {
      this.tabAutomator.skipCurrent();
    }
  }

  getFailedUrls() {
    return this.results
      .filter(item => item.status && item.status.startsWith('Gagal'))
      .map(item => {
        const url = item.scopusUrl || item.sourceUrl;
        if (item.customId) {
          return `${item.customId}\t${url}`;
        }
        return url;
      })
      .filter(Boolean);
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Start processing a list of Scopus, Springer, or IEEE URLs
   */
  async run({
    urls = [],
    downloadCovers = true,
    subfolder = 'conference-covers',
    namingPattern = 'id_only',
    delayMs = 1500,
    activeTab = true,
    onProgress = () => {},
    onItemSuccess = () => {},
    onItemError = () => {},
    onFinished = () => {}
  }) {
    this.isCancelled = false;
    this.isRunning = true;
    this.results = [];
    this.tabAutomator = new TabAutomator();

    // Filter and clean input URLs / items (supports plain URL or ID + URL pairs)
    const cleanItems = urls
      .map((entry, idx) => {
        if (!entry) return null;
        if (typeof entry === 'object' && entry.url) {
          return {
            id: String(entry.id || (idx + 1)).trim(),
            url: String(entry.url).trim(),
            index: idx + 1
          };
        }
        if (typeof entry === 'string') {
          const str = entry.trim();
          if (!str) return null;

          // Cek format jika ada ID sebelum URL: "1 \t https://..." atau "1, https://..."
          const match = str.match(/^(.*?)(?:[\t,;|]+|\s{2,})(https?:\/\/.+)$/i);
          if (match && match[1].trim()) {
            return {
              id: match[1].trim().replace(/^["']|["']$/g, ''),
              url: match[2].trim(),
              index: idx + 1
            };
          }

          // Cek apakah string adalah URL langsung
          const urlMatch = str.match(/(https?:\/\/[^\s"',]+)/i);
          if (urlMatch) {
            const scopusIdMatch = urlMatch[1].match(/\/publications\/(\d+)/i) || urlMatch[1].match(/eid=2-s2\.0-(\d+)/i);
            return {
              id: scopusIdMatch ? scopusIdMatch[1] : String(idx + 1),
              url: urlMatch[1],
              index: idx + 1
            };
          }
        }
        return null;
      })
      .filter(item => item && /^https?:\/\//i.test(item.url));

    const total = cleanItems.length;
    let successCount = 0;
    let failedCount = 0;

    if (total === 0) {
      this.isRunning = false;
      onFinished({ results: [], successCount: 0, failedCount: 0 });
      return;
    }

    for (let i = 0; i < total; i++) {
      if (this.isCancelled) {
        break;
      }

      const item = cleanItems[i];
      const currentUrl = item.url;
      const currentId = item.id;
      const index = i + 1;

      onProgress({
        index,
        total,
        percent: Math.round(((index - 1) / total) * 100),
        status: `[${index}/${total}] (ID: ${currentId}) Membuka: ${currentUrl}`,
        url: currentUrl
      });

      try {
        // Eksekusi rantai otomatis: Scopus -> Springer / IEEE Xplore / ScienceDirect
        const bookData = await this.tabAutomator.processUrl(currentUrl, {
          activeTab: activeTab,
          onStatus: (statusMsg) => {
            onProgress({
              index,
              total,
              percent: Math.round(((index - 0.5) / total) * 100),
              status: `[${index}/${total}] (ID: ${currentId}) ${statusMsg}`,
              url: currentUrl
            });
          }
        });

        bookData.index = index;
        bookData.id = currentId;
        bookData.customId = currentId;

        // Tentukan folder penyimpanan
        const targetSubfolder = subfolder ? subfolder.replace(/[/\\]+$/, '') : 'covers';

        // ========================================================
        // KASUS 1: IEEE Xplore (Cover adalah Dokumen PDF)
        // ========================================================
        if (bookData.isPdfCover && bookData.coverPdfUrl) {
          const safeId = sanitizeFilename(String(currentId || index), 'item');
          let pdfFilename = '';
          let jpgFilename = '';

          // Jika pola id_only (sesuai ID) atau jika ada input ID, nama file cover langsung dari ID!
          const useIdNaming = (namingPattern === 'id_only' || !namingPattern || (namingPattern === 'title' && currentId));
          if (useIdNaming) {
            pdfFilename = `${safeId}.pdf`;
            jpgFilename = `${safeId}.jpg`;
          } else {
            const baseName = formatCoverFilename(namingPattern, bookData, '');
            const label = sanitizeFilename(bookData.subtitle || 'Cover');
            pdfFilename = `${baseName} - ${label}.pdf`;
            jpgFilename = `${baseName}.jpg`;
          }

          let downloadedCoverName = pdfFilename;

          if (downloadCovers) {
            // 1. Download berkas PDF Cover asli (dinamai sesuai ID)
            if (bookData.coverPdfUrl) {
              onProgress({
                index,
                total,
                percent: Math.round(((index - 0.3) / total) * 100),
                status: `[${index}/${total}] Mengunduh berkas PDF cover (${pdfFilename})...`,
                url: currentUrl
              });
              await this.triggerDownload(bookData.coverPdfUrl, `${targetSubfolder}/${pdfFilename}`);
            }

            // 2. Coba render halaman 1 PDF menjadi JPG dengan nama yang sama sesuai ID
            if (typeof renderPdfPageToJpeg === 'function' && bookData.coverPdfUrl) {
              try {
                onProgress({
                  index,
                  total,
                  percent: Math.round(((index - 0.15) / total) * 100),
                  status: `[${index}/${total}] Merender cover PDF ke gambar JPG (${jpgFilename})...`,
                  url: currentUrl
                });

                const jpgDataUrl = await renderPdfPageToJpeg(bookData.coverPdfUrl, { scale: 1.8, timeoutMs: 8000 });
                if (jpgDataUrl) {
                  await this.triggerDownload(jpgDataUrl, `${targetSubfolder}/${jpgFilename}`);
                  bookData.coverThumbnailUrl = jpgDataUrl;
                  downloadedCoverName = (namingPattern === 'id_only') ? pdfFilename : `${jpgFilename} & ${pdfFilename}`;
                }
              } catch (renderErr) {
                console.warn('[Scraper] Melewati render JPG (file PDF cover utama tetap terunduh):', renderErr.message);
              }
            }
          }

          bookData.coverFilename = downloadedCoverName;
        } 
        // ========================================================
        // KASUS 2: Gambar Cover (Springer JPG/WebP, Elsevier GIF/JPG)
        // ========================================================
        else {
          let ext = '.jpg';
          if (bookData.coverUrl) {
            const match = bookData.coverUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
            if (match) {
              ext = '.' + match[1].toLowerCase();
            }
          }

          let coverFilename = '';
          const useIdNamingImg = (namingPattern === 'id_only' || !namingPattern || (namingPattern === 'title' && currentId));
          if (useIdNamingImg) {
            const safeId = sanitizeFilename(String(currentId || index), 'item');
            coverFilename = `${safeId}${ext}`;
          } else {
            coverFilename = formatCoverFilename(namingPattern, bookData, ext);
          }
          bookData.coverFilename = coverFilename;

          if (downloadCovers && bookData.coverUrl) {
            await this.triggerDownload(bookData.coverUrl, `${targetSubfolder}/${coverFilename}`);
          }
        }

        bookData.status = 'Success';
        this.results.push(bookData);
        successCount++;
        onItemSuccess(bookData);

      } catch (err) {
        console.error(`Error processing ${currentUrl}:`, err);
        const failedItem = {
          index,
          id: currentId,
          customId: currentId,
          title: 'Gagal Diambil',
          chapterTitle: '',
          subtitle: '',
          coverUrl: '',
          coverFilename: namingPattern === 'id_only' ? `${sanitizeFilename(String(currentId))}.(failed)` : '',
          isbn: '',
          doi: '',
          year: '',
          editors: '',
          series: '',
          publisher: '',
          scopusUrl: currentUrl,
          sourceUrl: currentUrl,
          status: `Gagal: ${err.message || err}`
        };
        this.results.push(failedItem);
        failedCount++;
        onItemError(failedItem, err);
      }

      // Jeda antar request
      if (i < total - 1 && delayMs > 0 && !this.isCancelled) {
        onProgress({
          index,
          total,
          percent: Math.round((index / total) * 100),
          status: `Jeda ${delayMs / 1000}s sebelum link berikutnya...`,
          url: currentUrl
        });
        await this.sleep(delayMs);
      }
    }

    this.isRunning = false;
    onFinished({
      results: this.results,
      successCount,
      failedCount,
      wasCancelled: this.isCancelled
    });
  }

  async triggerDownload(url, filename) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_FILE',
            url: url,
            filename: filename,
            conflictAction: 'uniquify'
          },
          (response) => {
            resolve(response);
          }
        );
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve({ success: true });
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpringerScraperEngine };
} else if (typeof window !== 'undefined') {
  window.SpringerScraperEngine = SpringerScraperEngine;
}
