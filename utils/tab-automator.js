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
   * Menunggu penyelesaian verifikasi robot (Cloudflare Turnstile, CAPTCHA, dsb.)
   * Jika terdeteksi:
   * 1. Mengaktifkan tab target agar pengguna dapat melihat tantangan di browser.
   * 2. Memberikan pesan status di UI ekstensi.
   * 3. Menunggu (polling) hingga tantangan diselesaikan oleh pengguna (maksimal timeout).
   * 4. Memberikan jeda settling setelah verifikasi lolos agar DOM asli selesai dirender.
   */
  async waitForRobotVerification(tabId, onStatus, maxWaitMs = 180000) {
    const startTime = Date.now();
    let challengeDetected = false;

    while (Date.now() - startTime < maxWaitMs) {
      if (this.isCancelled) throw new Error('Dibatalkan');
      if (this.isSkipped) throw new Error('Dilewati oleh pengguna');

      const tab = await this.getTab(tabId);
      if (!tab) throw new Error('Tab telah ditutup.');

      let statusInfo = null;
      try {
        statusInfo = await this.executeInTab(tabId, () => {
          const title = (document.title || '').trim();
          const bodyText = document.body ? (document.body.innerText || '') : '';

          const isCfTitle = title.includes('Just a moment') ||
                            title.includes('Attention Required') ||
                            title.includes('Security Check') ||
                            title.includes('Cloudflare') ||
                            title.includes('Verify') ||
                            title.includes('Verifikasi');

          const cfElement = document.querySelector(
            '#challenge-stage, #challenge-running, #challenge-form, .cf-turnstile, #cf-wrapper, #cf-stage, ' +
            'iframe[src*="challenges.cloudflare.com"], iframe[src*="cloudflare"], iframe[title*="Cloudflare"], ' +
            'iframe[title*="Widget containing a Cloudflare security challenge"], #turnstile-wrapper, form#challenge-form, .ray-id, div.cf-alert'
          );

          const isCfText = bodyText.includes('Verifying you are human') ||
                           bodyText.includes('Verify you are human') ||
                           bodyText.includes('Checking if the site connection is secure') ||
                           bodyText.includes('review the security of your connection') ||
                           bodyText.includes('Please enable JavaScript and cookies') ||
                           bodyText.includes('Human Verification');

          const hasRealContent = !!document.querySelector(
            '.core-self-citation, .colored-block, .item-meta, #skip-to-main-content, ' +
            '.c-breadcrumbs, .publication-details, xpl-issue-results-items, h1.citation__title, ' +
            'a[href*="/doi/proceedings/"], a[href*="/action/showFmPdf"], .toc.acmotherconferences'
          );

          return {
            isChallenge: (isCfTitle || !!cfElement || isCfText) && !hasRealContent,
            title: title
          };
        });
      } catch (e) {
        // Tab mungkin sedang reload atau navigasi otomatis setelah challenge berhasil diselesaikan
        await this.sleep(1000);
        continue;
      }

      if (statusInfo && statusInfo.isChallenge) {
        if (!challengeDetected) {
          challengeDetected = true;
          try {
            await chrome.tabs.update(tabId, { active: true });
          } catch (e) {}
          onStatus('⏳ Terdeteksi verifikasi robot (CAPTCHA/Cloudflare). Silakan selesaikan verifikasi di tab browser...');
        }
        await this.sleep(1500);
      } else {
        // Jika sebelumnya terdeteksi challenge, tapi sekarang sudah lewat
        if (challengeDetected) {
          onStatus('✅ Verifikasi robot selesai! Melanjutkan proses...');
          await this.sleep(2000);
        }
        return true;
      }
    }

    if (challengeDetected) {
      throw new Error('Waktu tunggu verifikasi robot habis (melebihi 3 menit). Silakan coba lagi.');
    }
    return false;
  }

  /**
   * Eksekusi satu rantai alur kerja (Scopus -> Springer / IEEE Xplore / ScienceDirect / ACM)
   */
  async processUrl(initialUrl, {
    activeTab = true,
    timeoutMs = 28000,
    downloadCovers = true,
    metadataOnly = false,
    onStatus = () => {}
  } = {}) {
    this.isSkipped = false;
    if (this.isCancelled) throw new Error('Dibatalkan');

    let tab = null;
    let paperOrChapterTitle = '';
    let scopusUrl = initialUrl;
    let scopusMeta = {
      rawIsbn: '',
      isbnElectronic: '',
      isbnPrint: '',
      city: '',
      publisher: '',
      doi: '',
      sourceTitle: ''
    };
    let ieeeDocMeta = {
      isbnElectronic: '',
      isbnPrint: '',
      city: '',
      doi: '',
      publisher: ''
    };

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
        onStatus('Halaman Scopus: Memeriksa sidebar informasi & link penerbit...');

        const scopusResult = await this.executeInTab(tabId, (isMetaOnly) => {
          return new Promise((resolve) => {
            const MAX_WAIT = isMetaOnly ? 9000 : 12000;
            const INTERVAL = 300;
            let elapsed = 0;
            let flyoutOpened = false;
            let flyoutClosed = false;

            const poll = () => {
              // 1. Buka sidebar "Show all information" / "Detailed information" jika belum pernah dibuka
              const isFlyoutOpen = !!document.querySelector('.Flyout_main__klFeU, [class*="DetailedInformationFlyout"], [data-testid="flyout-main"]');
              if (!isFlyoutOpen && !flyoutOpened) {
                const infoButtons = Array.from(document.querySelectorAll('button, a')).filter(btn => {
                  const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                  return text.includes('show all information') ||
                         text.includes('detailed information') ||
                         text.includes('detail information') ||
                         text.includes('show more information') ||
                         text.includes('show information');
                });

                for (const btn of infoButtons) {
                  if (!btn._scopusClicked) {
                    btn._scopusClicked = true;
                    flyoutOpened = true;
                    try { btn.click(); } catch (e) {}
                    break;
                  }
                }
              }

              // 2. Periksa kelengkapan metadata Scopus langsung dari elemen DOM / Flyout
              let isbnsFoundCount = 0;
              let isCityFound = false;
              let flyoutDoi = '';

              const isbnEl = document.querySelector('[data-testid="source-info-isbn"], [data-testid="document-info-isbn"]');
              if (isbnEl && isbnEl.textContent) {
                const cleanIsbnStr = isbnEl.textContent.trim();
                const matches = cleanIsbnStr.match(/(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9Xx]/g) || [];
                const validMatches = matches.filter(m => {
                  const d = m.replace(/[^0-9Xx]/g, '');
                  return d.length === 10 || d.length === 13;
                });
                isbnsFoundCount = validMatches.length;
              }
              if (!isbnsFoundCount) {
                const dts = Array.from(document.querySelectorAll('dl dt'));
                const isbnDt = dts.find(dt => dt.textContent.trim().toLowerCase() === 'isbn');
                if (isbnDt) {
                  const dd = isbnDt.nextElementSibling || isbnDt.parentElement.querySelector('dd');
                  if (dd && dd.textContent) {
                    const matches = dd.textContent.match(/(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9Xx]/g) || [];
                    const validMatches = matches.filter(m => {
                      const d = m.replace(/[^0-9Xx]/g, '');
                      return d.length === 10 || d.length === 13;
                    });
                    isbnsFoundCount = validMatches.length;
                  }
                }
              }

              const locEl = document.querySelector('[data-testid="source-info-conference-city"], [data-testid*="conference-city"], [data-testid*="conference-location"], [data-testid*="location"]');
              if (locEl && locEl.textContent && locEl.textContent.trim().length > 2) {
                isCityFound = true;
              }
              if (!isCityFound) {
                const dts = Array.from(document.querySelectorAll('dl dt'));
                const locDt = dts.find(dt => {
                  const txt = dt.textContent.trim().toLowerCase();
                  return txt.includes('location') || txt.includes('city') || txt.includes('venue');
                });
                if (locDt) {
                  const dd = locDt.nextElementSibling || locDt.parentElement.querySelector('dd');
                  if (dd && dd.textContent && dd.textContent.trim().length > 2) {
                    isCityFound = true;
                  }
                }
              }

              const doiEl = document.querySelector('[data-testid="document-info-doi"]');
              if (doiEl && doiEl.textContent && doiEl.textContent.trim().startsWith('10.')) {
                flyoutDoi = doiEl.textContent.trim();
              }

              // Metadata Scopus dianggap 100% LENGKAP jika sudah ada minimal 2 ISBN (Elec & Print) DAN Lokasi Kota
              const isScopusMetaFullyComplete = (isbnsFoundCount >= 2 && isCityFound);

              // Jika mode metadata only (Cepat) dan data Scopus 100% LENGKAP:
              if (isMetaOnly && isScopusMetaFullyComplete && elapsed >= 800) {
                const titleEl = document.querySelector('h1, h2, .document-title');
                resolve({
                  success: true,
                  fastMetaFound: true,
                  paperTitle: titleEl ? titleEl.textContent.trim() : '',
                  html: document.documentElement ? document.documentElement.outerHTML : ''
                });
                return;
              }

              // 3. Jika hanya ada 1 ISBN / data belum lengkap, cari link publisher
              let publisherUrl = '';

              // 3a. Jika DOI ada di flyout, kita bisa langsung membentuk link publisher
              if (flyoutDoi) {
                publisherUrl = 'https://doi.org/' + flyoutDoi;
              }

              // 3b. Tutup flyout modal setelah membaca data agar tidak menutupi toolbar Scopus
              if (isFlyoutOpen && !flyoutClosed && (flyoutDoi || elapsed >= 800)) {
                const closeBtn = document.querySelector('[data-testid="flyout-close-button"], .Flyout_closeButton__9jeNZ button, button[aria-label="Close"]');
                if (closeBtn) {
                  flyoutClosed = true;
                  try { closeBtn.click(); } catch (e) {}
                }
              }

              // 3c. Buka dropdown menu "Full text" jika ada dan belum terbuka
              if (!publisherUrl) {
                const toolbar = document.querySelector('[class*="DocumentToolbar"], .DocumentToolbar_wrapper__Cfual, .document-toolbar');
                const searchScope = toolbar || document;

                const fullTextBtn = Array.from(searchScope.querySelectorAll('button')).find(btn => {
                  const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                  return text.includes('full text') && !text.includes('view pdf');
                });

                const isMenuOpen = !!document.querySelector('[class*="Menu_menu"], [role="menu"], [class*="Stack_stack"] a');
                if (fullTextBtn && !isMenuOpen && !fullTextBtn._clicked) {
                  fullTextBtn._clicked = true;
                  try { fullTextBtn.click(); } catch (e) {}
                }

                // Cari link "View at Publisher"
                const allElements = Array.from(document.querySelectorAll(
                  '[class*="DocumentToolbar"] a, [class*="DocumentToolbar"] button, [class*="Menu_menu"] a, [role="menu"] a, [role="menuitem"], [class*="Stack_stack"] a, a'
                ));

                const pubEl = allElements.find(el => {
                  const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                  const isViewPdf = text.includes('view pdf');
                  const isViewPub = text.includes('view at publisher') || (text.includes('view') && text.includes('publisher'));
                  return isViewPub && !isViewPdf;
                });

                if (pubEl) {
                  if (pubEl.href && !pubEl.href.startsWith('javascript:')) {
                    publisherUrl = pubEl.href;
                  } else if (pubEl.getAttribute('href') && !pubEl.getAttribute('href').startsWith('javascript:')) {
                    publisherUrl = pubEl.getAttribute('href');
                  }
                }
              }

              // 3d. Cek link DOI atau link penerbit langsung di dokumen
              if (!publisherUrl) {
                const directPubLink = Array.from(document.querySelectorAll('a')).find(a => {
                  if (!a.href) return false;
                  const h = a.href.toLowerCase();
                  const text = (a.innerText || a.textContent || '').toLowerCase();
                  if (text.includes('view pdf') || h.includes('.pdf')) return false;
                  return h.includes('doi.org/10.') ||
                         h.includes('springer.com') ||
                         h.includes('ieeexplore.ieee.org') ||
                         h.includes('sciencedirect.com') ||
                         h.includes('dl.acm.org') ||
                         h.includes('spiedigitallibrary.org') ||
                         h.includes('spie.org') ||
                         h.includes('igi-global.com') ||
                         h.includes('academic-conferences.org') ||
                         h.includes('iopscience.iop.org') ||
                         h.includes('acm.org');
                });
                if (directPubLink) {
                  publisherUrl = directPubLink.href;
                }
              }

              // Jika ditemukan link publisher (dari DOI atau tombol), simpan metadata Scopus dan resolve
              if (publisherUrl) {
                const titleEl = document.querySelector('h1, h2, .document-title');
                resolve({
                  success: true,
                  publisherUrl: publisherUrl,
                  paperTitle: titleEl ? titleEl.textContent.trim() : '',
                  html: document.documentElement ? document.documentElement.outerHTML : ''
                });
                return;
              }

              elapsed += INTERVAL;
              if (elapsed >= MAX_WAIT) {
                const bodyText = document.body ? document.body.innerText : '';
                const match = bodyText.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
                if (match) {
                  resolve({
                    success: true,
                    publisherUrl: 'https://doi.org/' + match[0],
                    paperTitle: document.querySelector('h1, h2')?.textContent?.trim() || '',
                    html: document.documentElement ? document.documentElement.outerHTML : ''
                  });
                  return;
                }

                resolve({
                  success: isbnsFoundCount > 0,
                  fastMetaFound: isbnsFoundCount > 0,
                  error: isbnsFoundCount > 0 ? null : 'Tidak dapat menemukan link View at Publisher atau data ISBN di Scopus ini.',
                  html: document.documentElement ? document.documentElement.outerHTML : ''
                });
                return;
              }

              setTimeout(poll, INTERVAL);
            };

            poll();
          });
        }, [metadataOnly]);

        // Ekstraksi Scopus Metadata (ISBN Electronic, ISBN Print, City, Publisher)
        if (scopusResult && scopusResult.html && typeof extractScopusMetadata === 'function') {
          try {
            const parsedMeta = extractScopusMetadata(scopusResult.html);
            scopusMeta = { ...scopusMeta, ...parsedMeta };
            if (scopusMeta.isbnElectronic || scopusMeta.isbnPrint) {
              onStatus(`Scopus Sidebar: Ditemukan ISBN Elec: ${scopusMeta.isbnElectronic || '-'}, Print: ${scopusMeta.isbnPrint || '-'}, Lokasi: ${scopusMeta.city || '-'}`);
            }
          } catch (scopusErr) {
            console.warn('[Automator] Gagal ekstrak metadata Scopus:', scopusErr);
          }
        }

        // JIKA MODE METADATA ONLY (Cepat / Tanpa Cover):
        // Jika Scopus sudah menyediakan data 100% LENGKAP (kedua ISBN Elec & Print ada DAN City ada),
        // ATAU jika memang TIDAK ADA link publisher untuk dituju:
        const hasCompleteScopusMeta = (scopusMeta.isbnElectronic && scopusMeta.isbnPrint && scopusMeta.city);
        const hasPublisherLink = Boolean(scopusResult && scopusResult.publisherUrl);

        if (metadataOnly) {
          if (hasCompleteScopusMeta || !hasPublisherLink) {
            onStatus(`Scopus: Selesai mengambil metadata dari Scopus (ISBN Elec: ${scopusMeta.isbnElectronic || '-'}, Print: ${scopusMeta.isbnPrint || '-'}, Lokasi: ${scopusMeta.city || '-'}).`);
            return {
              publisherType: 'Scopus',
              title: (scopusResult && scopusResult.paperTitle) || scopusMeta.sourceTitle || paperOrChapterTitle || '',
              chapterTitle: (scopusResult && scopusResult.paperTitle) || '',
              publisher: scopusMeta.publisher || 'Scopus',
              city: scopusMeta.city || '',
              isbnElectronic: scopusMeta.isbnElectronic || '',
              isbnPrint: scopusMeta.isbnPrint || '',
              isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
              doi: scopusMeta.doi || '',
              scopusUrl: initialUrl,
              sourceUrl: initialUrl,
              isPdfCover: false,
              coverUrl: '',
              coverPdfUrl: '',
              coverFilename: 'Tanpa Cover (Mode Cepat)'
            };
          } else {
            onStatus(`Scopus: Data di Scopus hanya 1 ISBN. Mengarahkan ke penerbit (${scopusResult.publisherUrl}) untuk melengkapi data...`);
          }
        }

        if (!scopusResult || (!scopusResult.success && !scopusResult.publisherUrl)) {
          throw new Error(scopusResult ? scopusResult.error : 'Gagal mengekstrak link publisher dari Scopus.');
        }

        paperOrChapterTitle = scopusResult.paperTitle || '';
        const publisherUrl = scopusResult.publisherUrl;
        onStatus(`Ditemukan Publisher: ${publisherUrl}. Mengarahkan...`);

        await this.updateTabUrl(tabId, publisherUrl, activeTab);
        await this.waitForTabLoad(tabId, timeoutMs);
        await this.sleep(1500);

        // Cek jika muncul tantangan verifikasi robot (Cloudflare/CAPTCHA) saat masuk ke publisher
        await this.waitForRobotVerification(tabId, onStatus);

        currentTab = await this.getTab(tabId);
        currentUrl = (currentTab && currentTab.url) ? currentTab.url : publisherUrl;
      }

      // ========================================================
      // TAHAP 2A: Jika Publisher adalah IEEE XPLORE
      // ========================================================
      if (currentUrl.includes('ieeexplore.ieee.org')) {
        // Jika sedang di halaman Document / Paper IEEE (/document/...)
        if (currentUrl.includes('/document/')) {
          onStatus('Halaman Paper IEEE: Mencari link Conference Proceeding & ISBN...');

          const ieeeDocResult = await this.executeInTab(tabId, (isMetaOnly) => {
            return new Promise((resolve) => {
              const MAX_WAIT = 10000;
              const INTERVAL = 300;
              let elapsed = 0;

              const poll = () => {
                // Buka tombol accordion ISBN jika tertutup
                const allButtons = Array.from(document.querySelectorAll('button'));
                const isbnBtn = allButtons.find(b => {
                  const text = (b.innerText || b.textContent || '').trim();
                  return /ISBN\s*Information/i.test(text);
                });
                if (isbnBtn && isbnBtn.getAttribute('aria-expanded') !== 'true') {
                  try {
                    isbnBtn.click();
                    isbnBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  } catch (e) {}
                }

                const proceedingLink = document.querySelector(
                  '.breadcrumbs a[href*="/proceeding"], .breadcrumbs a[href*="/conhome/"], .document-header a[href*="/conhome/"]'
                );

                const hasExpandedIsbn = !!document.querySelector('.abstract-metadata-indent, .isbn-value, [class*="isbn"]') ||
                                        /Electronic\s*ISBN|Print(?:\s*on\s*Demand)?\s*ISBN/i.test(document.body ? document.body.innerText : '');

                // Jika mode Metadata Only (Cepat):
                if (isMetaOnly && (hasExpandedIsbn || elapsed >= 2500)) {
                  const titleEl = document.querySelector('h1.document-title, .document-title-fix h1');
                  resolve({
                    success: true,
                    proceedingUrl: proceedingLink ? proceedingLink.href : '',
                    paperTitle: titleEl ? titleEl.textContent.trim() : '',
                    html: document.documentElement ? document.documentElement.outerHTML : ''
                  });
                  return;
                }

                if (proceedingLink && proceedingLink.href) {
                  if (isbnBtn && !hasExpandedIsbn && elapsed < 1500) {
                    // tunggu sejenak agar accordion DOM sempat ter-render
                  } else {
                    const titleEl = document.querySelector('h1.document-title, .document-title-fix h1');
                    resolve({
                      success: true,
                      proceedingUrl: proceedingLink.href,
                      paperTitle: titleEl ? titleEl.textContent.trim() : '',
                      html: document.documentElement ? document.documentElement.outerHTML : ''
                    });
                    return;
                  }
                }

                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  const titleEl = document.querySelector('h1.document-title, .document-title-fix h1');
                  resolve({
                    success: !!proceedingLink,
                    proceedingUrl: proceedingLink ? proceedingLink.href : '',
                    paperTitle: titleEl ? titleEl.textContent.trim() : '',
                    error: proceedingLink ? null : 'Tidak dapat menemukan link Conference Proceeding di halaman IEEE ini.',
                    html: document.documentElement ? document.documentElement.outerHTML : ''
                  });
                  return;
                }

                setTimeout(poll, INTERVAL);
              };

              poll();
            });
          }, [metadataOnly]);

          // Ekstraksi Metadata IEEE Document (Electronic ISBN, Print on Demand ISBN, City, DOI)
          if (ieeeDocResult && ieeeDocResult.html && typeof extractIeeeDocumentMetadata === 'function') {
            try {
              const parsedIeee = extractIeeeDocumentMetadata(ieeeDocResult.html);
              ieeeDocMeta = { ...ieeeDocMeta, ...parsedIeee };
              if (ieeeDocMeta.isbnElectronic || ieeeDocMeta.isbnPrint) {
                onStatus(`IEEE: Ditemukan ISBN Elec: ${ieeeDocMeta.isbnElectronic || '-'}, Print: ${ieeeDocMeta.isbnPrint || '-'}, Lokasi: ${ieeeDocMeta.city || '-'}`);
              }
            } catch (ieeeErr) {
              console.warn('[Automator] Gagal ekstrak metadata IEEE document:', ieeeErr);
            }
          }

          // JIKA MODE METADATA ONLY (Cepat / Tanpa Cover):
          if (metadataOnly) {
            onStatus(`IEEE: Selesai mengambil metadata tanpa cover (ISBN Elec: ${ieeeDocMeta.isbnElectronic || '-'}, Print: ${ieeeDocMeta.isbnPrint || '-'}, Lokasi: ${ieeeDocMeta.city || '-'}).`);
            return {
              publisherType: 'IEEE',
              title: (ieeeDocResult && ieeeDocResult.paperTitle) || paperOrChapterTitle || '',
              chapterTitle: paperOrChapterTitle || (ieeeDocResult && ieeeDocResult.paperTitle) || '',
              publisher: ieeeDocMeta.publisher || 'IEEE',
              city: ieeeDocMeta.city || scopusMeta.city || '',
              isbnElectronic: ieeeDocMeta.isbnElectronic || scopusMeta.isbnElectronic || '',
              isbnPrint: ieeeDocMeta.isbnPrint || scopusMeta.isbnPrint || '',
              isbn: ieeeDocMeta.isbnElectronic || ieeeDocMeta.isbnPrint || scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
              doi: ieeeDocMeta.doi || scopusMeta.doi || '',
              scopusUrl: scopusUrl,
              publisherUrl: currentUrl,
              sourceUrl: currentUrl,
              isPdfCover: false,
              coverUrl: '',
              coverPdfUrl: '',
              coverFilename: 'Tanpa Cover (Mode Cepat)'
            };
          }

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
        onStatus('Halaman Proceeding IEEE: Mencari Cover Page atau berkas proceeding...');

        const scanIeeePageFunc = () => {
          return new Promise((resolve) => {
            const MAX_WAIT = 12000;
            const INTERVAL = 350;
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

              // Helper deteksi judul cover langsung (Cover, Front Cover, Cover Page, Back Cover, Title Page i/ii/1)
              const isDirectCover = (title) => {
                const t = (title || '').trim();
                if (/\b(?:front\s*cover|back\s*cover|cover\s*page|inside\s*(?:front\s*)?cover|title\s*page(?:\s+[ivxlcdm\d]+)?)\b/i.test(t)) return true;
                if (/\bcovers?\b/i.test(t)) {
                  if (/coverage|discovering|recovering|undercover/i.test(t)) return false;
                  if (/\b(?:radio|network|land|cloud|spatial|code|test|fault|sensor|depth)\s+cover/i.test(t)) return false;
                  return true;
                }
                return false;
              };

              // Helper deteksi Proceedings, Front Matter, Title Page, Hak Cipta, Prelims, dsb.
              const isProceedingsOrFrontMatter = (title) => {
                const t = (title || '').trim();
                const kw = [
                  /\bproceedings?\b/i,
                  /\bfront\s*matter\b/i,
                  /\btitle\s*page\b/i,
                  /\bprelimin(?:ary|aries)\b/i,
                  /\bcopyright\b/i,
                  /\btable\s*of\s*contents\b/i,
                  /\bcontents\b/i,
                  /\bpreface\b/i,
                  /\bforeword\b/i,
                  /\bwelcome\s*(?:message|address)\b/i,
                  /\b(?:organizing\s*)?committee\b/i,
                  /\bauthor\s*index\b/i
                ];
                return kw.some(regex => regex.test(t));
              };

              // Fungsi ekstraksi link PDF dari item
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

              let bestCover = null;
              let bestCandidate = null;

              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const titleEl = item.querySelector('h2, .result-item-title, .title, [xplmathjax]');
                const rawTitle = titleEl ? titleEl.textContent.trim() : '';
                const pdfInfo = getPdfInfo(item);
                if (!pdfInfo) continue;

                // Cek apakah ada daftar nama author
                const authorEl = item.querySelector('xpl-authors-name-list, .author, .authors-info');
                const hasAuthors = !!(authorEl && authorEl.textContent.trim().length > 0);

                let priority = 10;
                if (isDirectCover(rawTitle)) {
                  priority = 100; // Prioritas 1: Cover langsung
                } else if (isProceedingsOrFrontMatter(rawTitle)) {
                  priority = 80;  // Prioritas 2: Proceedings / Front Matter
                } else if (!hasAuthors) {
                  priority = 50;  // Prioritas 3: Dokumen non-paper (tanpa author)
                }

                const candidateObj = {
                  coverTitle: rawTitle || 'Proceeding Document',
                  coverPdfUrl: pdfInfo.pdfUrl,
                  coverDirectPdfUrl: pdfInfo.directUrl,
                  coverArnumber: pdfInfo.arnumber,
                  priority,
                  hasAuthors,
                  itemIndex: i
                };

                if (priority >= 80 && (!bestCover || priority > bestCover.priority)) {
                  bestCover = candidateObj;
                }

                if (!bestCandidate || priority > bestCandidate.priority) {
                  bestCandidate = candidateObj;
                }
              }

              // Deteksi Paginasi Lengkap IEEE
              const pageButtons = Array.from(document.querySelectorAll(
                'xpl-paginator button, .pagination-bar button, ul.pagination button, .pagination-bar a'
              ));
              const numericPages = pageButtons
                .map(b => parseInt((b.innerText || b.textContent || '').trim(), 10))
                .filter(n => !isNaN(n) && n > 0);
              const maxVisiblePage = numericPages.length > 0 ? Math.max(...numericPages) : 1;

              const activeBtn = document.querySelector('xpl-paginator button.active, .pagination button.active, xpl-paginator li.active button');
              const currentPage = activeBtn ? parseInt(activeBtn.textContent.trim(), 10) : (numericPages[0] || 1);

              // Tombol Next set (misal: Next 10 pages / stats-Pagination_Next_11)
              const nextSetBtn = document.querySelector('.next-page-set button, button[class*="stats-Pagination_Next_"]');
              let hasNextSet = false;
              let nextSetPage = 0;
              if (nextSetBtn && !nextSetBtn.disabled && !nextSetBtn.classList.contains('disabled') && !nextSetBtn.getAttribute('disabled')) {
                const className = nextSetBtn.className || '';
                const match = className.match(/stats-Pagination_Next_(\d+)/);
                nextSetPage = match ? parseInt(match[1], 10) : (maxVisiblePage + 1);
                hasNextSet = true;
              }

              // Tombol Next panah tunggal (misal: stats-Pagination_arrow_next_11)
              const nextArrowBtn = document.querySelector('.next-btn button, button[class*="stats-Pagination_arrow_next_"]');
              let hasNext = false;
              let nextArrowPage = 0;
              if (nextArrowBtn && !nextArrowBtn.disabled && !nextArrowBtn.classList.contains('disabled') && !nextArrowBtn.getAttribute('disabled')) {
                const className = nextArrowBtn.className || '';
                const match = className.match(/stats-Pagination_arrow_next_(\d+)/);
                nextArrowPage = match ? parseInt(match[1], 10) : (currentPage + 1);
                hasNext = true;
              }

              const isLastPage = !hasNextSet && !hasNext;
              const chosen = bestCover || null;

              resolve({
                success: true,
                coverFound: !!chosen,
                conferenceName: conferenceName || 'IEEE Conference Proceeding',
                year: year || '',
                coverTitle: chosen ? chosen.coverTitle : '',
                coverPdfUrl: chosen ? chosen.coverPdfUrl : '',
                coverDirectPdfUrl: chosen ? chosen.coverDirectPdfUrl : '',
                coverArnumber: chosen ? chosen.coverArnumber : '',
                priority: chosen ? chosen.priority : 0,
                bestCandidate: bestCandidate,
                pagination: {
                  currentPage,
                  numericPages,
                  maxVisiblePage,
                  hasNextSet,
                  nextSetPage,
                  hasNext,
                  nextArrowPage,
                  isLastPage
                },
                maxPage: maxVisiblePage
              });
            };

            poll();
          });
        };

        let ieeeProceedingData = await this.executeInTab(tabId, scanIeeePageFunc);

        if (!ieeeProceedingData || !ieeeProceedingData.success) {
          throw new Error(ieeeProceedingData ? ieeeProceedingData.error : 'Gagal membaca proceeding IEEE.');
        }

        // Simpan kandidat terbaik yang mungkin menjadi cover (proceedings/prelims/item non-paper)
        let bestOverallCandidate = (ieeeProceedingData.coverFound)
          ? {
              coverTitle: ieeeProceedingData.coverTitle,
              coverPdfUrl: ieeeProceedingData.coverPdfUrl,
              coverDirectPdfUrl: ieeeProceedingData.coverDirectPdfUrl,
              coverArnumber: ieeeProceedingData.coverArnumber,
              priority: ieeeProceedingData.priority,
              conferenceName: ieeeProceedingData.conferenceName,
              year: ieeeProceedingData.year
            }
          : (ieeeProceedingData.bestCandidate
              ? {
                  ...ieeeProceedingData.bestCandidate,
                  conferenceName: ieeeProceedingData.conferenceName,
                  year: ieeeProceedingData.year
                }
              : null);

        // Hanya berhenti di halaman 1 jika ditemukan Cover Page Murni (Prioritas 100).
        // Jika hanya dokumen prosiding/front matter (Prioritas 80) atau paper biasa,
        // tetap telusuri hingga halaman terakhir (misal hlm 4) untuk mencari Cover Page asli.
        if (!ieeeProceedingData.coverFound || ieeeProceedingData.priority < 100) {
          let currentPagin = ieeeProceedingData.pagination || { isLastPage: true };
          const visitedPages = new Set([currentPagin.currentPage || 1]);
          let jumpCount = 0;
          const MAX_JUMPS = 8;

          while (!currentPagin.isLastPage && jumpCount < MAX_JUMPS) {
            jumpCount++;

            // Tentukan target loncatan:
            // 1. Jika ada blok 10 halaman berikutnya (Next 10 / stats-Pagination_Next_11), lompat ke sana
            let targetPage = 0;
            if (currentPagin.hasNextSet && currentPagin.nextSetPage > 0 && !visitedPages.has(currentPagin.nextSetPage)) {
              targetPage = currentPagin.nextSetPage;
            } else if (currentPagin.maxVisiblePage > currentPagin.currentPage && !visitedPages.has(currentPagin.maxVisiblePage)) {
              targetPage = currentPagin.maxVisiblePage;
            } else if (currentPagin.hasNext && currentPagin.nextArrowPage > 0 && !visitedPages.has(currentPagin.nextArrowPage)) {
              targetPage = currentPagin.nextArrowPage;
            } else {
              break;
            }

            visitedPages.add(targetPage);
            onStatus(`Memeriksa halaman IEEE selanjutnya (hlm ${targetPage})...`);

            const baseUrl = currentUrl.split('?')[0];
            const nextPageUrl = `${baseUrl}?pageNumber=${targetPage}`;

            await this.updateTabUrl(tabId, nextPageUrl, activeTab);
            await this.waitForTabLoad(tabId, timeoutMs);
            await this.sleep(2200);

            currentTab = await this.getTab(tabId);
            currentUrl = (currentTab && currentTab.url) ? currentTab.url : nextPageUrl;

            const pageData = await this.executeInTab(tabId, scanIeeePageFunc);
            if (pageData && pageData.success) {
              if (!ieeeProceedingData.conferenceName && pageData.conferenceName) {
                ieeeProceedingData.conferenceName = pageData.conferenceName;
              }
              if (!ieeeProceedingData.year && pageData.year) {
                ieeeProceedingData.year = pageData.year;
              }

              // Jika ditemukan Cover Murni (Prioritas 100), langsung ambil
              if (pageData.coverFound && pageData.priority === 100) {
                ieeeProceedingData = pageData;
                break;
              }

              // Simpan jika ditemukan kandidat alternatif yang lebih baik
              if (pageData.bestCandidate && (!bestOverallCandidate || pageData.bestCandidate.priority > (bestOverallCandidate.priority || 0))) {
                bestOverallCandidate = {
                  ...pageData.bestCandidate,
                  conferenceName: pageData.conferenceName || ieeeProceedingData.conferenceName,
                  year: pageData.year || ieeeProceedingData.year
                };
              }

              currentPagin = pageData.pagination || { isLastPage: true };
            } else {
              break;
            }
          }

          // Jika sudah sampai di blok halaman terakhir namun belum di nomor halaman tertinggi pada blok tersebut:
          if ((!ieeeProceedingData.coverFound || ieeeProceedingData.priority < 100) && currentPagin.maxVisiblePage && !visitedPages.has(currentPagin.maxVisiblePage)) {
            const finalPage = currentPagin.maxVisiblePage;
            visitedPages.add(finalPage);
            onStatus(`Membuka halaman paling akhir IEEE (hlm ${finalPage})...`);

            const baseUrl = currentUrl.split('?')[0];
            const finalPageUrl = `${baseUrl}?pageNumber=${finalPage}`;

            await this.updateTabUrl(tabId, finalPageUrl, activeTab);
            await this.waitForTabLoad(tabId, timeoutMs);
            await this.sleep(2200);

            currentTab = await this.getTab(tabId);
            currentUrl = (currentTab && currentTab.url) ? currentTab.url : finalPageUrl;

            const finalPageData = await this.executeInTab(tabId, scanIeeePageFunc);
            if (finalPageData && finalPageData.success) {
              if (finalPageData.coverFound && finalPageData.priority === 100) {
                ieeeProceedingData = finalPageData;
              } else if (finalPageData.bestCandidate && (!bestOverallCandidate || finalPageData.bestCandidate.priority > (bestOverallCandidate.priority || 0))) {
                bestOverallCandidate = {
                  ...finalPageData.bestCandidate,
                  conferenceName: finalPageData.conferenceName || ieeeProceedingData.conferenceName,
                  year: finalPageData.year || ieeeProceedingData.year
                };
              }
            }
          }
        }

        // PENANGANAN FALLBACK SESUAI PERMINTAAN:
        // "ada yang nama filennya "Proceedings" atau lainnya. kalau engga nemu yang ada cover nya, yaudah ambil salah satuaja yang memungkinkan itu cover"
        if ((!ieeeProceedingData.coverFound || ieeeProceedingData.priority < 80) && bestOverallCandidate && bestOverallCandidate.coverPdfUrl) {
          onStatus(`Cover bertuliskan 'Cover' tidak ditemukan. Menggunakan berkas proceeding yang memungkinkan: "${bestOverallCandidate.coverTitle}"...`);
          ieeeProceedingData = {
            success: true,
            coverFound: true,
            conferenceName: ieeeProceedingData.conferenceName || bestOverallCandidate.conferenceName || 'IEEE Conference Proceeding',
            year: ieeeProceedingData.year || bestOverallCandidate.year || '',
            coverTitle: bestOverallCandidate.coverTitle,
            coverPdfUrl: bestOverallCandidate.coverPdfUrl,
            coverDirectPdfUrl: bestOverallCandidate.coverDirectPdfUrl,
            coverArnumber: bestOverallCandidate.coverArnumber,
            priority: bestOverallCandidate.priority || 10
          };
        }

        // Jika setelah semua penelusuran dan fallback tetap tidak ada berkas PDF yang valid:
        if (!ieeeProceedingData.coverFound || !ieeeProceedingData.coverPdfUrl) {
          throw new Error('Tidak dapat menemukan Cover Page atau berkas proceeding pada IEEE ini.');
        }

        onStatus(`Ditemukan Cover/Proceeding IEEE: ${ieeeProceedingData.coverTitle}. Menyiapkan unduhan...`);

        return {
          publisherType: 'IEEE',
          title: ieeeProceedingData.conferenceName,
          chapterTitle: paperOrChapterTitle,
          subtitle: ieeeProceedingData.coverTitle,
          coverUrl: ieeeProceedingData.coverDirectPdfUrl || ieeeProceedingData.coverPdfUrl,
          coverPdfUrl: ieeeProceedingData.coverDirectPdfUrl || ieeeProceedingData.coverPdfUrl,
          isPdfCover: true,
          isbnElectronic: ieeeDocMeta.isbnElectronic || scopusMeta.isbnElectronic || '',
          isbnPrint: ieeeDocMeta.isbnPrint || scopusMeta.isbnPrint || '',
          city: ieeeDocMeta.city || scopusMeta.city || '',
          isbn: ieeeDocMeta.isbnElectronic || ieeeDocMeta.isbnPrint || scopusMeta.isbnElectronic || scopusMeta.isbnPrint || (ieeeProceedingData.coverArnumber ? `IEEE-${ieeeProceedingData.coverArnumber}` : ''),
          doi: ieeeDocMeta.doi || scopusMeta.doi || '',
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
              coverUrl: metadataOnly ? '' : sdChapterData.coverUrl,
              coverFilename: metadataOnly ? 'Tanpa Cover (Mode Cepat)' : '',
              isbnElectronic: scopusMeta.isbnElectronic || '',
              isbnPrint: scopusMeta.isbnPrint || '',
              city: scopusMeta.city || '',
              isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
              doi: scopusMeta.doi || '',
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

        const sdIsbnClean = sdBookData.isbn ? (typeof sanitizeIsbn === 'function' ? sanitizeIsbn(sdBookData.isbn) : sdBookData.isbn) : '';
        return {
          publisherType: 'Elsevier',
          title: sdBookData.title,
          chapterTitle: paperOrChapterTitle,
          subtitle: sdBookData.subtitle,
          coverUrl: metadataOnly ? '' : (sdBookData.coverUrl || (sdChapterData ? sdChapterData.coverUrl : '')),
          coverFilename: metadataOnly ? 'Tanpa Cover (Mode Cepat)' : '',
          isbnElectronic: scopusMeta.isbnElectronic || sdIsbnClean || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: (sdIsbnClean ? `ISBN-${sdIsbnClean}` : '') || scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
          doi: scopusMeta.doi || '',
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
        // Cek jika muncul tantangan verifikasi robot (Cloudflare Turnstile)
        await this.waitForRobotVerification(tabId, onStatus);

        currentTab = await this.getTab(tabId);
        currentUrl = (currentTab && currentTab.url) ? currentTab.url : currentUrl;

        // 1. Jika sedang di halaman Article / Paper ACM (bukan halaman prosiding atau daftar isi jurnal /toc/)
        const isAcmArticle = (currentUrl.includes('/doi/') || currentUrl.includes('/doi/abs/')) &&
                             !currentUrl.includes('/doi/proceedings/') &&
                             !currentUrl.includes('/toc/');

        if (isAcmArticle) {
          onStatus('Halaman Paper ACM: Mencari link Prosiding/Jurnal induk...');

          const getArticleData = async () => {
            return await this.executeInTab(tabId, () => {
              return new Promise((resolve) => {
                const MAX_WAIT = 10000;
                const INTERVAL = 300;
                let elapsed = 0;

                const poll = () => {
                  const citationParentLink = document.querySelector(
                    '.core-self-citation .core-enumeration a[href*="/toc/"], ' +
                    '.core-self-citation [property="isPartOf"] a[href*="/doi/proceedings/"], ' +
                    '.core-self-citation [property="isPartOf"] a[href*="/toc/"], ' +
                    '.core-self-citation a[href*="/doi/proceedings/"], ' +
                    '.core-self-citation a[href*="/toc/"], ' +
                    '.core-enumeration a[href*="/toc/"], ' +
                    'a[href*="/doi/proceedings/"], a[href*="/toc/"]'
                  );

                  const titleEl = document.querySelector(
                    'h1.citation__title, .citation__title, h1.left-bordered-title, .core-self-citation [property="name"], h1'
                  );
                  const paperTitle = titleEl ? titleEl.textContent.trim() : '';

                  if (citationParentLink && citationParentLink.href) {
                    resolve({
                      success: true,
                      proceedingUrl: citationParentLink.href,
                      paperTitle: paperTitle
                    });
                    return;
                  }

                  elapsed += INTERVAL;
                  if (elapsed >= MAX_WAIT) {
                    // Cek apakah tertahan tantangan Cloudflare / robot
                    const title = (document.title || '').trim();
                    const isCf = title.includes('Just a moment') ||
                                 title.includes('Attention Required') ||
                                 title.includes('Cloudflare') ||
                                 title.includes('Security Check') ||
                                 !!document.querySelector('#challenge-stage, #challenge-running, .cf-turnstile, iframe[src*="cloudflare"]');
                    if (isCf) {
                      resolve({ success: false, isChallenge: true });
                      return;
                    }

                    // Fallback: cek link proceeding atau toc apapun di halaman
                    const anyProcOrToc = Array.from(document.querySelectorAll('a')).find(a =>
                      a.href && (a.href.includes('/doi/proceedings/') || a.href.includes('/toc/'))
                    );
                    if (anyProcOrToc) {
                      resolve({
                        success: true,
                        proceedingUrl: anyProcOrToc.href,
                        paperTitle: paperTitle
                      });
                      return;
                    }

                    resolve({
                      success: false,
                      error: 'Tidak dapat menemukan link Prosiding atau Jurnal di halaman ACM ini.'
                    });
                    return;
                  }

                  setTimeout(poll, INTERVAL);
                };

                poll();
              });
            });
          };

          let acmArticleData = await getArticleData();
          if (acmArticleData && acmArticleData.isChallenge) {
            await this.waitForRobotVerification(tabId, onStatus);
            acmArticleData = await getArticleData();
          }

          if (!acmArticleData || !acmArticleData.success) {
            throw new Error(acmArticleData ? acmArticleData.error : 'Gagal menemukan link Prosiding/Jurnal ACM.');
          }

          if (!paperOrChapterTitle && acmArticleData.paperTitle) {
            paperOrChapterTitle = acmArticleData.paperTitle;
          }

          const proceedingUrl = acmArticleData.proceedingUrl;
          onStatus(`Membuka Publikasi Induk ACM: ${proceedingUrl}...`);

          await this.updateTabUrl(tabId, proceedingUrl, activeTab);
          await this.waitForTabLoad(tabId, timeoutMs);
          await this.sleep(1800);

          // Cek verifikasi robot saat membuka halaman publikasi induk
          await this.waitForRobotVerification(tabId, onStatus);

          currentTab = await this.getTab(tabId);
          currentUrl = (currentTab && currentTab.url) ? currentTab.url : proceedingUrl;
        }

        // 2. Sekarang berada di halaman Prosiding (/doi/proceedings/...) atau Jurnal TOC (/toc/...) ACM
        await this.waitForRobotVerification(tabId, onStatus);
        onStatus('Halaman Publikasi ACM: Mengekstrak metadata & cover...');

        const getProcData = async () => {
          return await this.executeInTab(tabId, () => {
            return new Promise((resolve) => {
              const MAX_WAIT = 12000;
              const INTERVAL = 300;
              let elapsed = 0;

              const poll = () => {
                const titleEl = document.querySelector(
                  '.colored-block__title h2, h2.left-bordered-title, .colored-block.item-meta h2, .item-meta h2, h1.left-bordered-title, .publication-title, h1, h2'
                );
                const coverImg = document.querySelector(
                  '.overlay-cover-wrapper img, .left-side-image img, img.image-lazy-loaded, img[alt*="cover" i], img[src*=".cover." i], img[data-src*=".cover." i]'
                );
                const fmPdfLink = document.querySelector(
                  'a[href*="/action/showFmPdf"], a[title*="Front matter" i], a[href*="showFmPdf"], a[href*="/doi/pdf/"]'
                );

                if (titleEl || coverImg || fmPdfLink) {
                  const title = titleEl ? titleEl.textContent.trim() : '';

                  let conferenceName = '';
                  let publisher = 'ACM';
                  let isbnOrIssn = '';
                  let year = '';
                  let editors = '';

                  const metaRows = document.querySelectorAll('.item-meta-row');
                  metaRows.forEach(row => {
                    const labelEl = row.querySelector('.item-meta-row__label');
                    const valEl = row.querySelector('.item-meta-row__value');
                    if (!labelEl) return;

                    const labelText = (labelEl.innerText || labelEl.textContent || '').trim().toLowerCase();
                    const valText = valEl ? (valEl.innerText || valEl.textContent || '').trim() : '';

                    if (labelText.includes('conference:')) {
                      conferenceName = valText.replace(/\s+/g, ' ');
                    } else if (labelText.includes('editor:')) {
                      const editorLinks = row.querySelectorAll('.editors-info a, a');
                      if (editorLinks.length > 0) {
                        editors = Array.from(editorLinks).map(a => a.textContent.trim()).filter(Boolean).join(', ');
                      } else {
                        editors = valText.replace(/\s+/g, ' ');
                      }
                    } else if (labelText.includes('publisher:')) {
                      const pubLi = row.querySelector('.published-info ul li, .comma li, li');
                      if (pubLi) {
                        publisher = pubLi.textContent.trim();
                      } else if (valText) {
                        publisher = valText.split(/ISSN|ISBN/i)[0].trim() || publisher;
                      }

                      const issnMatch = valText.match(/ISSN:?\s*([\d-]+)/i);
                      if (issnMatch && !isbnOrIssn) {
                        isbnOrIssn = 'ISSN-' + issnMatch[1];
                      }
                    } else if (labelText.includes('isbn:')) {
                      const isbnMatch = valText.match(/[\d-]+/);
                      isbnOrIssn = isbnMatch ? `ISBN-${isbnMatch[0]}` : valText;
                    } else if (labelText.includes('issn:')) {
                      const issnMatch = valText.match(/[\d-]+/);
                      isbnOrIssn = isbnMatch ? `ISSN-${isbnMatch[0]}` : valText;
                    } else if (labelText.includes('published:')) {
                      const yMatch = valText.match(/\b(19\d\d|20\d\d)\b/);
                      if (yMatch) year = yMatch[1];
                    }
                  });

                  if (!year) {
                    const urlYearMatch = window.location.href.match(/\/(\d{4})\//);
                    if (urlYearMatch) year = urlYearMatch[1];
                  }
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
                  const urlDoiMatch = window.location.href.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
                  if (urlDoiMatch) {
                    doi = urlDoiMatch[0];
                  }

                  resolve({
                    success: true,
                    title: title || conferenceName || 'ACM Publication',
                    subtitle: conferenceName || title,
                    publisher: publisher || 'ACM',
                    isbn: isbnOrIssn || (doi ? `ACM-${doi}` : ''),
                    doi: doi,
                    year: year,
                    editors: editors || 'ACM',
                    coverUrl: coverUrl,
                    coverPdfUrl: coverPdfUrl
                  });
                  return;
                }

                elapsed += INTERVAL;
                if (elapsed >= MAX_WAIT) {
                  // Cek apakah tertahan tantangan Cloudflare / robot
                  const title = (document.title || '').trim();
                  const isCf = title.includes('Just a moment') ||
                               title.includes('Attention Required') ||
                               title.includes('Cloudflare') ||
                               title.includes('Security Check') ||
                               !!document.querySelector('#challenge-stage, #challenge-running, .cf-turnstile, iframe[src*="cloudflare"]');
                  if (isCf) {
                    resolve({ success: false, isChallenge: true });
                    return;
                  }

                  resolve({ success: false, error: 'Waktu tunggu halaman prosiding/jurnal ACM habis.' });
                  return;
                }

                setTimeout(poll, INTERVAL);
              };

              poll();
            });
          });
        };

        let acmProcData = await getProcData();
        if (acmProcData && acmProcData.isChallenge) {
          await this.waitForRobotVerification(tabId, onStatus);
          acmProcData = await getProcData();
        }

        if (!acmProcData || !acmProcData.success) {
          throw new Error(acmProcData ? acmProcData.error : 'Gagal membaca metadata prosiding/jurnal ACM.');
        }

        onStatus(`Ditemukan Publikasi ACM: ${acmProcData.title}. Menyiapkan unduhan...`);

        const isPdfCover = !acmProcData.coverUrl && !!acmProcData.coverPdfUrl;
        const acmIsbnClean = (acmProcData.isbn && typeof isValidIsbn === 'function' && isValidIsbn(acmProcData.isbn))
          ? (typeof sanitizeIsbn === 'function' ? sanitizeIsbn(acmProcData.isbn) : acmProcData.isbn)
          : '';

        return {
          publisherType: 'ACM',
          title: acmProcData.title,
          chapterTitle: paperOrChapterTitle,
          subtitle: acmProcData.subtitle,
          coverUrl: acmProcData.coverUrl || acmProcData.coverPdfUrl,
          coverPdfUrl: acmProcData.coverPdfUrl,
          coverFilename: '',
          isbnElectronic: scopusMeta.isbnElectronic || acmIsbnClean || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: (acmIsbnClean ? (acmIsbnClean.startsWith('ISBN') ? acmIsbnClean : `ISBN-${acmIsbnClean}`) : '') || scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
          doi: acmProcData.doi || scopusMeta.doi || '',
          year: acmProcData.year,
          editors: acmProcData.editors || 'ACM',
          series: acmProcData.subtitle || 'ACM Publications',
          publisher: acmProcData.publisher || 'ACM',
          scopusUrl: scopusUrl,
          bookUrl: currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: isPdfCover
        };
      }

      // ========================================================
      // TAHAP 2E: Jika Publisher adalah SPIE DIGITAL LIBRARY
      // ========================================================
      if (currentUrl.includes('spiedigitallibrary.org') || currentUrl.includes('spie.org') || currentUrl.includes('10.1117')) {
        await this.waitForRobotVerification(tabId, onStatus);

        if (!currentUrl.includes('.toc')) {
          onStatus('Halaman Paper SPIE: Mencari link Proceeding Volume...');
          const docData = await this.executeInTab(tabId, () => {
            const procLink = document.querySelector(
              'a[href*="/conference-proceedings-of-spie/"][href$=".toc"], .DetailStyles-module__headerDetailsLink___nGMdB, a[aria-label*="Volume link"]'
            );
            const titleEl = document.querySelector('h1, .DetailStyles-module__paperTitle___MpP__');
            return {
              proceedingUrl: procLink ? procLink.href : '',
              paperTitle: titleEl ? titleEl.textContent.trim() : ''
            };
          });

          if (docData && docData.paperTitle && !paperOrChapterTitle) {
            paperOrChapterTitle = docData.paperTitle;
          }

          if (docData && docData.proceedingUrl) {
            onStatus(`Membuka Proceeding SPIE: ${docData.proceedingUrl}...`);
            await this.updateTabUrl(tabId, docData.proceedingUrl, activeTab);
            await this.waitForTabLoad(tabId, timeoutMs);
            await this.sleep(1500);

            currentTab = await this.getTab(tabId);
            currentUrl = (currentTab && currentTab.url) ? currentTab.url : docData.proceedingUrl;
          }
        }

        onStatus('Halaman Proceeding SPIE: Mengekstrak metadata & cover...');
        const spieData = await this.executeInTab(tabId, () => {
          const confTitleEl = document.querySelector('.TocHeader-module__titleSlot___qafgr, .TocStyles-module__proceedingsVolumeNumberTitle___ho5AC, h1');
          const confTitle = confTitleEl ? confTitleEl.textContent.trim() : '';

          const bodyText = document.body ? document.body.textContent : '';
          const yearMatch = bodyText.match(/(\b20\d{2}\b)/);
          const year = yearMatch ? yearMatch[1] : '';

          const frontItem = document.querySelector('[id*="FRONTMATTER"] ~ .TocStyles-module__paperItem___uGaLj, .TocStyles-module__paperItem___uGaLj');
          let coverPdfUrl = '';
          let coverTitle = '';
          let coverArnumber = '';
          if (frontItem) {
            const titleLink = frontItem.querySelector('.TocStyles-module__paperTitle___MpP__ a, a[href*="Front-Matter"]');
            if (titleLink) {
              coverTitle = titleLink.textContent.trim();
              const href = titleLink.getAttribute('href') || '';
              const articleIdMatch = href.match(/\/(\d+)\/(\d+)\//);
              if (articleIdMatch) {
                coverArnumber = articleIdMatch[2];
                coverPdfUrl = `https://www.spiedigitallibrary.org/conference-proceedings-of-spie/article-pdf/${articleIdMatch[1]}/${articleIdMatch[2]}/front-matter.pdf`;
              } else if (href) {
                coverPdfUrl = href.startsWith('http') ? href : ('https://www.spiedigitallibrary.org' + (href.startsWith('/') ? '' : '/') + href);
              }
            }
          }

          const imgEl = document.querySelector('.CoverWithLogo-module__coverWithLogoWrapper___QeLwn img, img[alt*="Cover of"], img[src*="Proceedings-Cover"]');
          let coverImageUrl = imgEl ? (imgEl.getAttribute('src') || imgEl.src || '') : '';
          if (coverImageUrl && !coverImageUrl.startsWith('http')) {
            coverImageUrl = 'https://www.spiedigitallibrary.org' + (coverImageUrl.startsWith('/') ? '' : '/') + coverImageUrl;
          }

          return {
            title: confTitle || 'SPIE Conference Proceeding',
            coverTitle: coverTitle || 'Front Matter',
            coverPdfUrl: coverPdfUrl,
            coverImageUrl: coverImageUrl,
            coverArnumber: coverArnumber,
            year: year
          };
        });

        if (!spieData || (!spieData.coverPdfUrl && !spieData.coverImageUrl && !spieData.title)) {
          throw new Error('Gagal mengekstrak metadata dari SPIE Digital Library.');
        }

        const isPdf = !spieData.coverImageUrl && !!spieData.coverPdfUrl;

        return {
          publisherType: 'SPIE',
          title: spieData.title,
          chapterTitle: paperOrChapterTitle,
          subtitle: spieData.coverTitle,
          coverUrl: spieData.coverImageUrl || spieData.coverPdfUrl,
          coverPdfUrl: spieData.coverPdfUrl,
          isPdfCover: isPdf,
          isbnElectronic: scopusMeta.isbnElectronic || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || (spieData.coverArnumber ? `SPIE-${spieData.coverArnumber}` : ''),
          doi: scopusMeta.doi || '',
          year: spieData.year,
          editors: 'SPIE',
          series: 'SPIE Conference Proceedings',
          publisher: 'SPIE Digital Library',
          scopusUrl: scopusUrl,
          bookUrl: currentUrl,
          sourceUrl: currentUrl
        };
      }

      // ========================================================
      // TAHAP 2F: Jika Publisher adalah IGI GLOBAL
      // ========================================================
      if (currentUrl.includes('igi-global.com') || currentUrl.includes('10.4018')) {
        await this.waitForRobotVerification(tabId, onStatus);
        onStatus('Halaman IGI Global: Mengekstrak metadata buku & cover...');

        const igiData = await this.executeInTab(tabId, () => {
          const chapterTitleEl = document.querySelector('h1 span[id*="lblTitleName"], h1.bottom-space, h1');
          const chapterTitle = chapterTitleEl ? chapterTitleEl.textContent.trim() : '';

          const sourceLink = document.querySelector('span[id*="lblSource"] a[href*="/gateway/book/"], a[href*="/gateway/book/"], .bottom-space a[href*="/book/"]');
          const bookTitle = sourceLink ? sourceLink.textContent.trim() : chapterTitle;
          const bookUrl = sourceLink ? (sourceLink.href || '') : '';

          const coverImg = document.querySelector('img[id*="imgCover"], img.cover-img-b, img[src*="coverimages.igi-global.com"], meta[property="og:image"]');
          let coverUrl = '';
          if (coverImg) {
            coverUrl = coverImg.tagName.toLowerCase() === 'meta' ? (coverImg.getAttribute('content') || '') : (coverImg.getAttribute('src') || coverImg.src || '');
          }
          if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

          const isbnEl = document.querySelector('.isbn-doi-inner-platform [title*="ISBN13"], span[title*="ISBN"]');
          let isbn = '';
          if (isbnEl) {
            const rawIsbn = isbnEl.getAttribute('title') || isbnEl.textContent || '';
            const m = rawIsbn.match(/(\d{13}|\d{10})/);
            if (m) isbn = m[1];
          }

          const bodyText = document.body ? document.body.textContent : '';
          const yMatch = bodyText.match(/©\s*(\d{4})|Copyright:?\s*©?\s*(\d{4})|(\b20\d{2}\b)/i);
          const year = yMatch ? (yMatch[1] || yMatch[2] || yMatch[3]) : '';

          return {
            title: bookTitle || chapterTitle || 'IGI Global Book',
            chapterTitle: chapterTitle,
            bookUrl: bookUrl,
            coverUrl: coverUrl,
            isbn: isbn ? `ISBN-${isbn}` : '',
            year: year
          };
        });

        if (!igiData || (!igiData.coverUrl && !igiData.title)) {
          throw new Error('Gagal mengekstrak metadata dari IGI Global.');
        }

        const igiIsbnClean = (igiData.isbn && typeof isValidIsbn === 'function' && isValidIsbn(igiData.isbn))
          ? (typeof sanitizeIsbn === 'function' ? sanitizeIsbn(igiData.isbn) : igiData.isbn)
          : '';

        return {
          publisherType: 'IGI Global',
          title: igiData.title,
          chapterTitle: paperOrChapterTitle || igiData.chapterTitle,
          subtitle: '',
          coverUrl: igiData.coverUrl,
          coverFilename: '',
          isbnElectronic: scopusMeta.isbnElectronic || igiIsbnClean || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: (igiIsbnClean ? (igiIsbnClean.startsWith('ISBN') ? igiIsbnClean : `ISBN-${igiIsbnClean}`) : '') || scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
          doi: scopusMeta.doi || '',
          year: igiData.year,
          editors: 'IGI Global',
          series: 'IGI Global Publishing',
          publisher: 'IGI Global Scientific Publishing',
          scopusUrl: scopusUrl,
          bookUrl: igiData.bookUrl || currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: false
        };
      }

      // ========================================================
      // TAHAP 2G: Jika Publisher adalah ACADEMIC CONFERENCES / PKP OJS
      // ========================================================
      if (currentUrl.includes('academic-conferences.org') || currentUrl.includes('/index.php/')) {
        await this.waitForRobotVerification(tabId, onStatus);

        const ojsScanFunc = () => {
          const titleEl = document.querySelector('h1.page_title, h1, .item.title');
          const paperTitle = titleEl ? titleEl.textContent.trim() : '';

          const issueLink = document.querySelector('.item.issue a.title, .item.issue .value a, .item.cover_image a[href*="/issue/view/"]');
          const issueTitle = issueLink ? issueLink.textContent.trim() : '';
          const issueUrl = issueLink ? issueLink.href : '';

          const coverImg = document.querySelector('.item.cover_image img, img[src*="cover_issue_"], .entry_details .cover_image img, meta[property="og:image"]');
          let coverUrl = '';
          if (coverImg) {
            coverUrl = coverImg.tagName.toLowerCase() === 'meta' ? (coverImg.getAttribute('content') || '') : (coverImg.getAttribute('src') || coverImg.src || '');
          }

          const pubDateEl = document.querySelector('.item.published .value, .published .value');
          let year = '';
          if (pubDateEl) {
            const m = pubDateEl.textContent.match(/\b(19\d\d|20\d\d)\b/);
            if (m) year = m[1];
          }
          if (!year && issueTitle) {
            const m = issueTitle.match(/\b(19\d\d|20\d\d)\b/);
            if (m) year = m[1];
          }

          return {
            paperTitle: paperTitle,
            issueTitle: issueTitle,
            issueUrl: issueUrl,
            coverUrl: coverUrl,
            year: year
          };
        };

        let ojsData = await this.executeInTab(tabId, ojsScanFunc);

        if (ojsData && ojsData.paperTitle && !paperOrChapterTitle) {
          paperOrChapterTitle = ojsData.paperTitle;
        }

        if (ojsData && !ojsData.coverUrl && ojsData.issueUrl) {
          onStatus(`Membuka Issue Induk Academic Conferences: ${ojsData.issueUrl}...`);
          await this.updateTabUrl(tabId, ojsData.issueUrl, activeTab);
          await this.waitForTabLoad(tabId, timeoutMs);
          await this.sleep(1500);

          currentTab = await this.getTab(tabId);
          currentUrl = (currentTab && currentTab.url) ? currentTab.url : ojsData.issueUrl;

          ojsData = await this.executeInTab(tabId, ojsScanFunc);
        }

        if (!ojsData || (!ojsData.coverUrl && !ojsData.issueTitle)) {
          throw new Error('Gagal mengekstrak metadata dari Academic Conferences / OJS.');
        }

        return {
          publisherType: 'Academic Conferences',
          title: ojsData.issueTitle || ojsData.paperTitle || 'Academic Conferences Proceeding',
          chapterTitle: paperOrChapterTitle || ojsData.paperTitle,
          subtitle: '',
          coverUrl: ojsData.coverUrl,
          coverFilename: '',
          isbnElectronic: scopusMeta.isbnElectronic || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
          doi: scopusMeta.doi || '',
          year: ojsData.year,
          editors: 'Academic Conferences',
          series: 'Academic Conferences Publishing',
          publisher: 'Academic Conferences International',
          scopusUrl: scopusUrl,
          bookUrl: ojsData.issueUrl || currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: false
        };
      }

      // ========================================================
      // TAHAP 2H: Jika Publisher adalah IOP PUBLISHING
      // ========================================================
      if (currentUrl.includes('iopscience.iop.org') || currentUrl.includes('10.1088')) {
        await this.waitForRobotVerification(tabId, onStatus);

        const iopScanFunc = () => {
          const titleEl = document.querySelector('h1.article-title, .wd-jnl-art-title, h1');
          const paperTitle = titleEl ? titleEl.textContent.trim() : '';

          const seriesLink = document.querySelector('.wd-jnl-art-breadcrumb-title a, a[data-event-action="Title link"]');
          const seriesTitle = seriesLink ? seriesLink.textContent.trim() : '';
          const seriesUrl = seriesLink ? seriesLink.href : '';

          const volLink = document.querySelector('.wd-jnl-art-breadcrumb-vol a, a[data-event-action="Volume link"]');
          const volName = volLink ? volLink.textContent.trim() : '';

          const coverImg = document.querySelector('#wd-jnl-hm-intro img, .pull-left img, img[src*="cms.iopscience.org"], img[src*="journal_cover"], meta[property="og:image"]');
          let coverUrl = '';
          if (coverImg) {
            coverUrl = coverImg.tagName.toLowerCase() === 'meta' ? (coverImg.getAttribute('content') || '') : (coverImg.getAttribute('src') || coverImg.src || '');
          }

          const bodyText = document.body ? document.body.textContent : '';
          const issnMatch = bodyText.match(/ISSN:?\s*([\d-]+)/i);
          const issn = issnMatch ? issnMatch[1] : '';

          const yMatch = bodyText.match(/Citation.*?\b(19\d\d|20\d\d)\b|©\s*(\d{4})|(\b20\d{2}\b)/i);
          const year = yMatch ? (yMatch[1] || yMatch[2] || yMatch[3]) : '';

          return {
            paperTitle,
            seriesTitle,
            volName,
            seriesUrl,
            coverUrl,
            issn,
            year
          };
        };

        let iopData = await this.executeInTab(tabId, iopScanFunc);

        if (iopData && iopData.paperTitle && !paperOrChapterTitle) {
          paperOrChapterTitle = iopData.paperTitle;
        }

        if (metadataOnly) {
          onStatus('IOP: Selesai mengambil metadata tanpa cover.');
          const fullTitle = (iopData && iopData.seriesTitle) ? `${iopData.seriesTitle}${iopData.volName ? ' (' + iopData.volName + ')' : ''}` : 'IOP Conference Series';
          return {
            publisherType: 'IOP',
            title: fullTitle,
            chapterTitle: paperOrChapterTitle || (iopData && iopData.paperTitle) || '',
            subtitle: (iopData && iopData.volName) || '',
            coverUrl: '',
            coverFilename: 'Tanpa Cover (Mode Cepat)',
            isbnElectronic: scopusMeta.isbnElectronic || '',
            isbnPrint: scopusMeta.isbnPrint || '',
            city: scopusMeta.city || '',
            isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
            doi: scopusMeta.doi || '',
            year: (iopData && iopData.year) || '',
            editors: 'IOP Publishing',
            series: (iopData && iopData.seriesTitle) || 'IOP Publishing',
            publisher: 'IOP Publishing',
            scopusUrl: scopusUrl,
            bookUrl: currentUrl,
            sourceUrl: currentUrl,
            isPdfCover: false
          };
        }

        if (iopData && !iopData.coverUrl && iopData.seriesUrl) {
          onStatus(`Membuka Jurnal/Series Induk IOP: ${iopData.seriesUrl}...`);
          await this.updateTabUrl(tabId, iopData.seriesUrl, activeTab);
          await this.waitForTabLoad(tabId, timeoutMs);
          await this.sleep(1500);

          currentTab = await this.getTab(tabId);
          currentUrl = (currentTab && currentTab.url) ? currentTab.url : iopData.seriesUrl;

          iopData = await this.executeInTab(tabId, iopScanFunc);
        }

        if (!iopData || (!iopData.coverUrl && !iopData.seriesTitle)) {
          throw new Error('Gagal mengekstrak metadata dari IOP Publishing.');
        }

        const fullTitle = iopData.seriesTitle ? `${iopData.seriesTitle}${iopData.volName ? ' (' + iopData.volName + ')' : ''}` : 'IOP Conference Series';

        // PENTING: Jangan masukkan ISSN sebagai ISBN (permintaan user: tolak ISSN)
        return {
          publisherType: 'IOP',
          title: fullTitle,
          chapterTitle: paperOrChapterTitle || iopData.paperTitle,
          subtitle: iopData.volName || '',
          coverUrl: iopData.coverUrl,
          coverFilename: '',
          isbnElectronic: scopusMeta.isbnElectronic || '',
          isbnPrint: scopusMeta.isbnPrint || '',
          city: scopusMeta.city || '',
          isbn: scopusMeta.isbnElectronic || scopusMeta.isbnPrint || '',
          doi: scopusMeta.doi || '',
          year: iopData.year,
          editors: 'IOP Publishing',
          series: iopData.seriesTitle || 'IOP Publishing',
          publisher: 'IOP Publishing',
          scopusUrl: scopusUrl,
          bookUrl: iopData.seriesUrl || currentUrl,
          sourceUrl: currentUrl,
          isPdfCover: false
        };
      }

      // ========================================================
      // TAHAP 2I: Publisher Umum / Smart Fallback
      // ========================================================
      if (!currentUrl.includes('/chapter/') && !currentUrl.includes('/book/')) {
        onStatus('Mencoba mengekstrak metadata publisher umum/fallback...');

        const genericData = await this.executeInTab(tabId, () => {
          const titleEl = document.querySelector('meta[property="og:title"]') ||
                          document.querySelector('meta[name="citation_title"]') ||
                          document.querySelector('h1');
          let title = titleEl ? (titleEl.getAttribute('content') || titleEl.textContent || '').trim() : '';
          if (!title) title = (document.title || '').split('|')[0].trim();

          let coverUrl = '';
          const coverImgCandidates = [
            document.querySelector('img[id*="imgCover" i]'),
            document.querySelector('img.cover-img-b'),
            document.querySelector('.item.cover_image img'),
            document.querySelector('.entry_details .cover_image img'),
            document.querySelector('#wd-jnl-hm-intro img'),
            document.querySelector('.publication-cover-image img'),
            document.querySelector('img[src*="cover" i]'),
            document.querySelector('img[alt*="cover" i]'),
            document.querySelector('meta[property="og:image"]'),
            document.querySelector('meta[name="twitter:image"]')
          ];

          for (const cand of coverImgCandidates) {
            if (!cand) continue;
            let src = cand.tagName.toLowerCase() === 'meta' ? (cand.getAttribute('content') || '') : (cand.getAttribute('src') || cand.src || '');
            if (src && !src.includes('badge') && !src.includes('logo') && !src.includes('icon')) {
              coverUrl = src;
              break;
            }
          }

          if (coverUrl && coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

          const text = document.body ? document.body.textContent : '';
          const yMatch = text.match(/©\s*(\d{4})|Copyright:?\s*©?\s*(\d{4})|(\b20\d{2}\b)/i);
          const year = yMatch ? (yMatch[1] || yMatch[2] || yMatch[3]) : '';

          const isbnMatch = text.match(/ISBN(?:-13)?:?\s*(\d{13}|\d{10})/i);
          const isbn = isbnMatch ? isbnMatch[1] : '';

          return {
            title: title || 'Publisher Document',
            coverUrl: coverUrl,
            year: year,
            isbn: isbn ? `ISBN-${isbn}` : '',
            html: document.documentElement ? document.documentElement.outerHTML : ''
          };
        });

        if (genericData && genericData.coverUrl) {
          onStatus(`Ditemukan Cover Publisher: ${genericData.title}. Menyiapkan unduhan...`);
          let genParsedMeta = {};
          if (genericData.html && typeof extractGenericPublicationMetadata === 'function') {
            try {
              genParsedMeta = extractGenericPublicationMetadata(genericData.html, { sourceUrl: currentUrl });
            } catch (e) {}
          }
          const finalIsbnElec = genParsedMeta.isbnElectronic || scopusMeta.isbnElectronic || '';
          const finalIsbnPrint = genParsedMeta.isbnPrint || scopusMeta.isbnPrint || '';
          const finalCity = genParsedMeta.city || scopusMeta.city || '';
          const finalIsbn = finalIsbnElec || finalIsbnPrint || (genericData.isbn && typeof isValidIsbn === 'function' && isValidIsbn(genericData.isbn) ? genericData.isbn : '');

          return {
            publisherType: 'General',
            title: genericData.title,
            chapterTitle: paperOrChapterTitle,
            subtitle: '',
            coverUrl: metadataOnly ? '' : genericData.coverUrl,
            coverFilename: metadataOnly ? 'Tanpa Cover (Mode Cepat)' : '',
            isbnElectronic: finalIsbnElec,
            isbnPrint: finalIsbnPrint,
            city: finalCity,
            isbn: finalIsbn,
            doi: genParsedMeta.doi || scopusMeta.doi || '',
            year: genericData.year,
            editors: '',
            series: 'General Publication',
            publisher: genParsedMeta.publisher || 'General Publisher',
            scopusUrl: scopusUrl,
            bookUrl: currentUrl,
            sourceUrl: currentUrl,
            isPdfCover: false
          };
        }
      }

      // ========================================================
      // TAHAP 2J: Jika Publisher adalah SPRINGER
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
      bookData.isbnElectronic = bookData.isbnElectronic || scopusMeta.isbnElectronic || '';
      bookData.isbnPrint = bookData.isbnPrint || scopusMeta.isbnPrint || '';
      bookData.city = bookData.city || scopusMeta.city || '';
      if (!bookData.isbn) {
        bookData.isbn = bookData.isbnElectronic || bookData.isbnPrint || '';
      }
      if (!bookData.doi && scopusMeta.doi) {
        bookData.doi = scopusMeta.doi;
      }
      if ((!bookData.publisher || bookData.publisher === 'Springer') && scopusMeta.publisher) {
        bookData.publisher = scopusMeta.publisher;
      }

      if (metadataOnly) {
        bookData.coverUrl = '';
        bookData.coverFilename = 'Tanpa Cover (Mode Cepat)';
      }

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

  async executeInTab(tabId, func, args = []) {
    if (typeof chrome === 'undefined' || !chrome.scripting) {
      throw new Error('API chrome.scripting tidak tersedia.');
    }
    const tab = await this.getTab(tabId);
    if (!tab) {
      throw new Error('Tab telah ditutup atau tidak ditemukan.');
    }
    try {
      const execOpts = {
        target: { tabId },
        func: func
      };
      if (args && (Array.isArray(args) ? args.length > 0 : true)) {
        execOpts.args = Array.isArray(args) ? args : [args];
      }
      const results = await chrome.scripting.executeScript(execOpts);
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
