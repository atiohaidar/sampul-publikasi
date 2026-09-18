/**
 * utils/tab-automator.js
 * ============================================================
 * Mengotomasi navigasi tab Chrome:
 * 1. Scopus: Cari tombol "Full text" -> Klik -> Ambil link "View at Publisher"
 * 2. Deteksi Publisher:
 *    A. Jika SPRINGER:
 *       - Halaman Chapter -> Ambil link Buku induk di breadcrumb/brand -> Buka Book
 *       - Halaman Book -> Ekstrak metadata & cover resolusi tinggi (cover-hires JPG)
 *    B. Jika IEEE XPLORE:
 *       - Halaman Paper/Document -> Ambil link Conference Proceeding di breadcrumb
 *       - Halaman Proceeding -> Cari item "Front Cover Page" -> Ambil link PDF Cover
 *       - Unduh file PDF cover & render halaman 1 PDF menjadi gambar JPG resolusi tinggi
 * 3. Tutup tab otomatis setelah selesai
 * ============================================================
 */

class TabAutomator {
  constructor() {
    this.isCancelled = false;
    this.isSkipped = false;
    this.currentTabId = null;
  }

  cancel() {
    this.isCancelled = true;
    const tid = this.currentTabId;
    this.currentTabId = null;
    if (tid) {
      this.safeRemoveTab(tid);
    }
  }

  skipCurrent() {
    this.isSkipped = true;
    const tid = this.currentTabId;
    this.currentTabId = null;
    if (tid) {
      this.safeRemoveTab(tid);
    }
  }

  async safeRemoveTab(tabId) {
    if (!tabId) return;
    try {
      const tab = await this.getTab(tabId);
      if (tab) {
        await chrome.tabs.remove(tabId);
      }
    } catch (e) {}
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Menunggu tab selesai dimuat (status === 'complete')
   * Dilengkapi deteksi tab tertutup (onRemoved) agar tidak menggantung jika tab ditutup user
   */
  async waitForTabLoad(tabId, timeoutMs = 28000) {
    return new Promise((resolve) => {
      let isResolved = false;
      const startTime = Date.now();

      const finish = (tab) => {
        if (!isResolved) {
          isResolved = true;
          try {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.onRemoved.removeListener(removeListener);
          } catch (e) {}
          clearInterval(fallbackTimer);
          resolve(tab);
        }
      };

      const listener = (id, changeInfo, tab) => {
        if (id === tabId && changeInfo.status === 'complete') {
          finish(tab);
        }
      };

      const removeListener = (closedTabId) => {
        if (closedTabId === tabId) {
          finish(null); // Tab ditutup, langsung akhiri tanpa menunggu timeout
        }
      };

      try {
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.onRemoved.addListener(removeListener);
      } catch (e) {
        return resolve(null);
      }

      this.getTab(tabId).then((t) => {
        if (!t) {
          finish(null);
        } else if (t.status === 'complete') {
          setTimeout(() => finish(t), 800);
        }
      });

      const fallbackTimer = setInterval(async () => {
        const tab = await this.getTab(tabId);
        if (!tab) {
          finish(null); // Tab sudah tidak ada
        } else if (Date.now() - startTime > timeoutMs) {
          finish(tab);
        }
      }, 500);
    });
  }

  /**
   * Safe wrapper untuk update URL tab
   */
  async updateTabUrl(tabId, url, active = true) {
    const tab = await this.getTab(tabId);
    if (!tab) throw new Error('Tab telah ditutup.');
    try {
      return await chrome.tabs.update(tabId, { url, active });
    } catch (e) {
      if (e.message && e.message.includes('No tab with id')) {
        throw new Error('Tab telah ditutup oleh pengguna atau browser.');
      }
      throw e;
    }
  }

  /**
   * Eksekusi satu rantai alur kerja (Scopus -> Springer / IEEE Xplore / ScienceDirect)
   */
  async processUrl(initialUrl, {
    activeTab = true,
    timeoutMs = 28000,
    onStatus = () => {}
  } = {}) {
    this.isSkipped = false;
    if (this.isCancelled) throw new Error('Dibatalkan');

    let tab = null;
    let paperOrChapterTitle = '';
    let scopusUrl = initialUrl;

    try {
      onStatus(`Membuka tab: ${initialUrl}`);
      tab = await chrome.tabs.create({ url: initialUrl, active: activeTab });
      if (!tab || !tab.id) {
        throw new Error('Gagal membuka tab browser.');
      }

      const tabId = tab.id;
      this.currentTabId = tabId;

      // Tunggu load pertama
      const loadedTab = await this.waitForTabLoad(tabId, timeoutMs);
      if (this.isSkipped) throw new Error('Dilewati oleh pengguna');
      if (this.isCancelled) throw new Error('Dibatalkan');
      if (!loadedTab) {
        throw new Error('Tab ditutup sebelum selesai memuat halaman.');
      }
      await this.sleep(1200);

      let currentTab = await this.getTab(tabId);
      if (!currentTab) {
        throw new Error('Tab telah ditutup.');
      }
      let currentUrl = currentTab.url || initialUrl;

      // ========================================================
      // TAHAP 1: Jika di Scopus (scopus.com)
      // ========================================================
      if (currentUrl.includes('scopus.com')) {
        onStatus('Halaman Scopus: Mencari tombol View at Publisher...');

        const scopusResult = await this.executeInTab(tabId, () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 12000;
            const INTERVAL = 350;
            let elapsed = 0;

            const poll = () => {
              // 1. Buka dropdown menu "Full text" jika ada dan belum terbuka
              const toolbar = document.querySelector('[class*="DocumentToolbar"], .DocumentToolbar_wrapper__Cfual, .document-toolbar');
              const searchScope = toolbar || document;

              const allButtons = Array.from(searchScope.querySelectorAll('button'));
              const fullTextBtn = allButtons.find(btn => {
                const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                return text.includes('full text') && !text.includes('view pdf');
              });

              if (fullTextBtn && fullTextBtn.getAttribute('aria-expanded') !== 'true') {
                fullTextBtn.click();
              }

              // 2. Cari link "View at Publisher"
              // Penting: Abaikan "View PDF" karena kita ingin menuju ke halaman publisher utama
              const allLinks = Array.from(document.querySelectorAll(
                '[class*="DocumentToolbar"] a, [class*="Menu_menu"] a, [role="menu"] a, [class*="Stack_stack"] a, a'
              ));

              const pubLink = allLinks.find(a => {
                const text = (a.innerText || a.textContent || '').trim().toLowerCase();
                const isViewPdf = text.includes('view pdf');
                const isViewPub = text.includes('view at publisher') || (text.includes('view') && text.includes('publisher'));
                return isViewPub && !isViewPdf;
              });

              if (pubLink && pubLink.href && !pubLink.href.startsWith('javascript:')) {
                const titleEl = document.querySelector('h1, h2, .document-title');
                resolve({
                  success: true,
                  publisherUrl: pubLink.href,
                  paperTitle: titleEl ? titleEl.textContent.trim() : ''
                });
                return;
              }

              // 3. Cek link DOI atau publisher langsung di dalam toolbar/menu (bukan di references dokumen)
              const toolbarDoiLink = Array.from(searchScope.querySelectorAll('a')).find(a => {
                if (!a.href) return false;
                const text = (a.innerText || a.textContent || '').toLowerCase();
                if (text.includes('view pdf')) return false;
                return a.href.includes('doi.org/10.') ||
                       a.href.includes('springer.com') ||
                       a.href.includes('ieeexplore.ieee.org') ||
                       a.href.includes('sciencedirect.com') ||
                       a.href.includes('dl.acm.org') ||
                       a.href.includes('acm.org');
              });

              if (toolbarDoiLink) {
                const titleEl = document.querySelector('h1, h2, .document-title');
                resolve({
                  success: true,
                  publisherUrl: toolbarDoiLink.href,
                  paperTitle: titleEl ? titleEl.textContent.trim() : ''
                });
                return;
              }

              elapsed += INTERVAL;
              if (elapsed >= MAX_WAIT) {
                const bodyText = document.body.innerText || '';
                const match = bodyText.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
                if (match) {
                  resolve({
                    success: true,
                    publisherUrl: 'https://doi.org/' + match[0],
                    paperTitle: document.querySelector('h1, h2')?.textContent?.trim() || ''
                  });
                  return;
                }

                resolve({
                  success: false,
                  error: 'Tidak dapat menemukan link View at Publisher di Scopus ini.'
                });
                return;
              }

              setTimeout(poll, INTERVAL);
            };

            poll();
          });
        });

        if (!scopusResult || !scopusResult.success) {
          throw new Error(scopusResult ? scopusResult.error : 'Gagal mengekstrak link publisher dari Scopus.');
        }

        paperOrChapterTitle = scopusResult.paperTitle || '';
        const publisherUrl = scopusResult.publisherUrl;
        onStatus(`Ditemukan Publisher: ${publisherUrl}. Mengarahkan...`);

        await this.updateTabUrl(tabId, publisherUrl, activeTab);
        await this.waitForTabLoad(tabId, timeoutMs);
        await this.sleep(1500);

        currentTab = await this.getTab(tabId);
        currentUrl = (currentTab && currentTab.url) ? currentTab.url : publisherUrl;
      }

      // ========================================================
      // TAHAP 2A: Jika Publisher adalah IEEE XPLORE
      // ========================================================
      if (currentUrl.includes('ieeexplore.ieee.org')) {
        // Jika sedang di halaman Document / Paper IEEE (/document/...)
        if (currentUrl.includes('/document/')) {
          onStatus('Halaman Paper IEEE: Mencari link Conference Proceeding...');

          const ieeeDocResult = await this.executeInTab(tabId, () => {
            return new Promise((resolve) => {
              const MAX_WAIT = 10000;
              const INTERVAL = 300;
              let elapsed = 0;

              const poll = () => {
                const proceedingLink = document.querySelector(
                  '.breadcrumbs a[href*="/proceeding"], .breadcrumbs a[href*="/conhome/"], .document-header a[href*="/conhome/"]'
                );
                if (proceedingLink && proceedingLink.href) {
                  const titleEl = document.querySelector('h1.document-title, .document-title-fix h1');
                  resolve({
                    success: true,
                    proceedingUrl: proceedingLink.href,
                    paperTitle: titleEl ? titleEl.textContent.trim() : ''
                  });
                  return;
                }

                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  resolve({
                    success: false,
                    error: 'Tidak dapat menemukan link Conference Proceeding di halaman IEEE ini.'
                  });
                  return;
                }

                setTimeout(poll, INTERVAL);
              };

              poll();
            });
          });

          if (!ieeeDocResult || !ieeeDocResult.success) {
            throw new Error(ieeeDocResult ? ieeeDocResult.error : 'Gagal menemukan link Proceeding IEEE.');
          }

          if (!paperOrChapterTitle && ieeeDocResult.paperTitle) {
            paperOrChapterTitle = ieeeDocResult.paperTitle;
          }

          const proceedingUrl = ieeeDocResult.proceedingUrl;
          onStatus(`Membuka Conference Proceeding IEEE: ${proceedingUrl}...`);

          await this.updateTabUrl(tabId, proceedingUrl, activeTab);
          await this.waitForTabLoad(tabId, timeoutMs);
          await this.sleep(2000);

          currentTab = await this.getTab(tabId);
          currentUrl = (currentTab && currentTab.url) ? currentTab.url : proceedingUrl;
        }

        // Sekarang kita berada di halaman Conference Proceeding IEEE (/xpl/conhome/.../proceeding)
        onStatus('Halaman Proceeding IEEE: Mencari Front Cover Page & link PDF...');

        const ieeeProceedingData = await this.executeInTab(tabId, () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 12000;
            const INTERVAL = 400;
            let elapsed = 0;

            const poll = () => {
              const items = document.querySelectorAll('xpl-issue-results-items, .result-item, .List-results-items');
              if (items.length === 0) {
                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  resolve({ success: false, error: 'Daftar isi proceeding IEEE belum selesai dimuat.' });
                  return;
                }
                setTimeout(poll, INTERVAL);
                return;
              }

              // Ambil nama conference
              let conferenceName = '';
              const confLink = document.querySelector('.description a[href*="/proceeding"], a.stats-conhome-title');
              if (confLink) {
                conferenceName = confLink.textContent.trim();
              }
              if (!conferenceName) {
                const headerTitle = document.querySelector('h1, title');
                if (headerTitle) {
                  conferenceName = headerTitle.textContent.replace(/\s*\|\s*IEEE.*$/i, '').trim();
                }
              }

              // Ambil tahun
              let year = '';
              const yearMatch = (document.body ? document.body.textContent : '').match(/Publication Year:\s*(\d{4})|Year:\s*(\d{4})/i);
              if (yearMatch) {
                year = yearMatch[1] || yearMatch[2];
              }

              // Cari Cover / Front Matter di daftar proceeding dengan memprioritaskan urutan paling atas
              const getPdfInfo = (item) => {
                const pdfLink = item.querySelector(
                  'a[href*="/stamp/stamp.jsp"], a[aria-label="PDF"], a.stats_PDF_, a[href*="/stampPDF/"], a[href*="getPDF.jsp"]'
                ) || item.querySelector('a[href*="/stamp/"], a[href*="arnumber="]');

                if (!pdfLink) return null;
                const href = pdfLink.getAttribute('href') || '';
                const fullUrl = href.startsWith('http') ? href : ('https://ieeexplore.ieee.org' + (href.startsWith('/') ? '' : '/') + href);
                const arMatch = href.match(/arnumber=(\d+)/);
                const arnumber = arMatch ? arMatch[1] : '';
                const directUrl = arnumber ? `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${arnumber}` : fullUrl;
                return { pdfUrl: fullUrl, directUrl, arnumber };
              };

              let matchedTitle = '';
              let coverPdfUrl = '';
              let coverDirectPdfUrl = '';
              let coverArnumber = '';

              // Prioritas 1: Scan dari urutan PALING ATAS (item 0, 1, 2...) yang mengandung kata "cover"
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const titleEl = item.querySelector('h2, .result-item-title, .title');
                const text = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
                if (text.includes('cover')) {
                  const pdfInfo = getPdfInfo(item);
                  if (pdfInfo) {
                    matchedTitle = titleEl.textContent.trim();
                    coverPdfUrl = pdfInfo.pdfUrl;
                    coverDirectPdfUrl = pdfInfo.directUrl;
                    coverArnumber = pdfInfo.arnumber;
                    break;
                  }
                }
              }

              // Prioritas 2: Jika tidak ada kata "cover", scan dari PALING ATAS untuk kata kunci halaman depan (title page, preliminary, front matter)
              if (!coverPdfUrl) {
                const frontKeywords = ['front matter', 'title page', 'half title', 'preliminar', 'preface'];
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  const titleEl = item.querySelector('h2, .result-item-title, .title');
                  const text = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
                  if (frontKeywords.some(kw => text.includes(kw))) {
                    const pdfInfo = getPdfInfo(item);
                    if (pdfInfo) {
                      matchedTitle = titleEl.textContent.trim();
                      coverPdfUrl = pdfInfo.pdfUrl;
                      coverDirectPdfUrl = pdfInfo.directUrl;
                      coverArnumber = pdfInfo.arnumber;
                      break;
                    }
                  }
                }
              }

              // Prioritas 3 (Fallback): Ambil item PALING ATAS (index 0) yang memiliki link PDF
              if (!coverPdfUrl && items.length > 0) {
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  const pdfInfo = getPdfInfo(item);
                  if (pdfInfo) {
                    const titleEl = item.querySelector('h2, .result-item-title, .title');
                    matchedTitle = titleEl ? titleEl.textContent.trim() : 'Cover';
                    coverPdfUrl = pdfInfo.pdfUrl;
                    coverDirectPdfUrl = pdfInfo.directUrl;
                    coverArnumber = pdfInfo.arnumber;
                    break;
                  }
                }
              }

              resolve({
                success: true,
                conferenceName: conferenceName || 'IEEE Conference Proceeding',
                year: year || '',
                coverTitle: matchedTitle || 'Cover',
                coverPdfUrl: coverPdfUrl,
                coverDirectPdfUrl: coverDirectPdfUrl || coverPdfUrl,
                coverArnumber: coverArnumber
              });
            };

            poll();
          });
        });

        if (!ieeeProceedingData || !ieeeProceedingData.success) {
          throw new Error(ieeeProceedingData ? ieeeProceedingData.error : 'Gagal membaca proceeding IEEE.');
        }

        onStatus(`Ditemukan Cover IEEE: ${ieeeProceedingData.coverTitle}. Menyiapkan unduhan...`);

        return {
          publisherType: 'IEEE',
          title: ieeeProceedingData.conferenceName,
          chapterTitle: paperOrChapterTitle,
          subtitle: ieeeProceedingData.coverTitle,
          coverUrl: ieeeProceedingData.coverDirectPdfUrl || ieeeProceedingData.coverPdfUrl,
          coverPdfUrl: ieeeProceedingData.coverDirectPdfUrl || ieeeProceedingData.coverPdfUrl,
          isPdfCover: true,
          isbn: ieeeProceedingData.coverArnumber ? `IEEE-${ieeeProceedingData.coverArnumber}` : '',
          doi: '',
          year: ieeeProceedingData.year,
          editors: 'IEEE',
          series: 'IEEE Conference Proceedings',
          publisher: 'IEEE',
          scopusUrl: scopusUrl,
          bookUrl: currentUrl,
          sourceUrl: currentUrl
        };
      }

      // ========================================================
      // TAHAP 2B: Jika Publisher adalah SCIENCEDIRECT / ELSEVIER
      // ========================================================
      if (currentUrl.includes('sciencedirect.com') || currentUrl.includes('elsevier.com')) {
        let sdChapterData = null;

        // 1. Jika sedang di halaman Article / Chapter ScienceDirect (/science/article/...)
        if (currentUrl.includes('/science/article/')) {
          onStatus('Halaman ScienceDirect (Elsevier): Memeriksa jenis publikasi...');

          sdChapterData = await this.executeInTab(tabId, () => {
            return new Promise((resolve) => {
              const MAX_WAIT = 10000;
              const INTERVAL = 300;
              let elapsed = 0;

              const poll = () => {
                // A. Cek link buku induk (/book/...)
                const bookLink = document.querySelector(
                  '.publication-details a[href*="/book/"], .publication-cover-image a[href*="/book/"], a[href*="/book/"]'
                );

                // B. Cek cover image di header artikel
                const coverImg = document.querySelector('.publication-cover-image img, .publication img, #publication img');
                let coverSrc = coverImg ? (coverImg.getAttribute('src') || coverImg.src) : '';
                const srcset = coverImg ? coverImg.getAttribute('srcset') : '';
                if (srcset) {
                  const match200 = srcset.match(/https:\/\/[^\s,]+cov200h\.gif/);
                  if (match200) coverSrc = match200[0];
                }
                if (coverSrc.includes('cov150h.gif')) {
                  coverSrc = coverSrc.replace('cov150h.gif', 'cov200h.gif');
                }

                // C. Cek judul artikel / chapter
                const titleEl = document.querySelector(
                  '#screen-reader-main-title .title-text, h1.content-title .title-text, h1.content-title, #screen-reader-main-title, .title-text, h1'
                );
                const chapterTitle = titleEl ? titleEl.textContent.replace(/^Chapter\s+\d+\s*[-–—:]\s*/i, '').trim() : '';

                // D. Cek judul & link publikasi (misal Journal / Procedia seperti Procedia Structural Integrity)
                const pubTitleEl = document.querySelector(
                  '.publication-title, [data-aa-region="publication-title"], h2.publication-title'
                );
                const journalLink = document.querySelector(
                  '.publication-details a[href*="/journal/"], .publication-cover-image a[href*="/journal/"], .publication-title a, a[href*="/journal/"]'
                );

                const publicationTitle = pubTitleEl ? pubTitleEl.textContent.trim() : (journalLink ? journalLink.textContent.trim() : '');

                // E. Volume, Series & Tahun
                const volEl = document.querySelector('.publication-volume, .publication-metadata .volume');
                const volume = volEl ? volEl.textContent.trim() : '';
                let year = '';
                if (volume) {
                  const yMatch = volume.match(/\b(19\d\d|20\d\d)\b/);
                  if (yMatch) year = yMatch[1];
                }
                if (!year) {
                  const yearMatch = (document.body ? document.body.textContent : '').match(/Date:\s*<!--\s*-->\s*(\d{4})|Date:\s*(\d{4})|Copyright\s*©\s*(\d{4})|(\d{4})\s*Elsevier/i);
                  if (yearMatch) year = yearMatch[1] || yearMatch[2] || yearMatch[3];
                }

                // KASUS 1: Ini adalah Buku / Book Chapter -> Ikuti link ke halaman buku induk (/book/...)
                if (bookLink && bookLink.href) {
                  resolve({
                    success: true,
                    isBook: true,
                    bookUrl: bookLink.href,
                    chapterTitle: chapterTitle,
                    coverUrl: coverSrc,
                    publicationTitle: publicationTitle,
                    series: volume,
                    year: year
                  });
                  return;
                }

                // KASUS 2: Ini adalah Journal / Proceeding (seperti Procedia Structural Integrity)
                // Data sudah lengkap ada langsung di header halaman artikel ini!
                if ((coverSrc || publicationTitle) && (journalLink || pubTitleEl || volume)) {
                  resolve({
                    success: true,
                    isBook: false,
                    isJournalOrProceeding: true,
                    journalUrl: journalLink ? journalLink.href : '',
                    chapterTitle: chapterTitle,
                    coverUrl: coverSrc,
                    publicationTitle: publicationTitle || 'Procedia / Journal',
                    series: volume,
                    year: year
                  });
                  return;
                }

                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  if (coverSrc || chapterTitle || publicationTitle) {
                    resolve({
                      success: true,
                      isBook: false,
                      isJournalOrProceeding: true,
                      journalUrl: journalLink ? journalLink.href : '',
                      chapterTitle: chapterTitle,
                      coverUrl: coverSrc,
                      publicationTitle: publicationTitle || 'Elsevier Publication',
                      series: volume,
                      year: year
                    });
                    return;
                  }

                  resolve({
                    success: false,
                    error: 'Tidak dapat menemukan data publikasi atau cover di halaman ScienceDirect ini.'
                  });
                  return;
                }

                setTimeout(poll, INTERVAL);
              };

              poll();
            });
          });

          if (!sdChapterData || !sdChapterData.success) {
            throw new Error(sdChapterData ? sdChapterData.error : 'Gagal mengekstrak publikasi ScienceDirect.');
          }

          if (!paperOrChapterTitle && sdChapterData.chapterTitle) {
            paperOrChapterTitle = sdChapterData.chapterTitle;
          }

          // Jika ini BUKU, buka halaman buku induk untuk mengambil ISBN & metadata buku lengkap
          if (sdChapterData.isBook && sdChapterData.bookUrl) {
            const bookUrl = sdChapterData.bookUrl;
            onStatus(`Ditemukan Link Buku ScienceDirect: ${bookUrl}. Membuka...`);

            await this.updateTabUrl(tabId, bookUrl, activeTab);
            await this.waitForTabLoad(tabId, timeoutMs);
            await this.sleep(1800);

            currentTab = await this.getTab(tabId);
            currentUrl = (currentTab && currentTab.url) ? currentTab.url : bookUrl;
          } else {
            // Jika ini JOURNAL / PROCEDIA (seperti Procedia Structural Integrity)
            // Seluruh data sudah berhasil didapatkan langsung dari halaman artikel!
            onStatus(`Ditemukan Publikasi Elsevier: ${sdChapterData.publicationTitle}. Menyiapkan unduhan...`);

            return {
              publisherType: 'Elsevier',
              title: sdChapterData.publicationTitle || 'Elsevier Publication',
              chapterTitle: paperOrChapterTitle || sdChapterData.chapterTitle,
              subtitle: sdChapterData.series || '',
              coverUrl: sdChapterData.coverUrl,
              coverFilename: '',
              isbn: '',
              doi: '',
              year: sdChapterData.year || '',
              editors: '',
              series: sdChapterData.series || '',
              publisher: 'Elsevier',
              scopusUrl: scopusUrl,
              bookUrl: sdChapterData.journalUrl || currentUrl,
              sourceUrl: currentUrl,
              isPdfCover: false
            };
          }
        }

        // 2. Sekarang berada di halaman Buku ScienceDirect (/book/...)
        onStatus('Mengekstrak metadata buku & cover ScienceDirect (Elsevier)...');

        const sdBookData = await this.executeInTab(tabId, () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 10000;
            const INTERVAL = 300;
            let elapsed = 0;

            const poll = () => {
              const titleEl = document.querySelector('#book-title-and-authors h1, h1.u-font-serif, .book-title, h1');
              const coverImg = document.querySelector(
                '.book-cover-img, #book-cover-and-meta img, .book-cover-img-wrapper img, .publication-cover-image img'
              );

              if (titleEl || coverImg) {
                let title = titleEl ? titleEl.textContent.trim() : '';

                let subtitle = '';
                const subtitleCandidates = document.querySelectorAll('#book-title-and-authors p, .banner-grid p');
                for (const p of subtitleCandidates) {
                  const text = p.textContent.trim();
                  if (!text.includes('Part of series:') && !text.includes('Edited by:') && !text.includes('Author(s):') && text.length > 2) {
                    subtitle = text;
                    break;
                  }
                }

                let series = '';
                const seriesEl = document.querySelector('.book-series-text, .series');
                if (seriesEl) {
                  series = seriesEl.textContent.replace(/Book\s*•\s*Part of series:\s*/i, '').trim();
                }

                let editors = '';
                for (const p of subtitleCandidates) {
                  const text = p.textContent.trim();
                  if (text.includes('Edited by:') || text.includes('Author(s):')) {
                    editors = text.replace(/^(Edited by|Author\(s\)):\s*/i, '').trim();
                    break;
                  }
                }

                let coverUrl = coverImg ? coverImg.src : '';
                const srcset = coverImg ? coverImg.getAttribute('srcset') : '';
                if (srcset) {
                  const match200 = srcset.match(/https:\/\/[^\s,]+cov200h\.gif/);
                  if (match200) coverUrl = match200[0];
                }
                if (coverUrl.includes('cov150h.gif')) {
                  coverUrl = coverUrl.replace('cov150h.gif', 'cov200h.gif');
                }

                let isbn = '';
                const isbnMatch = window.location.href.match(/\/book\/(\d{10,13})/i);
                if (isbnMatch) isbn = isbnMatch[1];

                let year = '';
                const yearMatch = (document.body ? document.body.textContent : '').match(/Copyright\s*©\s*(\d{4})|(\d{4})\s*Elsevier/i);
                if (yearMatch) year = yearMatch[1] || yearMatch[2];

                resolve({
                  success: true,
                  title: title || 'Elsevier Book',
                  subtitle: subtitle,
                  series: series,
                  editors: editors || 'Elsevier',
                  coverUrl: coverUrl,
                  isbn: isbn,
                  year: year
                });
                return;
              }

              elapsed += INTERVAL;
              if (elapsed >= MAX_WAIT) {
                resolve({ success: false, error: 'Waktu tunggu halaman buku ScienceDirect habis.' });
                return;
              }

              setTimeout(poll, INTERVAL);
            };

            poll();
          });
        });

        if (!sdBookData || !sdBookData.success) {
          throw new Error(sdBookData ? sdBookData.error : 'Gagal membaca metadata buku ScienceDirect.');
        }

        onStatus(`Ditemukan Buku Elsevier: ${sdBookData.title}. Menyiapkan unduhan...`);

        return {
          publisherType: 'Elsevier',
          title: sdBookData.title,
          chapterTitle: paperOrChapterTitle,
          subtitle: sdBookData.subtitle,
          coverUrl: sdBookData.coverUrl || (sdChapterData ? sdChapterData.coverUrl : ''),
          coverFilename: '',
          isbn: sdBookData.isbn ? `ISBN-${sdBookData.isbn}` : '',
          doi: '',
          year: sdBookData.year || (sdChapterData ? sdChapterData.year : ''),
          editors: sdBookData.editors,
          series: sdBookData.series || (sdChapterData ? sdChapterData.series : ''),
          publisher: 'Elsevier',
          scopusUrl: scopusUrl,
          bookUrl: currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: false
        };
      }

      // ========================================================
      // TAHAP 2C: Jika Publisher adalah ACM DIGITAL LIBRARY
      // ========================================================
      if (currentUrl.includes('dl.acm.org') || currentUrl.includes('acm.org')) {
        // 1. Jika sedang di halaman Article / Paper ACM (/doi/10.1145/... dan BUKAN /doi/proceedings/)
        if (currentUrl.includes('/doi/') && !currentUrl.includes('/doi/proceedings/')) {
          onStatus('Halaman Paper ACM: Mencari link Conference Proceedings...');

          const acmArticleData = await this.executeInTab(tabId, () => {
            return new Promise((resolve) => {
              const MAX_WAIT = 10000;
              const INTERVAL = 300;
              let elapsed = 0;

              const poll = () => {
                const citationBookLink = document.querySelector(
                  '.core-self-citation [property="isPartOf"] a[href*="/doi/proceedings/"], .core-self-citation a[href*="/doi/proceedings/"], a[href*="/doi/proceedings/"]'
                );

                const titleEl = document.querySelector(
                  'h1.citation__title, .citation__title, h1.left-bordered-title, .core-self-citation [property="name"], h1'
                );
                const paperTitle = titleEl ? titleEl.textContent.trim() : '';

                if (citationBookLink && citationBookLink.href) {
                  resolve({
                    success: true,
                    proceedingUrl: citationBookLink.href,
                    paperTitle: paperTitle
                  });
                  return;
                }

                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  // Fallback: cek link proceeding apapun
                  const anyProc = Array.from(document.querySelectorAll('a')).find(a => a.href && a.href.includes('/doi/proceedings/'));
                  if (anyProc) {
                    resolve({
                      success: true,
                      proceedingUrl: anyProc.href,
                      paperTitle: paperTitle
                    });
                    return;
                  }

                  resolve({
                    success: false,
                    error: 'Tidak dapat menemukan link Conference Proceedings di halaman ACM ini.'
                  });
                  return;
                }

                setTimeout(poll, INTERVAL);
              };

              poll();
            });
          });

          if (!acmArticleData || !acmArticleData.success) {
            throw new Error(acmArticleData ? acmArticleData.error : 'Gagal menemukan link Proceedings ACM.');
          }

          if (!paperOrChapterTitle && acmArticleData.paperTitle) {
            paperOrChapterTitle = acmArticleData.paperTitle;
          }

          const proceedingUrl = acmArticleData.proceedingUrl;
          onStatus(`Membuka Conference Proceedings ACM: ${proceedingUrl}...`);

          await this.updateTabUrl(tabId, proceedingUrl, activeTab);
          await this.waitForTabLoad(tabId, timeoutMs);
          await this.sleep(1800);

          currentTab = await this.getTab(tabId);
          currentUrl = (currentTab && currentTab.url) ? currentTab.url : proceedingUrl;
        }

        // 2. Sekarang berada di halaman Conference Proceedings ACM (/doi/proceedings/...)
        onStatus('Halaman Proceeding ACM: Mengekstrak metadata & cover...');

        const acmProcData = await this.executeInTab(tabId, () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 12000;
            const INTERVAL = 300;
            let elapsed = 0;

            const poll = () => {
              const titleEl = document.querySelector(
                '.colored-block__title h2, h2.left-bordered-title, .colored-block.item-meta h2, .item-meta h2, h1.left-bordered-title, h1, h2'
              );
              const coverImg = document.querySelector(
                '.overlay-cover-wrapper img, .left-side-image img, img.image-lazy-loaded, img[alt*="cover" i], img[src*=".cover." i], img[data-src*=".cover." i]'
              );
              const fmPdfLink = document.querySelector(
                'a[href*="/action/showFmPdf"], a[title*="Front matter" i], a[href*="showFmPdf"]'
              );

              if (titleEl || coverImg || fmPdfLink) {
                const title = titleEl ? titleEl.textContent.trim() : '';

                let conferenceName = '';
                let publisher = 'Association for Computing Machinery';
                let isbn = '';
                let year = '';

                const metaRows = document.querySelectorAll('.item-meta-row');
                metaRows.forEach(row => {
                  const labelEl = row.querySelector('.item-meta-row__label');
                  const valEl = row.querySelector('.item-meta-row__value');
                  if (!labelEl) return;

                  const labelText = (labelEl.innerText || labelEl.textContent || '').trim().toLowerCase();
                  const valText = valEl ? (valEl.innerText || valEl.textContent || '').trim() : '';

                  if (labelText.includes('conference:')) {
                    conferenceName = valText.replace(/\s+/g, ' ');
                  } else if (labelText.includes('publisher:')) {
                    publisher = valText.replace(/\s+/g, ' ') || publisher;
                  } else if (labelText.includes('isbn:')) {
                    const isbnMatch = valText.match(/[\d-]+/);
                    isbn = isbnMatch ? isbnMatch[0] : valText;
                  } else if (labelText.includes('published:')) {
                    const yMatch = valText.match(/\b(19\d\d|20\d\d)\b/);
                    if (yMatch) year = yMatch[1];
                  }
                });

                if (!year && conferenceName) {
                  const yMatch = conferenceName.match(/\b(19\d\d|20\d\d)\b/);
                  if (yMatch) year = yMatch[1];
                }
                if (!year && title) {
                  const yMatch = title.match(/\b(19\d\d|20\d\d)\b/) || title.match(/'(\d{2})\b/);
                  if (yMatch) {
                    year = yMatch[1].length === 2 ? ('20' + yMatch[1]) : yMatch[1];
                  }
                }
                if (!year) {
                  const pageYearMatch = (document.body ? document.body.textContent : '').match(/Copyright\s*©\s*(\d{4})|(\d{4})\s*ACM/i);
                  if (pageYearMatch) year = pageYearMatch[1] || pageYearMatch[2];
                }

                let coverUrl = '';
                if (coverImg) {
                  const src = coverImg.getAttribute('data-src') || coverImg.getAttribute('src') || coverImg.src || '';
                  if (src && !src.includes('badge') && !src.includes('logo')) {
                    coverUrl = src.startsWith('http') ? src : ('https://dl.acm.org' + (src.startsWith('/') ? '' : '/') + src);
                  }
                }

                let coverPdfUrl = '';
                if (fmPdfLink) {
                  const href = fmPdfLink.getAttribute('href') || '';
                  coverPdfUrl = href.startsWith('http') ? href : ('https://dl.acm.org' + (href.startsWith('/') ? '' : '/') + href);
                }

                let doi = '';
                const urlDoiMatch = window.location.href.match(/10\.1145\/(\d+)/);
                if (urlDoiMatch) {
                  doi = `10.1145/${urlDoiMatch[1]}`;
                }

                resolve({
                  success: true,
                  title: title || conferenceName || 'ACM Conference Proceeding',
                  subtitle: conferenceName || title,
                  publisher: publisher || 'ACM',
                  isbn: isbn ? (isbn.toUpperCase().startsWith('ISBN') ? isbn : `ISBN-${isbn}`) : (doi ? `ACM-${doi}` : ''),
                  doi: doi,
                  year: year,
                  coverUrl: coverUrl,
                  coverPdfUrl: coverPdfUrl
                });
                return;
              }

              elapsed += INTERVAL;
              if (elapsed >= MAX_WAIT) {
                resolve({ success: false, error: 'Waktu tunggu halaman proceeding ACM habis.' });
                return;
              }

              setTimeout(poll, INTERVAL);
            };

            poll();
          });
        });

        if (!acmProcData || !acmProcData.success) {
          throw new Error(acmProcData ? acmProcData.error : 'Gagal membaca metadata proceeding ACM.');
        }

        onStatus(`Ditemukan Proceeding ACM: ${acmProcData.title}. Menyiapkan unduhan...`);

        const isPdfCover = !acmProcData.coverUrl && !!acmProcData.coverPdfUrl;

        return {
          publisherType: 'ACM',
          title: acmProcData.title,
          chapterTitle: paperOrChapterTitle,
          subtitle: acmProcData.subtitle,
          coverUrl: acmProcData.coverUrl || acmProcData.coverPdfUrl,
          coverPdfUrl: acmProcData.coverPdfUrl,
          coverFilename: '',
          isbn: acmProcData.isbn,
          doi: acmProcData.doi,
          year: acmProcData.year,
          editors: 'ACM',
          series: 'ACM Conference Proceedings',
          publisher: 'ACM',
          scopusUrl: scopusUrl,
          bookUrl: currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: isPdfCover
        };
      }

      // ========================================================
      // TAHAP 2D: Jika Publisher adalah SPRINGER
      // ========================================================
      if (currentUrl.includes('/chapter/')) {
        onStatus('Halaman Chapter Springer: Mencari link Buku induk...');

        const chapterResult = await this.executeInTab(tabId, () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 10000;
            const INTERVAL = 300;
            let elapsed = 0;

            const poll = () => {
              const breadcrumbBookLink = document.querySelector(
                '.c-breadcrumbs a[href*="/book/"], nav[data-test="breadcrumbs"] a[href*="/book/"]'
              );
              if (breadcrumbBookLink && breadcrumbBookLink.href) {
                const titleEl = document.querySelector('[data-test="chapter-title"], h1.c-article-title');
                resolve({
                  success: true,
                  bookUrl: breadcrumbBookLink.href,
                  chapterTitle: titleEl ? titleEl.textContent.trim() : ''
                });
                return;
              }

              const brandBookLink = document.querySelector(
                '.app-article-masthead__brand a[href*="/book/"], .app-article-masthead__conference-link a[href*="/book/"]'
              );
              if (brandBookLink && brandBookLink.href) {
                const titleEl = document.querySelector('[data-test="chapter-title"], h1.c-article-title');
                resolve({
                  success: true,
                  bookUrl: brandBookLink.href,
                  chapterTitle: titleEl ? titleEl.textContent.trim() : ''
                });
                return;
              }

              const url = window.location.href;
              if (url.includes('/chapter/')) {
                const bookUrl = url.replace('/chapter/', '/book/').replace(/_\d+(\?.*)?$/, '');
                const titleEl = document.querySelector('[data-test="chapter-title"], h1.c-article-title');
                resolve({
                  success: true,
                  bookUrl: bookUrl,
                  chapterTitle: titleEl ? titleEl.textContent.trim() : ''
                });
                return;
              }

              elapsed += INTERVAL;
              if (elapsed >= MAX_WAIT) {
                resolve({
                  success: false,
                  error: 'Tidak dapat menemukan link Buku dari Chapter Springer.'
                });
                return;
              }

              setTimeout(poll, INTERVAL);
            };

            poll();
          });
        });

        if (!chapterResult || !chapterResult.success) {
          throw new Error(chapterResult ? chapterResult.error : 'Gagal menemukan link Buku dari Chapter.');
        }

        if (!paperOrChapterTitle && chapterResult.chapterTitle) {
          paperOrChapterTitle = chapterResult.chapterTitle;
        }

        const bookUrl = chapterResult.bookUrl;
        onStatus(`Ditemukan Link Buku: ${bookUrl}. Membuka...`);

        await this.updateTabUrl(tabId, bookUrl, activeTab);
        await this.waitForTabLoad(tabId, timeoutMs);
        await this.sleep(1500);

        currentTab = await this.getTab(tabId);
        currentUrl = (currentTab && currentTab.url) ? currentTab.url : bookUrl;
      }

      // Halaman Buku Springer (/book/...)
      onStatus('Mengekstrak metadata buku & cover Springer...');

      const bookHtmlData = await this.executeInTab(tabId, () => {
        return {
          html: document.documentElement.outerHTML,
          url: window.location.href
        };
      });

      if (!bookHtmlData || !bookHtmlData.html) {
        throw new Error('Gagal membaca konten DOM halaman Buku Springer.');
      }

      const bookData = parseSpringerBookHtml(bookHtmlData.html, bookHtmlData.url);
      bookData.publisherType = 'Springer';
      bookData.scopusUrl = scopusUrl;
      bookData.chapterTitle = paperOrChapterTitle;
      bookData.bookUrl = bookHtmlData.url;
      bookData.isPdfCover = false;

      return bookData;

    } finally {
      const tid = this.currentTabId || (tab ? tab.id : null);
      this.currentTabId = null;
      if (tid) {
        try {
          if (activeTab && !this.isSkipped && !this.isCancelled) {
            await this.sleep(800);
          }
          await this.safeRemoveTab(tid);
        } catch (e) {}
      }
    }
  }

  async getTab(tabId) {
    if (!tabId) return null;
    return new Promise((resolve) => {
      try {
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(t || null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async executeInTab(tabId, func) {
    if (typeof chrome === 'undefined' || !chrome.scripting) {
      throw new Error('API chrome.scripting tidak tersedia.');
    }
    const tab = await this.getTab(tabId);
    if (!tab) {
      throw new Error('Tab telah ditutup atau tidak ditemukan.');
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: func
      });
      if (results && results[0]) {
        return results[0].result;
      }
      return null;
    } catch (err) {
      if (err.message && err.message.includes('No tab with id')) {
        throw new Error('Tab telah ditutup oleh pengguna atau browser.');
      }
      throw err;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabAutomator };
} else if (typeof window !== 'undefined') {
  window.TabAutomator = TabAutomator;
}
