/**
 * Popup logic for Scopus, Springer & IEEE Cover Scraper
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const urlInput = document.getElementById('urlInput');
  const urlCountBadge = document.getElementById('urlCountBadge');
  const btnPasteSample = document.getElementById('btnPasteSample');
  const btnClearInput = document.getElementById('btnClearInput');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnOpenSidePanel = document.getElementById('btnOpenSidePanel');
  const btnOpenPopout = document.getElementById('btnOpenPopout');
  const btnBannerSidePanel = document.getElementById('btnBannerSidePanel');
  const btnBannerPopout = document.getElementById('btnBannerPopout');
  const popoutBanner = document.getElementById('popoutBanner');

  const subfolderInput = document.getElementById('subfolderInput');
  const namingPatternSelect = document.getElementById('namingPatternSelect');
  const chkActiveTab = document.getElementById('chkActiveTab');
  const chkDownloadCovers = document.getElementById('chkDownloadCovers');
  const chkAutoCsv = document.getElementById('chkAutoCsv');
  const popModeFull = document.getElementById('popModeFull');
  const popModeMetaOnly = document.getElementById('popModeMetaOnly');
  const startScrapingText = document.getElementById('startScrapingText');
  const subfolderFormGroup = document.getElementById('subfolderFormGroup');
  const namingPatternFormGroup = document.getElementById('namingPatternFormGroup');

  function updateScrapeModeUI(isMetaOnly) {
    if (popModeMetaOnly) popModeMetaOnly.checked = isMetaOnly;
    if (popModeFull) popModeFull.checked = !isMetaOnly;
    if (chkDownloadCovers) chkDownloadCovers.checked = !isMetaOnly;

    if (startScrapingText) {
      startScrapingText.textContent = isMetaOnly
        ? '⚡ Mulai Ambil ISBN & Lokasi (Cepat)'
        : '📦 Mulai Scraping & Download Cover';
    }

    if (subfolderFormGroup) subfolderFormGroup.style.opacity = isMetaOnly ? '0.45' : '1';
    if (namingPatternFormGroup) namingPatternFormGroup.style.opacity = isMetaOnly ? '0.45' : '1';
  }

  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  if (popModeFull) {
    popModeFull.addEventListener('change', () => {
      if (popModeFull.checked) {
        updateScrapeModeUI(false);
        saveSettings();
      }
    });
  }

  if (popModeMetaOnly) {
    popModeMetaOnly.addEventListener('change', () => {
      if (popModeMetaOnly.checked) {
        updateScrapeModeUI(true);
        saveSettings();
      }
    });
  }

  const btnStartScraping = document.getElementById('btnStartScraping');
  const btnStopScraping = document.getElementById('btnStopScraping');
  const btnSkipCurrent = document.getElementById('btnSkipCurrent');
  const btnRetryFailed = document.getElementById('btnRetryFailed');
  const retryFailedText = document.getElementById('retryFailedText');

  const progressSection = document.getElementById('progressSection');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const liveStatusMsg = document.getElementById('liveStatusMsg');

  const summarySection = document.getElementById('summarySection');
  const statTotal = document.getElementById('statTotal');
  const statSuccess = document.getElementById('statSuccess');
  const statFailed = document.getElementById('statFailed');
  const btnExportCsv = document.getElementById('btnExportCsv');

  const popupErrorNumbersBox = document.getElementById('popupErrorNumbersBox');
  const btnPopupCopyErrorNums = document.getElementById('btnPopupCopyErrorNums');
  const popupErrorNumberBadges = document.getElementById('popupErrorNumberBadges');

  let scraperEngine = new SpringerScraperEngine();
  let scrapedResults = [];

  // Deteksi mode tampilan (Normal Bubble, Popout Window, atau Side Panel)
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const autostart = urlParams.get('autostart') === '1';
  const isNormalPopup = (mode !== 'popout' && mode !== 'sidepanel');

  if (mode === 'popout') {
    document.body.classList.add('mode-popout');
    if (popoutBanner) popoutBanner.style.display = 'none';
    if (btnOpenPopout) btnOpenPopout.style.display = 'none';
  } else if (mode === 'sidepanel') {
    document.body.classList.add('mode-sidepanel');
    if (popoutBanner) popoutBanner.style.display = 'none';
    if (btnOpenSidePanel) btnOpenSidePanel.style.display = 'none';
  }

  // Load saved settings if any
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['subfolder', 'namingPattern', 'downloadCovers', 'scrapeMode', 'autoCsv', 'activeTab', 'pendingUrls', 'autoRun'], (data) => {
      if (data.subfolder !== undefined) subfolderInput.value = data.subfolder;
      if (data.namingPattern !== undefined && data.namingPattern !== 'title') {
        namingPatternSelect.value = data.namingPattern;
      } else {
        namingPatternSelect.value = 'id_only';
        chrome.storage.local.set({ namingPattern: 'id_only' });
      }
      if (data.scrapeMode !== undefined) {
        updateScrapeModeUI(data.scrapeMode === 'meta_only');
      } else if (data.downloadCovers !== undefined) {
        updateScrapeModeUI(!data.downloadCovers);
      }
      if (data.autoCsv !== undefined) chkAutoCsv.checked = data.autoCsv;
      if (data.activeTab !== undefined && chkActiveTab) chkActiveTab.checked = data.activeTab;

      // Transfer data URL jika berpindah dari popup biasa
      if (data.pendingUrls) {
        urlInput.value = data.pendingUrls;
        updateCountBadge();
        chrome.storage.local.remove(['pendingUrls']);
      }

      if (data.autoRun && autostart) {
        chrome.storage.local.remove(['autoRun']);
        setTimeout(() => {
          btnStartScraping.click();
        }, 350);
      }
    });
  }

  // Save settings on change
  const saveSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const isMetaOnly = popModeMetaOnly ? popModeMetaOnly.checked : !chkDownloadCovers.checked;
      chrome.storage.local.set({
        subfolder: subfolderInput.value.trim(),
        namingPattern: namingPatternSelect.value,
        downloadCovers: !isMetaOnly,
        scrapeMode: isMetaOnly ? 'meta_only' : 'full',
        autoCsv: chkAutoCsv.checked,
        activeTab: chkActiveTab ? chkActiveTab.checked : true
      });
    }
  };

  subfolderInput.addEventListener('change', saveSettings);
  namingPatternSelect.addEventListener('change', saveSettings);
  if (chkActiveTab) chkActiveTab.addEventListener('change', saveSettings);
  chkDownloadCovers.addEventListener('change', () => {
    updateScrapeModeUI(!chkDownloadCovers.checked);
    saveSettings();
  });
  chkAutoCsv.addEventListener('change', saveSettings);

  // Fungsi membuka Side Panel
  const openSidePanel = () => {
    saveSettings();
    chrome.storage.local.set({ pendingUrls: urlInput.value }, () => {
      if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.windows.getCurrent((w) => {
          if (w && w.id) {
            chrome.sidePanel.open({ windowId: w.id });
            if (isNormalPopup) window.close();
          }
        });
      } else if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'OPEN_SIDE_PANEL' }, () => {
          if (isNormalPopup) window.close();
        });
      }
    });
  };

  // Fungsi membuka Popout Window
  const openPopout = (withAutoStart = false) => {
    saveSettings();
    chrome.storage.local.set({ pendingUrls: urlInput.value, autoRun: withAutoStart }, () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'OPEN_POPOUT', autostart: withAutoStart }, () => {
          if (isNormalPopup) window.close();
        });
      }
    });
  };

  if (btnOpenSidePanel) btnOpenSidePanel.addEventListener('click', openSidePanel);
  if (btnBannerSidePanel) btnBannerSidePanel.addEventListener('click', openSidePanel);
  if (btnOpenPopout) btnOpenPopout.addEventListener('click', () => openPopout(false));
  if (btnBannerPopout) btnBannerPopout.addEventListener('click', () => openPopout(false));

  // Parse URLs and ID pairs (supports both plain URLs and ID [TAB/Comma] URL pairs from Excel)
  function parseInputEntries(rawText) {
    if (!rawText) return [];
    const lines = rawText.split(/[\r\n]+/);
    const entries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Abaikan baris header tabel jika ada (misal "ID \t Link Scopus")
      if (/^(no|id|nomor|link)\b/i.test(line) && !line.includes('http')) {
        continue;
      }

      // Cari URL dalam baris
      const urlMatch = line.match(/(https?:\/\/[^\s"',]+)/i);
      if (urlMatch) {
        const url = urlMatch[1];
        // Cek apakah ada ID di depan URL
        const prefix = line.substring(0, urlMatch.index).trim().replace(/[\t,;|]+$/, '').trim();

        let id = '';
        if (prefix) {
          id = prefix.replace(/^["']|["']$/g, '');
        } else {
          // Ambil Scopus ID dari URL jika ada
          const scopusIdMatch = url.match(/\/publications\/(\d+)/i) || url.match(/eid=2-s2\.0-(\d+)/i);
          id = scopusIdMatch ? scopusIdMatch[1] : String(entries.length + 1);
        }

        entries.push({ id, url });
      }
    }

    return entries;
  }

  function updateCountBadge() {
    const entries = parseInputEntries(urlInput.value);
    urlCountBadge.textContent = `${entries.length} link`;
  }

  urlInput.addEventListener('input', updateCountBadge);

  // Paste sample link (Springer, IEEE, & ScienceDirect) dengan format ID [TAB] URL
  btnPasteSample.addEventListener('click', () => {
    const samples = [
      '1\thttps://doi.org/10.1007/978-3-032-11612-3_56',
      '2\thttps://ieeexplore.ieee.org/xpl/conhome/11519603/proceeding',
      '3\thttps://doi.org/10.1016/j.prostr.2023.12.041',
      '4\thttps://doi.org/10.1145/3700706.3700723'
    ];
    const current = urlInput.value.trim();
    const toAdd = samples.filter(s => !current.includes(s.split('\t')[1]));
    if (toAdd.length > 0) {
      urlInput.value = (current ? current + '\n' : '') + toAdd.join('\n');
    }
    updateCountBadge();
  });

  // Clear input
  btnClearInput.addEventListener('click', () => {
    urlInput.value = '';
    updateCountBadge();
  });

  // Open Fullscreen Dashboard / Modes
  const openDashboardTab = (tabName = 'scraper') => {
    saveSettings();
    const query = tabName && tabName !== 'scraper' ? `?tab=${tabName}` : '';
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const dashboardUrl = chrome.runtime.getURL(`dashboard/dashboard.html${query}`);
      chrome.tabs.create({ url: dashboardUrl });
      if (isNormalPopup) window.close();
    } else {
      window.open(`../dashboard/dashboard.html${query}`, '_blank');
    }
  };

  btnOpenDashboard.addEventListener('click', () => openDashboardTab('scraper'));

  const quickNavConverter = document.getElementById('quickNavConverter');
  const quickNavMerger = document.getElementById('quickNavMerger');
  const quickNavScraper = document.getElementById('quickNavScraper');

  if (quickNavConverter) {
    quickNavConverter.addEventListener('click', () => openDashboardTab('converter'));
  }
  if (quickNavMerger) {
    quickNavMerger.addEventListener('click', () => openDashboardTab('merger'));
  }
  if (quickNavScraper) {
    quickNavScraper.addEventListener('click', () => {
      // Jika sudah di popup scraper, cukup scroll ke atas atau fokus
      urlInput.focus();
    });
  }

  // Start Scraping
  btnStartScraping.addEventListener('click', async () => {
    const entries = parseInputEntries(urlInput.value);
    if (entries.length === 0) {
      alert('Silakan masukkan minimal 1 URL Scopus / Springer / IEEE yang valid.');
      urlInput.focus();
      return;
    }

    saveSettings();

    // Handoff jika dibuka di popup bubble biasa
    if (isNormalPopup && chkActiveTab && chkActiveTab.checked) {
      openPopout(true);
      return;
    }

    scrapedResults = [];
    scraperEngine = new SpringerScraperEngine();

    // UI state
    btnStartScraping.disabled = true;
    btnStopScraping.classList.remove('hidden');
    if (btnSkipCurrent) btnSkipCurrent.classList.remove('hidden');
    if (btnRetryFailed) btnRetryFailed.classList.add('hidden');
    progressSection.classList.remove('hidden');
    summarySection.classList.add('hidden');

    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressText.textContent = `Memulai ${entries.length} link...`;
    liveStatusMsg.textContent = 'Membuka tab dan mengikuti alur navigasi...';

    statTotal.textContent = entries.length;
    statSuccess.textContent = '0';
    statFailed.textContent = '0';

    let successCount = 0;
    let failedCount = 0;

    const isMetaOnly = popModeMetaOnly ? popModeMetaOnly.checked : !chkDownloadCovers.checked;

    const popupLiveTableBox = document.getElementById('popupLiveTableBox');
    const popupLiveTableBody = document.getElementById('popupLiveTableBody');
    const popupLiveCount = document.getElementById('popupLiveCount');
    const btnPopupCopyTable = document.getElementById('btnPopupCopyTable');

    if (popupLiveTableBody) popupLiveTableBody.innerHTML = '';
    if (popupLiveCount) popupLiveCount.textContent = '0';
    if (popupLiveTableBox) popupLiveTableBox.classList.remove('hidden');

    function appendPopupTableRow(book) {
      if (!popupLiveTableBody) return;
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f1f5f9';
      const idVal = book.customId || book.id || book.index || '-';
      const isOk = book.status === 'Success' || !String(book.status).startsWith('Gagal');
      tr.innerHTML = `
        <td style="padding:3px 5px;font-weight:bold;color:#334155;">${escapeHtml(String(idVal))}</td>
        <td style="padding:3px 5px;font-family:monospace;color:#025e8d;">${escapeHtml(book.isbnElectronic || '-')}</td>
        <td style="padding:3px 5px;font-family:monospace;color:#475569;">${escapeHtml(book.isbnPrint || '-')}</td>
        <td style="padding:3px 5px;color:#15803d;">${escapeHtml(book.city || '-')}</td>
      `;
      popupLiveTableBody.appendChild(tr);
      if (popupLiveCount) {
        popupLiveCount.textContent = (scraperEngine && scraperEngine.results) ? scraperEngine.results.length : '';
      }
    }

    await scraperEngine.run({
      urls: entries,
      downloadCovers: !isMetaOnly,
      metadataOnly: isMetaOnly,
      subfolder: subfolderInput.value.trim() || 'book-covers',
      namingPattern: namingPatternSelect.value,
      delayMs: isMetaOnly ? 0 : 500,
      activeTab: chkActiveTab ? chkActiveTab.checked : true,

      onProgress: (info) => {
        progressBarFill.style.width = `${info.percent}%`;
        progressPercent.textContent = `${info.percent}%`;
        progressText.textContent = `Buku ${info.index} dari ${info.total}`;
        liveStatusMsg.textContent = info.status || info.url;
      },

      onItemSuccess: (book) => {
        successCount++;
        statSuccess.textContent = successCount;
        liveStatusMsg.textContent = `✓ Sukses: ${book.title}`;
        appendPopupTableRow(book);
      },

      onItemError: (failedItem, err) => {
        failedCount++;
        statFailed.textContent = failedCount;
        liveStatusMsg.textContent = `✕ Gagal: ${failedItem.status || failedItem.sourceUrl}`;
        appendPopupTableRow(failedItem);
      },

      onFinished: (summary) => {
        scrapedResults = summary.results;
        btnStartScraping.disabled = false;
        btnStopScraping.classList.add('hidden');
        if (btnSkipCurrent) btnSkipCurrent.classList.add('hidden');
        summarySection.classList.remove('hidden');

        // Tampilkan tombol Retry dan Nomor Error jika ada yang gagal
        if (summary.failedCount > 0) {
          const failedItems = scraperEngine.getFailedItems ? scraperEngine.getFailedItems() : [];
          if (popupErrorNumbersBox) {
            if (popupErrorNumberBadges) {
              popupErrorNumberBadges.innerHTML = failedItems
                .map(f => `<span style="background:#fee2e2;border:1px solid #fca5a5;padding:1px 6px;border-radius:4px;cursor:pointer;" title="Klik untuk salin">${f.id}</span>`)
                .join(' ');
              // Bind click to individual badge
              popupErrorNumberBadges.querySelectorAll('span').forEach(sp => {
                sp.addEventListener('click', () => {
                  navigator.clipboard.writeText(sp.textContent);
                  sp.style.background = '#d1fae5';
                  setTimeout(() => { sp.style.background = '#fee2e2'; }, 1000);
                });
              });
            }
            popupErrorNumbersBox.classList.remove('hidden');
          }

          if (btnRetryFailed) {
            if (retryFailedText) {
              retryFailedText.textContent = `Coba Lagi yang Gagal (${summary.failedCount} link)`;
            }
            btnRetryFailed.classList.remove('hidden');
          }
        } else {
          if (popupErrorNumbersBox) popupErrorNumbersBox.classList.add('hidden');
          if (btnRetryFailed) btnRetryFailed.classList.add('hidden');
        }

        progressBarFill.style.width = '100%';
        progressPercent.textContent = '100%';
        progressText.textContent = summary.wasCancelled ? 'Dihentikan oleh pengguna.' : 'Selesai!';
        liveStatusMsg.textContent = `Selesai. Sukses: ${summary.successCount} | Gagal: ${summary.failedCount}`;

        // Auto download CSV if enabled
        if (chkAutoCsv.checked && summary.results.length > 0) {
          setTimeout(() => {
            downloadCsv(summary.results, 'metadata_scopus_springer_ieee.csv');
          }, 600);
        }
      }
    });
  });

  // Skip Current Tab
  if (btnSkipCurrent) {
    btnSkipCurrent.addEventListener('click', () => {
      if (scraperEngine) {
        scraperEngine.skipCurrent();
        liveStatusMsg.textContent = '⏩ Melewati link ini, lanjut berikutnya...';
      }
    });
  }

  // Retry Failed
  if (btnRetryFailed) {
    btnRetryFailed.addEventListener('click', () => {
      const failedUrls = scraperEngine ? scraperEngine.getFailedUrls() : [];
      if (failedUrls.length === 0) {
        alert('Tidak ada link yang gagal untuk dicoba ulang.');
        return;
      }
      urlInput.value = failedUrls.join('\n');
      updateCountBadge();
      btnRetryFailed.classList.add('hidden');
      btnStartScraping.click();
    });
  }

  // Stop Scraping
  btnStopScraping.addEventListener('click', () => {
    if (scraperEngine) {
      scraperEngine.cancel();
      liveStatusMsg.textContent = 'Menghentikan proses...';
    }
  });

  // Export CSV button
  btnExportCsv.addEventListener('click', () => {
    const currentList = (scraperEngine && scraperEngine.results && scraperEngine.results.length > 0)
      ? scraperEngine.results
      : scrapedResults;
    if (currentList.length === 0) {
      alert('Belum ada data yang berhasil di-scrape.');
      return;
    }
    downloadCsv(currentList, 'metadata_scopus_springer_ieee.csv');
  });

  // Helper Salin Tabel di Popup
  const btnPopupCopyTable = document.getElementById('btnPopupCopyTable');
  if (btnPopupCopyTable) {
    btnPopupCopyTable.addEventListener('click', () => {
      const currentList = (scraperEngine && scraperEngine.results && scraperEngine.results.length > 0)
        ? scraperEngine.results
        : scrapedResults;
      if (currentList.length === 0) {
        alert('Belum ada data tabel yang bisa disalin.');
        return;
      }

      const headers = ['No/ID', 'Judul Buku / Prosiding', 'Judul Paper / Bab', 'Penerbit', 'Kota / Lokasi', 'ISBN Electronic', 'ISBN Print', 'ISBN Gabungan', 'Tahun', 'DOI', 'Status', 'Link Sumber'];
      const rows = currentList.map((item, idx) => {
        const idVal = item.customId || item.id || (idx + 1);
        return [
          idVal,
          item.title || '',
          item.chapterTitle || '',
          item.publisher || '',
          item.city || '',
          item.isbnElectronic || '',
          item.isbnPrint || '',
          item.isbn || '',
          item.year || '',
          item.doi || '',
          item.status || '',
          item.scopusUrl || item.sourceUrl || item.bookUrl || ''
        ].map(val => String(val || '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t');
      });

      const tsvContent = [headers.join('\t'), ...rows].join('\n');
      navigator.clipboard.writeText(tsvContent).then(() => {
        const orig = btnPopupCopyTable.innerHTML;
        btnPopupCopyTable.innerHTML = '✓ Disalin!';
        setTimeout(() => { btnPopupCopyTable.innerHTML = orig; }, 1800);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = tsvContent;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const orig = btnPopupCopyTable.innerHTML;
        btnPopupCopyTable.innerHTML = '✓ Disalin!';
        setTimeout(() => { btnPopupCopyTable.innerHTML = orig; }, 1800);
      });
    });
  }

  // Salin Nomor Gagal di Popup
  if (btnPopupCopyErrorNums) {
    btnPopupCopyErrorNums.addEventListener('click', () => {
      const failedItems = scraperEngine ? scraperEngine.getFailedItems() : [];
      if (failedItems.length === 0) return;
      const text = failedItems.map(f => f.id).join(', ');
      navigator.clipboard.writeText(text).then(() => {
        btnPopupCopyErrorNums.textContent = '✓ Tersalin!';
        setTimeout(() => { btnPopupCopyErrorNums.textContent = '📋 Salin Nomor'; }, 1800);
      });
    });
  }

  updateCountBadge();
});
