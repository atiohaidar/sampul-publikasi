/**
 * Dashboard Logic for Scopus, Springer & IEEE Book/Proceeding Cover Scraper
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dashUrlInput = document.getElementById('dashUrlInput');
  const dashUrlCount = document.getElementById('dashUrlCount');
  const btnDashSample = document.getElementById('btnDashSample');
  const btnDashSampleIeee = document.getElementById('btnDashSampleIeee');
  const btnDashSampleSd = document.getElementById('btnDashSampleSd');
  const btnDashSampleAcm = document.getElementById('btnDashSampleAcm');
  const btnDashImportFile = document.getElementById('btnDashImportFile');
  const fileInputTxt = document.getElementById('fileInputTxt');
  const btnDashClear = document.getElementById('btnDashClear');

  const dashSubfolder = document.getElementById('dashSubfolder');
  const dashSubfolderPng = document.getElementById('dashSubfolderPng');
  const dashNamingPattern = document.getElementById('dashNamingPattern');
  const dashDelay = document.getElementById('dashDelay');
  const dashChkActiveTab = document.getElementById('dashChkActiveTab');
  const dashChkPngFolder = document.getElementById('dashChkPngFolder');
  const dashChkCovers = document.getElementById('dashChkCovers');
  const dashChkAutoCsv = document.getElementById('dashChkAutoCsv');

  const btnDashStart = document.getElementById('btnDashStart');
  const btnDashStop = document.getElementById('btnDashStop');
  const btnDashSkip = document.getElementById('btnDashSkip');
  const btnDashRetryFailed = document.getElementById('btnDashRetryFailed');
  const dashRetryText = document.getElementById('dashRetryText');
  const btnDashExportCsv = document.getElementById('btnDashExportCsv');

  const metricTotal = document.getElementById('metricTotal');
  const metricSuccess = document.getElementById('metricSuccess');
  const metricFailed = document.getElementById('metricFailed');

  const dashProgressBox = document.getElementById('dashProgressBox');
  const dashProgressStatus = document.getElementById('dashProgressStatus');
  const dashProgressPercent = document.getElementById('dashProgressPercent');
  const dashProgressBar = document.getElementById('dashProgressBar');
  const dashLiveDetail = document.getElementById('dashLiveDetail');

  const dashErrorBox = document.getElementById('dashErrorBox');
  const dashErrorSummaryTitle = document.getElementById('dashErrorSummaryTitle');
  const dashErrorNumberBadges = document.getElementById('dashErrorNumberBadges');
  const dashErrorTableBody = document.getElementById('dashErrorTableBody');
  const btnCopyErrorNumbers = document.getElementById('btnCopyErrorNumbers');
  const btnCopyErrorRows = document.getElementById('btnCopyErrorRows');
  const btnLoadErrorsToInput = document.getElementById('btnLoadErrorsToInput');

  const dashTableBody = document.getElementById('dashTableBody');

  let scraperEngine = new SpringerScraperEngine();
  let scrapedResults = [];
  let failedItems = [];

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

  function updateUrlCount() {
    const entries = parseInputEntries(dashUrlInput.value);
    dashUrlCount.textContent = `${entries.length} link`;
  }

  dashUrlInput.addEventListener('input', updateUrlCount);

  // Load saved settings & pending URLs if transferred from popup
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['subfolder', 'subfolderPng', 'namingPattern', 'downloadCovers', 'savePngFolder', 'autoCsv', 'activeTab', 'pendingUrls'], (data) => {
      if (data.subfolder !== undefined && dashSubfolder) dashSubfolder.value = data.subfolder;
      if (data.subfolderPng !== undefined && dashSubfolderPng) dashSubfolderPng.value = data.subfolderPng;
      if (data.namingPattern !== undefined && data.namingPattern !== 'title' && dashNamingPattern) {
        dashNamingPattern.value = data.namingPattern;
      } else if (dashNamingPattern) {
        dashNamingPattern.value = 'id_only';
        chrome.storage.local.set({ namingPattern: 'id_only' });
      }
      if (data.downloadCovers !== undefined && dashChkCovers) dashChkCovers.checked = data.downloadCovers;
      if (data.savePngFolder !== undefined && dashChkPngFolder) dashChkPngFolder.checked = data.savePngFolder;
      if (data.autoCsv !== undefined && dashChkAutoCsv) dashChkAutoCsv.checked = data.autoCsv;
      if (data.activeTab !== undefined && dashChkActiveTab) dashChkActiveTab.checked = data.activeTab;

      if (data.pendingUrls && !dashUrlInput.value.trim()) {
        dashUrlInput.value = data.pendingUrls;
        updateUrlCount();
        chrome.storage.local.remove(['pendingUrls']);
      }
    });

    if (dashSubfolder) {
      dashSubfolder.addEventListener('change', () => {
        chrome.storage.local.set({ subfolder: dashSubfolder.value.trim() });
      });
    }
    if (dashSubfolderPng) {
      dashSubfolderPng.addEventListener('change', () => {
        chrome.storage.local.set({ subfolderPng: dashSubfolderPng.value.trim() });
      });
    }
    if (dashChkPngFolder) {
      dashChkPngFolder.addEventListener('change', () => {
        chrome.storage.local.set({ savePngFolder: dashChkPngFolder.checked });
      });
    }
    if (dashChkCovers) {
      dashChkCovers.addEventListener('change', () => {
        chrome.storage.local.set({ downloadCovers: dashChkCovers.checked });
      });
    }
    if (dashChkAutoCsv) {
      dashChkAutoCsv.addEventListener('change', () => {
        chrome.storage.local.set({ autoCsv: dashChkAutoCsv.checked });
      });
    }
    if (dashNamingPattern) {
      dashNamingPattern.addEventListener('change', () => {
        chrome.storage.local.set({ namingPattern: dashNamingPattern.value });
      });
    }
  }

  // Sample Springer URL dengan format ID [TAB] URL
  btnDashSample.addEventListener('click', () => {
    const sample = '1\thttps://doi.org/10.1007/978-3-032-11612-3_56';
    if (!dashUrlInput.value.includes(sample.split('\t')[1])) {
      dashUrlInput.value = (dashUrlInput.value.trim() ? dashUrlInput.value.trim() + '\n' : '') + sample;
    }
    updateUrlCount();
  });

  // Sample IEEE Xplore URL dengan format ID [TAB] URL
  btnDashSampleIeee.addEventListener('click', () => {
    const sample = '2\thttps://ieeexplore.ieee.org/xpl/conhome/11519603/proceeding';
    if (!dashUrlInput.value.includes(sample.split('\t')[1])) {
      dashUrlInput.value = (dashUrlInput.value.trim() ? dashUrlInput.value.trim() + '\n' : '') + sample;
    }
    updateUrlCount();
  });

  // Sample Elsevier / ScienceDirect URL dengan format ID [TAB] URL
  if (btnDashSampleSd) {
    btnDashSampleSd.addEventListener('click', () => {
      const samples = [
        '3\thttps://doi.org/10.1016/B978-0-443-33871-7.00017-9',
        '4\thttps://doi.org/10.1016/j.prostr.2023.12.041'
      ];
      const current = dashUrlInput.value.trim();
      const toAdd = samples.filter(s => !current.includes(s.split('\t')[1]));
      if (toAdd.length > 0) {
        dashUrlInput.value = (current ? current + '\n' : '') + toAdd.join('\n');
      }
      updateUrlCount();
    });
  }

  // Sample ACM Digital Library URL dengan format ID [TAB] URL
  if (btnDashSampleAcm) {
    btnDashSampleAcm.addEventListener('click', () => {
      const samples = [
        '5\thttps://doi.org/10.1145/3700706.3700723',
        '6\thttps://doi.org/10.14778/3725688.3725716'
      ];
      const current = dashUrlInput.value.trim();
      const toAdd = samples.filter(s => !current.includes(s.split('\t')[1]));
      if (toAdd.length > 0) {
        dashUrlInput.value = (current ? current + '\n' : '') + toAdd.join('\n');
      }
      updateUrlCount();
    });
  }

  // Import TXT or CSV file
  btnDashImportFile.addEventListener('click', () => {
    fileInputTxt.click();
  });

  fileInputTxt.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      const entries = parseInputEntries(content);

      if (entries.length > 0) {
        const formatted = entries.map(ent => `${ent.id}\t${ent.url}`).join('\n');
        const existing = dashUrlInput.value.trim();
        dashUrlInput.value = (existing ? existing + '\n' : '') + formatted;
        updateUrlCount();
        alert(`Berhasil mengimpor ${entries.length} link dari file.`);
      } else {
        alert('Tidak ditemukan URL yang valid di file ini.');
      }
    };
    reader.readAsText(file);
    fileInputTxt.value = '';
  });

  // Clear button
  btnDashClear.addEventListener('click', () => {
    if (confirm('Yakin ingin mengosongkan daftar URL?')) {
      dashUrlInput.value = '';
      updateUrlCount();
    }
  });

  // Render Table Row
  function appendTableRow(book) {
    const emptyRow = dashTableBody.querySelector('.empty-row');
    if (emptyRow) {
      emptyRow.remove();
    }

    const tr = document.createElement('tr');
    const displayId = book.customId || book.id || book.index;
    tr.id = `book-row-${book.index}`;

    const isSuccess = book.status === 'Success';
    const displayThumb = book.coverThumbnailUrl || (book.isPdfCover ? '' : book.coverUrl);

    tr.innerHTML = `
      <td><b>${escapeHtml(String(displayId))}</b></td>
      <td>
        <div class="cover-thumb-box">
          ${displayThumb ? `
            <a href="${displayThumb}" target="_blank" title="Lihat Pratinjau Cover">
              <img class="cover-thumb-img" src="${displayThumb}" alt="Cover" loading="lazy" onerror="this.src='../icons/icon48.png'">
            </a>
          ` : (book.isPdfCover && book.coverPdfUrl ? `
            <a href="${book.coverPdfUrl}" target="_blank" title="Buka PDF Cover" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-decoration:none;color:#dc2626;font-weight:bold;font-size:10px;">
              📄 PDF
            </a>
          ` : `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;">No Pic</div>
          `)}
        </div>
      </td>
      <td>
        <div class="title-cell">
          <a class="book-title-link" href="${book.bookUrl || book.sourceUrl}" target="_blank" title="Buka halaman Sumber">
            ${escapeHtml(book.title)}
          </a>
          ${book.chapterTitle ? `<span style="font-size:11px;color:#025e8d;">📄 <b>Paper/Chapter:</b> ${escapeHtml(book.chapterTitle)}</span>` : ''}
          ${book.subtitle && book.subtitle !== book.title ? `<span class="book-subtitle">${escapeHtml(book.subtitle)}</span>` : ''}
          ${book.series ? `<span class="sub-meta">📚 ${escapeHtml(book.series)}</span>` : ''}
        </div>
      </td>
      <td>
        <div style="font-size:11px;">
          <div><b>Penerbit:</b> <span style="color:#025e8d;font-weight:600;">${escapeHtml(book.publisher || 'Unknown')}</span></div>
          ${book.city ? `<div style="margin-top:2px;"><b>Lokasi:</b> <span style="color:#15803d;font-weight:600;">📍 ${escapeHtml(book.city)}</span></div>` : ''}
          ${book.doi ? `<div style="margin-top:2px;color:var(--text-muted);"><b>DOI:</b> ${escapeHtml(book.doi)}</div>` : ''}
        </div>
      </td>
      <td>
        <div style="font-size:11px;">
          <div><b>Elec:</b> <span style="font-family:monospace;color:#025e8d;font-weight:600;">${escapeHtml(book.isbnElectronic || '-')}</span></div>
          <div><b>Print:</b> <span style="font-family:monospace;color:#334155;">${escapeHtml(book.isbnPrint || '-')}</span></div>
          ${(!book.isbnElectronic && !book.isbnPrint && book.isbn) ? `<div style="color:var(--text-muted);"><b>ID:</b> ${escapeHtml(book.isbn)}</div>` : ''}
        </div>
      </td>
      <td>
        <div style="font-size:11px;">
          <div>${escapeHtml(book.editors || 'Penulis / Editor')}</div>
          <div style="color:var(--text-muted);">${book.year ? `© ${book.year}` : ''}</div>
        </div>
      </td>
      <td>
        <code style="font-size:11px;word-break:break-all;">${escapeHtml(book.coverFilename || '-')}</code>
      </td>
      <td>
        <span class="badge-status ${isSuccess ? 'badge-success' : 'badge-error'}">
          ${isSuccess ? 'Sukses' : 'Gagal'}
        </span>
      </td>
      <td>
        ${(book.coverUrl || book.coverPdfUrl) ? `
          <button class="btn-action-download" type="button" title="Unduh ulang file cover ini">
            Unduh
          </button>
        ` : '-'}
      </td>
    `;

    // Bind download button
    const btnDownload = tr.querySelector('.btn-action-download');
    if (btnDownload && (book.coverUrl || book.coverPdfUrl)) {
      btnDownload.addEventListener('click', () => {
        const subfolder = dashSubfolder.value.trim() || 'book-covers';
        const targetUrl = book.coverPdfUrl || book.coverUrl;
        const targetName = book.coverFilename.includes('&') ? book.coverFilename.split('&')[0].trim() : book.coverFilename;
        scraperEngine.triggerDownload(targetUrl, `${subfolder}/${targetName}`);
      });
    }

    dashTableBody.appendChild(tr);
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
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // Helper Salin Teks ke Clipboard dengan Animasi Feedback
  function copyTextToClipboard(text, btnElement, successText = '✓ Tersalin!') {
    const origText = btnElement.innerText || btnElement.textContent;
    const onSuccess = () => {
      btnElement.classList.add('copied');
      btnElement.textContent = successText;
      setTimeout(() => {
        btnElement.classList.remove('copied');
        btnElement.textContent = origText;
      }, 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        fallbackCopy(text);
        onSuccess();
      });
    } else {
      fallbackCopy(text);
      onSuccess();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  // Render Box Log Error
  function renderErrorBox() {
    if (!dashErrorBox) return;

    if (failedItems.length === 0) {
      dashErrorBox.classList.add('hidden');
      return;
    }

    dashErrorBox.classList.remove('hidden');
    if (dashErrorSummaryTitle) {
      dashErrorSummaryTitle.textContent = `Terdeteksi ${failedItems.length} Link Mengalami Kendala (Gagal)`;
    }

    // Render badge nomor-nomor yang error
    if (dashErrorNumberBadges) {
      dashErrorNumberBadges.innerHTML = '';
      failedItems.forEach(item => {
        const badge = document.createElement('span');
        badge.className = 'badge-num-error';
        badge.textContent = item.id;
        badge.title = `Klik untuk salin nomor/ID: ${item.id}`;
        badge.addEventListener('click', () => {
          copyTextToClipboard(item.id, badge, '✓');
        });
        dashErrorNumberBadges.appendChild(badge);
      });
    }

    // Render rincian tabel error
    if (dashErrorTableBody) {
      dashErrorTableBody.innerHTML = '';
      failedItems.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${escapeHtml(item.id)}</b></td>
          <td><a href="${item.url}" target="_blank" title="Buka Link di Tab Baru">${escapeHtml(item.url)}</a></td>
          <td style="color:#b91c1c; font-weight:500;">${escapeHtml(item.error || 'Gagal')}</td>
        `;
        dashErrorTableBody.appendChild(tr);
      });
    }
  }

  // Tombol Salin Nomor Saja (e.g. 3, 7, 12)
  if (btnCopyErrorNumbers) {
    btnCopyErrorNumbers.addEventListener('click', () => {
      if (failedItems.length === 0) return;
      const text = failedItems.map(f => f.id).join(', ');
      copyTextToClipboard(text, btnCopyErrorNumbers, '✓ Nomor Tersalin!');
    });
  }

  // Tombol Salin Baris Gagal Lengkap (ID + Link) untuk Excel
  if (btnCopyErrorRows) {
    btnCopyErrorRows.addEventListener('click', () => {
      if (failedItems.length === 0) return;
      const text = failedItems.map(f => `${f.id}\t${f.url}`).join('\n');
      copyTextToClipboard(text, btnCopyErrorRows, '✓ Baris Tersalin!');
    });
  }

  // Tombol Muat Ulang Link Gagal ke Textarea Input
  if (btnLoadErrorsToInput) {
    btnLoadErrorsToInput.addEventListener('click', () => {
      if (failedItems.length === 0) return;
      const text = failedItems.map(f => `${f.id}\t${f.url}`).join('\n');
      dashUrlInput.value = text;
      updateUrlCount();
      dashUrlInput.focus();
      btnLoadErrorsToInput.classList.add('copied');
      btnLoadErrorsToInput.textContent = '✓ Termuat di Input!';
      setTimeout(() => {
        btnLoadErrorsToInput.classList.remove('copied');
        btnLoadErrorsToInput.textContent = '🔄 Muat ke Kotak Input';
      }, 1800);
    });
  }

  // Start Process
  btnDashStart.addEventListener('click', async () => {
    const entries = parseInputEntries(dashUrlInput.value);
    if (entries.length === 0) {
      alert('Silakan masukkan minimal 1 URL Scopus / Springer / IEEE.');
      dashUrlInput.focus();
      return;
    }

    scrapedResults = [];
    failedItems = [];
    scraperEngine = new SpringerScraperEngine();

    // Reset Table & Error Box
    dashTableBody.innerHTML = '';
    btnDashExportCsv.disabled = true;
    renderErrorBox();

    // Reset Metrics
    metricTotal.textContent = entries.length;
    metricSuccess.textContent = '0';
    metricFailed.textContent = '0';

    let successCount = 0;
    let failedCount = 0;

    // Show Progress
    btnDashStart.disabled = true;
    btnDashStop.classList.remove('hidden');
    if (btnDashSkip) btnDashSkip.classList.remove('hidden');
    if (btnDashRetryFailed) btnDashRetryFailed.classList.add('hidden');
    dashProgressBox.classList.remove('hidden');
    dashProgressBar.style.width = '0%';
    dashProgressPercent.textContent = '0%';
    dashProgressStatus.textContent = 'Membuka tab browser dan mengikuti proses...';
    dashLiveDetail.textContent = '';

    const delaySeconds = parseFloat(dashDelay.value) || 1.5;
    const shouldFocusTab = dashChkActiveTab.checked; // User requested tab to be visible and followed!

    await scraperEngine.run({
      urls: entries,
      downloadCovers: dashChkCovers.checked,
      subfolder: dashSubfolder.value.trim() || 'book-covers',
      savePngFolder: dashChkPngFolder ? dashChkPngFolder.checked : true,
      subfolderPng: dashSubfolderPng ? dashSubfolderPng.value.trim() : 'book-covers-png',
      namingPattern: dashNamingPattern.value,
      delayMs: Math.max(500, Math.floor(delaySeconds * 1000)),
      activeTab: shouldFocusTab,

      onProgress: (info) => {
        dashProgressBar.style.width = `${info.percent}%`;
        dashProgressPercent.textContent = `${info.percent}%`;
        dashProgressStatus.textContent = info.status || `[${info.index}/${info.total}]`;
        dashLiveDetail.textContent = info.url || '';
      },

      onItemSuccess: (book) => {
        successCount++;
        metricSuccess.textContent = successCount;
        appendTableRow(book);
      },

      onItemError: (failedItem, err) => {
        failedCount++;
        metricFailed.textContent = failedCount;
        appendTableRow(failedItem);

        // Catat ke daftar item error untuk panel log
        failedItems.push({
          index: failedItem.index,
          id: String(failedItem.customId || failedItem.id || failedItem.index),
          url: failedItem.scopusUrl || failedItem.sourceUrl || '',
          error: failedItem.status ? failedItem.status.replace(/^Gagal:\s*/i, '') : 'Gagal'
        });
        renderErrorBox();
      },

      onFinished: (summary) => {
        scrapedResults = summary.results;
        btnDashStart.disabled = false;
        btnDashStop.classList.add('hidden');
        if (btnDashSkip) btnDashSkip.classList.add('hidden');

        renderErrorBox();

        // Show Retry button if there are failed URLs
        if (summary.failedCount > 0 && btnDashRetryFailed) {
          if (dashRetryText) {
            dashRetryText.textContent = `Coba Lagi yang Gagal (${summary.failedCount} link)`;
          }
          btnDashRetryFailed.classList.remove('hidden');
        } else if (btnDashRetryFailed) {
          btnDashRetryFailed.classList.add('hidden');
        }

        dashProgressBar.style.width = '100%';
        dashProgressPercent.textContent = '100%';
        dashProgressStatus.textContent = summary.wasCancelled
          ? 'Proses dihentikan oleh pengguna.'
          : `Selesai! Berhasil: ${summary.successCount} | Gagal: ${summary.failedCount}`;
        dashLiveDetail.textContent = '';

        if (summary.results.length > 0) {
          btnDashExportCsv.disabled = false;

          // Auto-download CSV if enabled
          if (dashChkAutoCsv.checked) {
            setTimeout(() => {
              downloadCsv(summary.results, 'metadata_scopus_springer_ieee.csv');
            }, 600);
          }
        }
      }
    });
  });

  // Skip button
  if (btnDashSkip) {
    btnDashSkip.addEventListener('click', () => {
      if (scraperEngine) {
        scraperEngine.skipCurrent();
        dashProgressStatus.textContent = '⏩ Melewati link ini, lanjut berikutnya...';
      }
    });
  }

  // Retry Failed button
  if (btnDashRetryFailed) {
    btnDashRetryFailed.addEventListener('click', () => {
      const failedUrls = scraperEngine ? scraperEngine.getFailedUrls() : [];
      if (failedUrls.length === 0) {
        alert('Tidak ada link yang gagal untuk dicoba ulang.');
        return;
      }
      dashUrlInput.value = failedUrls.join('\n');
      updateUrlCount();
      btnDashRetryFailed.classList.add('hidden');
      btnDashStart.click();
    });
  }

  // Stop button
  btnDashStop.addEventListener('click', () => {
    if (scraperEngine) {
      scraperEngine.cancel();
      dashProgressStatus.textContent = 'Menghentikan proses scraping...';
    }
  });

  // Export CSV button
  btnDashExportCsv.addEventListener('click', () => {
    if (scrapedResults.length === 0) {
      alert('Belum ada data untuk diekspor.');
      return;
    }
    downloadCsv(scrapedResults, 'metadata_scopus_springer_ieee.csv');
  });

  updateUrlCount();

  // ========================================================
  // MODE TABS SWITCHER (Scraper Link vs Konverter PNG vs Penggabung CSV)
  // ========================================================
  const tabBtnScraper = document.getElementById('tabBtnScraper');
  const tabBtnConverter = document.getElementById('tabBtnConverter');
  const tabBtnMerger = document.getElementById('tabBtnMerger');

  const sidebarScraperPanel = document.getElementById('sidebarScraperPanel');
  const sidebarConverterPanel = document.getElementById('sidebarConverterPanel');
  const sidebarMergerPanel = document.getElementById('sidebarMergerPanel');

  const mainScraperBoard = document.getElementById('mainScraperBoard');
  const mainConverterBoard = document.getElementById('mainConverterBoard');
  const mainMergerBoard = document.getElementById('mainMergerBoard');

  function switchTabMode(activeTab) {
    if (tabBtnScraper) tabBtnScraper.classList.toggle('active', activeTab === 'scraper');
    if (tabBtnConverter) tabBtnConverter.classList.toggle('active', activeTab === 'converter');
    if (tabBtnMerger) tabBtnMerger.classList.toggle('active', activeTab === 'merger');

    if (sidebarScraperPanel) sidebarScraperPanel.classList.toggle('hidden', activeTab !== 'scraper');
    if (sidebarConverterPanel) sidebarConverterPanel.classList.toggle('hidden', activeTab !== 'converter');
    if (sidebarMergerPanel) sidebarMergerPanel.classList.toggle('hidden', activeTab !== 'merger');

    if (mainScraperBoard) mainScraperBoard.classList.toggle('hidden', activeTab !== 'scraper');
    if (mainConverterBoard) mainConverterBoard.classList.toggle('hidden', activeTab !== 'converter');
    if (mainMergerBoard) mainMergerBoard.classList.toggle('hidden', activeTab !== 'merger');
  }

  if (tabBtnScraper) tabBtnScraper.addEventListener('click', () => switchTabMode('scraper'));
  if (tabBtnConverter) tabBtnConverter.addEventListener('click', () => switchTabMode('converter'));
  if (tabBtnMerger) tabBtnMerger.addEventListener('click', () => switchTabMode('merger'));

  // ========================================================
  // LOGIKA KONVERTER FOLDER COVER KE PNG
  // ========================================================
  const btnPickFolder = document.getElementById('btnPickFolder');
  const inputFolderFiles = document.getElementById('inputFolderFiles');
  const btnPickFiles = document.getElementById('btnPickFiles');
  const inputFileList = document.getElementById('inputFileList');
  const convDropzoneArea = document.getElementById('convDropzoneArea');
  const convTargetSubfolder = document.getElementById('convTargetSubfolder');
  const convFileCountBadge = document.getElementById('convFileCountBadge');
  const convStatTotal = document.getElementById('convStatTotal');
  const convStatBreakdown = document.getElementById('convStatBreakdown');
  const btnStartConvert = document.getElementById('btnStartConvert');
  const btnStopConvert = document.getElementById('btnStopConvert');
  const btnClearConvert = document.getElementById('btnClearConvert');

  const convMetricTotal = document.getElementById('convMetricTotal');
  const convMetricSuccess = document.getElementById('convMetricSuccess');
  const convMetricFailed = document.getElementById('convMetricFailed');

  const convProgressBox = document.getElementById('convProgressBox');
  const convProgressStatus = document.getElementById('convProgressStatus');
  const convProgressPercent = document.getElementById('convProgressPercent');
  const convProgressBar = document.getElementById('convProgressBar');
  const convLiveDetail = document.getElementById('convLiveDetail');

  const convErrorBox = document.getElementById('convErrorBox');
  const convErrorSummaryTitle = document.getElementById('convErrorSummaryTitle');
  const convErrorNumberBadges = document.getElementById('convErrorNumberBadges');
  const convErrorTableBody = document.getElementById('convErrorTableBody');
  const btnConvCopyErrorNumbers = document.getElementById('btnConvCopyErrorNumbers');
  const btnConvCopyErrorDetails = document.getElementById('btnConvCopyErrorDetails');
  const convTableBody = document.getElementById('convTableBody');

  let convSelectedFiles = [];
  let convFailedItems = [];
  let isConvCancelled = false;

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Trigger download helper
  async function triggerDownloadFile(url, filename) {
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
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve({ success: true });
      }
    });
  }

  // Handler saat file dipilih (dari input folder atau input files)
  function handleFilesSelected(fileList) {
    if (!fileList || fileList.length === 0) return;

    // Filter file gambar atau PDF saja
    const validExtensions = /\.(pdf|jpg|jpeg|png|gif|webp|bmp)$/i;
    const files = Array.from(fileList).filter(f => validExtensions.test(f.name));

    if (files.length === 0) {
      alert('Tidak ditemukan berkas PDF atau gambar (JPG, GIF, PNG, WebP) di folder ini.');
      return;
    }

    // Urutkan file berdasarkan angka/nomor di nama file secara natural (1, 2, 3... 10)
    files.sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.name.match(/\d+/)?.[0] || '0', 10);
      if (numA !== numB) return numA - numB;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    convSelectedFiles = files;
    convFailedItems = [];
    renderConvErrorBox();

    // Hitung breakdown format
    let countPdf = 0;
    let countGif = 0;
    let countJpg = 0;
    files.forEach(f => {
      const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
      if (ext === 'pdf') countPdf++;
      else if (ext === 'gif') countGif++;
      else countJpg++;
    });

    if (convFileCountBadge) convFileCountBadge.textContent = `${files.length} berkas`;
    if (convStatTotal) convStatTotal.textContent = `${files.length} berkas`;
    if (convStatBreakdown) {
      convStatBreakdown.textContent = `PDF: ${countPdf} | GIF: ${countGif} | JPG/WebP: ${countJpg}`;
    }
    if (convMetricTotal) convMetricTotal.textContent = files.length;
    if (convMetricSuccess) convMetricSuccess.textContent = '0';
    if (convMetricFailed) convMetricFailed.textContent = '0';

    if (btnStartConvert) btnStartConvert.disabled = false;

    // Render tabel antrian berkas
    if (convTableBody) {
      convTableBody.innerHTML = '';
      files.forEach((file, idx) => {
        const numMatch = file.name.match(/^(\d+)/);
        const fileId = numMatch ? numMatch[1] : String(idx + 1);
        const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
        const tr = document.createElement('tr');
        tr.id = `conv-row-${idx}`;
        tr.innerHTML = `
          <td><b>${escapeHtml(fileId)}</b></td>
          <td>
            <div class="cover-thumb-box" id="conv-thumb-${idx}">
              <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;">
                Antre
              </div>
            </div>
          </td>
          <td><span style="font-weight:600;">${escapeHtml(file.name)}</span></td>
          <td><span class="badge">${ext}</span></td>
          <td>${formatBytes(file.size)}</td>
          <td><code>${escapeHtml(fileId)}.png</code></td>
          <td id="conv-status-${idx}">
            <span class="badge-status" style="background:#e2e8f0;color:#64748b;">Siap</span>
          </td>
        `;
        convTableBody.appendChild(tr);
      });
    }
  }

  // Render Box Log Error Converter
  function renderConvErrorBox() {
    if (!convErrorBox) return;

    if (convFailedItems.length === 0) {
      convErrorBox.classList.add('hidden');
      return;
    }

    convErrorBox.classList.remove('hidden');
    if (convErrorSummaryTitle) {
      convErrorSummaryTitle.textContent = `Terdeteksi ${convFailedItems.length} Berkas / Nomor Mengalami Kendala`;
    }

    if (convErrorNumberBadges) {
      convErrorNumberBadges.innerHTML = '';
      convFailedItems.forEach(item => {
        const badge = document.createElement('span');
        badge.className = 'badge-num-error';
        badge.textContent = item.id;
        badge.title = `Klik untuk salin nomor/ID: ${item.id}`;
        badge.addEventListener('click', () => {
          copyTextToClipboard(item.id, badge, '✓');
        });
        convErrorNumberBadges.appendChild(badge);
      });
    }

    if (convErrorTableBody) {
      convErrorTableBody.innerHTML = '';
      convFailedItems.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${escapeHtml(item.id)}</b></td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.size)}</td>
          <td style="color:#b91c1c;font-weight:500;">${escapeHtml(item.error || 'Gagal')}</td>
        `;
        convErrorTableBody.appendChild(tr);
      });
    }
  }

  // Tombol Salin Nomor Saja Converter
  if (btnConvCopyErrorNumbers) {
    btnConvCopyErrorNumbers.addEventListener('click', () => {
      if (convFailedItems.length === 0) return;
      const text = convFailedItems.map(f => f.id).join(', ');
      copyTextToClipboard(text, btnConvCopyErrorNumbers, '✓ Nomor Tersalin!');
    });
  }

  // Tombol Salin Rincian Error Converter
  if (btnConvCopyErrorDetails) {
    btnConvCopyErrorDetails.addEventListener('click', () => {
      if (convFailedItems.length === 0) return;
      const text = convFailedItems.map(f => `${f.id}\t${f.name}\t${f.error}`).join('\n');
      copyTextToClipboard(text, btnConvCopyErrorDetails, '✓ Rincian Tersalin!');
    });
  }

  // Event listener tombol pilih folder & pilih files
  if (btnPickFolder && inputFolderFiles) {
    btnPickFolder.addEventListener('click', () => inputFolderFiles.click());
    inputFolderFiles.addEventListener('change', (e) => handleFilesSelected(e.target.files));
  }

  if (btnPickFiles && inputFileList) {
    btnPickFiles.addEventListener('click', () => inputFileList.click());
    inputFileList.addEventListener('change', (e) => handleFilesSelected(e.target.files));
  }

  if (convDropzoneArea && inputFolderFiles) {
    convDropzoneArea.addEventListener('click', () => inputFolderFiles.click());
    convDropzoneArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      convDropzoneArea.style.borderColor = 'var(--primary)';
      convDropzoneArea.style.background = '#f0f9ff';
    });
    convDropzoneArea.addEventListener('dragleave', () => {
      convDropzoneArea.style.borderColor = 'var(--border)';
      convDropzoneArea.style.background = '';
    });
    convDropzoneArea.addEventListener('drop', (e) => {
      e.preventDefault();
      convDropzoneArea.style.borderColor = 'var(--border)';
      convDropzoneArea.style.background = '';
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFilesSelected(e.dataTransfer.files);
      }
    });
  }

  // Reset Pilihan
  if (btnClearConvert) {
    btnClearConvert.addEventListener('click', () => {
      convSelectedFiles = [];
      convFailedItems = [];
      if (inputFolderFiles) inputFolderFiles.value = '';
      if (inputFileList) inputFileList.value = '';
      if (convFileCountBadge) convFileCountBadge.textContent = '0 file';
      if (convStatTotal) convStatTotal.textContent = '0 berkas';
      if (convStatBreakdown) convStatBreakdown.textContent = 'PDF: 0 | GIF: 0 | JPG/WebP: 0';
      if (convMetricTotal) convMetricTotal.textContent = '0';
      if (convMetricSuccess) convMetricSuccess.textContent = '0';
      if (convMetricFailed) convMetricFailed.textContent = '0';
      if (btnStartConvert) btnStartConvert.disabled = true;
      renderConvErrorBox();
      if (convTableBody) {
        convTableBody.innerHTML = `
          <tr class="empty-row" id="convEmptyRow">
            <td colspan="7">
              <div class="empty-state" id="convDropzoneArea" style="cursor:pointer;padding:45px 20px;border:2px dashed var(--border);border-radius:12px;margin:20px;transition:all 0.15s ease;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#025E8D" stroke-width="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  <polyline points="12 11 12 17"></polyline>
                  <polyline points="9 14 12 11 15 14"></polyline>
                </svg>
                <p style="font-size:15px;margin-top:8px;"><b>Seret & Lepas Folder atau File Cover ke Sini</b></p>
                <span style="color:var(--text-muted);">Atau gunakan tombol <b>"Pilih Folder Cover"</b> di sebelah kiri</span>
              </div>
            </td>
          </tr>
        `;
      }
    });
  }

  // Mulai Konversi ke PNG
  if (btnStartConvert) {
    btnStartConvert.addEventListener('click', async () => {
      if (convSelectedFiles.length === 0) {
        alert('Silakan pilih folder atau file cover terlebih dahulu.');
        return;
      }

      isConvCancelled = false;
      convFailedItems = [];
      renderConvErrorBox();

      btnStartConvert.disabled = true;
      if (btnStopConvert) btnStopConvert.classList.remove('hidden');
      if (convProgressBox) convProgressBox.classList.remove('hidden');

      const targetSubfolder = (convTargetSubfolder ? convTargetSubfolder.value.trim() : '') || 'book-covers-png';
      const total = convSelectedFiles.length;
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < total; i++) {
        if (isConvCancelled) break;

        const file = convSelectedFiles[i];
        const index = i + 1;
        const percent = Math.round(((index - 1) / total) * 100);

        const numMatch = file.name.match(/^(\d+)/);
        const fileId = numMatch ? numMatch[1] : file.name.replace(/\.[^.]+$/, '');
        const targetPngFilename = `${fileId}.png`;
        const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

        if (convProgressBar) convProgressBar.style.width = `${percent}%`;
        if (convProgressPercent) convProgressPercent.textContent = `${percent}%`;
        if (convProgressStatus) convProgressStatus.textContent = `[${index}/${total}] Mengonversi: ${file.name}...`;
        if (convLiveDetail) convLiveDetail.textContent = `File ${file.name} ➔ ${targetSubfolder}/${targetPngFilename}`;

        const statusCell = document.getElementById(`conv-status-${i}`);
        const thumbBox = document.getElementById(`conv-thumb-${i}`);
        if (statusCell) {
          statusCell.innerHTML = `<span class="badge-status" style="background:#fef3c7;color:#b45309;">Memproses...</span>`;
        }

        try {
          let pngDataUrl = null;

          if (ext === 'pdf') {
            const arrayBuf = await file.arrayBuffer();
            if (typeof renderPdfPageToPng === 'function') {
              pngDataUrl = await renderPdfPageToPng(arrayBuf, { scale: 2.0, timeoutMs: 15000 });
            } else {
              throw new Error('Fungsi render PDF ke PNG tidak tersedia.');
            }
          } else {
            // Gambar JPG / GIF / WebP / BMP / PNG
            if (typeof convertImageToPng === 'function') {
              pngDataUrl = await convertImageToPng(file, { timeoutMs: 12000 });
            } else {
              throw new Error('Fungsi konversi gambar ke PNG tidak tersedia.');
            }
          }

          if (!pngDataUrl) {
            throw new Error('Data URL hasil konversi kosong.');
          }

          // Trigger download hasil konversi PNG ke subfolder tujuan
          await triggerDownloadFile(pngDataUrl, `${targetSubfolder}/${targetPngFilename}`);

          // Perbarui tampilan status dan thumbnail di tabel
          successCount++;
          if (convMetricSuccess) convMetricSuccess.textContent = successCount;
          if (statusCell) {
            statusCell.innerHTML = `<span class="badge-status badge-success">Sukses</span>`;
          }
          if (thumbBox) {
            thumbBox.innerHTML = `
              <a href="${pngDataUrl}" target="_blank" title="Lihat Pratinjau PNG">
                <img class="cover-thumb-img" src="${pngDataUrl}" alt="PNG">
              </a>
            `;
          }

        } catch (err) {
          console.error(`Gagal mengonversi ${file.name}:`, err);
          failedCount++;
          if (convMetricFailed) convMetricFailed.textContent = failedCount;
          if (statusCell) {
            statusCell.innerHTML = `<span class="badge-status badge-error" title="${escapeHtml(err.message)}">Gagal</span>`;
          }
          if (thumbBox) {
            thumbBox.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:10px;font-weight:bold;">Error</div>`;
          }

          // Catat ke daftar error
          convFailedItems.push({
            id: fileId,
            name: file.name,
            size: formatBytes(file.size),
            error: err.message || 'Gagal dikonversi'
          });
          renderConvErrorBox();
        }

        // Jeda kecil 120ms agar download Chrome berjalan stabil
        await new Promise(r => setTimeout(r, 120));
      }

      // Selesai
      btnStartConvert.disabled = false;
      if (btnStopConvert) btnStopConvert.classList.add('hidden');
      if (convProgressBar) convProgressBar.style.width = '100%';
      if (convProgressPercent) convProgressPercent.textContent = '100%';
      if (convProgressStatus) {
        convProgressStatus.textContent = isConvCancelled
          ? 'Konversi dihentikan oleh pengguna.'
          : `Selesai! Berhasil: ${successCount} | Gagal: ${failedCount}`;
      }
      if (convLiveDetail) convLiveDetail.textContent = '';
      renderConvErrorBox();
    });
  }

  // Tombol Hentikan Konversi
  if (btnStopConvert) {
    btnStopConvert.addEventListener('click', () => {
      isConvCancelled = true;
      if (convProgressStatus) convProgressStatus.textContent = 'Menghentikan proses konversi...';
    });
  }

  // ========================================================
  // LOGIKA PENGGABUNG CSV (CSV MERGER & COPY EXCEL)
  // ========================================================
  const btnPickCsvFiles = document.getElementById('btnPickCsvFiles');
  const inputCsvFileList = document.getElementById('inputCsvFileList');
  const mergerDropzoneArea = document.getElementById('mergerDropzoneArea');

  const mergerStatFiles = document.getElementById('mergerStatFiles');
  const mergerStatBreakdown = document.getElementById('mergerStatBreakdown');
  const chkDeduplicateCsv = document.getElementById('chkDeduplicateCsv');
  const chkSortCsv = document.getElementById('chkSortCsv');

  const btnMergeCsv = document.getElementById('btnMergeCsv');
  const btnDownloadMergedCsv = document.getElementById('btnDownloadMergedCsv');
  const btnCopyMergedTableExcel = document.getElementById('btnCopyMergedTableExcel');
  const btnClearMerger = document.getElementById('btnClearMerger');

  const metricMergerFiles = document.getElementById('metricMergerFiles');
  const metricMergerRows = document.getElementById('metricMergerRows');
  const metricMergerDuplicates = document.getElementById('metricMergerDuplicates');
  const btnBoardCopyExcel = document.getElementById('btnBoardCopyExcel');
  const btnBoardExportCsv = document.getElementById('btnBoardExportCsv');

  const mergerToastBanner = document.getElementById('mergerToastBanner');
  const mergerTableHead = document.getElementById('mergerTableHead');
  const mergerTableBody = document.getElementById('mergerTableBody');

  let mergerSelectedFiles = [];
  let mergedResultData = null;

  function handleCsvFilesSelected(fileList) {
    if (!fileList || fileList.length === 0) return;

    const csvFiles = Array.from(fileList).filter(f => /\.csv$/i.test(f.name));
    if (csvFiles.length === 0) {
      alert('Silakan pilih berkas format CSV (.csv).');
      return;
    }

    const fileReadPromises = csvFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({ name: file.name, content: e.target.result });
        };
        reader.onerror = () => resolve({ name: file.name, content: '' });
        reader.readAsText(file);
      });
    });

    Promise.all(fileReadPromises).then((readFiles) => {
      mergerSelectedFiles = readFiles.filter(f => f.content && f.content.trim().length > 0);
      
      if (mergerStatFiles) mergerStatFiles.textContent = `${mergerSelectedFiles.length} file`;
      if (mergerStatBreakdown) mergerStatBreakdown.textContent = `Siap digabungkan (${csvFiles.length} berkas CSV)`;
      if (btnMergeCsv) btnMergeCsv.disabled = (mergerSelectedFiles.length === 0);
      
      // Jalankan penggabungan otomatis saat file dipilih
      executeCsvMerge();
    });
  }

  if (btnPickCsvFiles && inputCsvFileList) {
    btnPickCsvFiles.addEventListener('click', () => inputCsvFileList.click());
    inputCsvFileList.addEventListener('change', (e) => {
      handleCsvFilesSelected(e.target.files);
      e.target.value = '';
    });
  }

  // Drag and drop CSV
  if (mergerDropzoneArea) {
    mergerDropzoneArea.addEventListener('click', () => {
      if (inputCsvFileList) inputCsvFileList.click();
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
      document.body.addEventListener(evtName, (e) => {
        if (tabBtnMerger && tabBtnMerger.classList.contains('active')) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });

    mergerDropzoneArea.addEventListener('dragover', () => {
      mergerDropzoneArea.style.borderColor = '#025E8D';
      mergerDropzoneArea.style.background = '#f0f9ff';
    });

    mergerDropzoneArea.addEventListener('dragleave', () => {
      mergerDropzoneArea.style.borderColor = 'var(--border)';
      mergerDropzoneArea.style.background = 'transparent';
    });

    mergerDropzoneArea.addEventListener('drop', (e) => {
      mergerDropzoneArea.style.borderColor = 'var(--border)';
      mergerDropzoneArea.style.background = 'transparent';

      const files = e.dataTransfer ? e.dataTransfer.files : [];
      if (files && files.length > 0) {
        handleCsvFilesSelected(files);
      }
    });
  }

  function executeCsvMerge() {
    if (mergerSelectedFiles.length === 0) {
      alert('Silakan pilih berkas CSV terlebih dahulu.');
      return;
    }

    if (typeof mergeMultipleCsvFiles !== 'function') {
      alert('Modul csv-merger.js tidak ditemukan.');
      return;
    }

    const deduplicate = chkDeduplicateCsv ? chkDeduplicateCsv.checked : true;
    const sortById = chkSortCsv ? chkSortCsv.checked : true;

    mergedResultData = mergeMultipleCsvFiles(mergerSelectedFiles, { deduplicate, sortById });

    if (metricMergerFiles) metricMergerFiles.textContent = mergedResultData.totalFiles;
    if (metricMergerRows) metricMergerRows.textContent = mergedResultData.rows.length;
    if (metricMergerDuplicates) metricMergerDuplicates.textContent = mergedResultData.removedDuplicatesCount;

    if (btnDownloadMergedCsv) btnDownloadMergedCsv.disabled = (mergedResultData.rows.length === 0);
    if (btnCopyMergedTableExcel) btnCopyMergedTableExcel.disabled = (mergedResultData.rows.length === 0);
    if (btnBoardCopyExcel) btnBoardCopyExcel.disabled = (mergedResultData.rows.length === 0);
    if (btnBoardExportCsv) btnBoardExportCsv.disabled = (mergedResultData.rows.length === 0);

    renderMergerTable(mergedResultData);
  }

  function renderMergerTable(mergedData) {
    if (!mergerTableBody) return;
    const { headers, rows } = mergedData;

    if (!headers || headers.length === 0 || rows.length === 0) {
      mergerTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">
            Tidak ada baris data yang ditemukan dalam berkas CSV.
          </td>
        </tr>
      `;
      return;
    }

    // Render Table Head
    if (mergerTableHead) {
      mergerTableHead.innerHTML = `
        <tr>
          <th width="40">#</th>
          ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
        </tr>
      `;
    }

    // Render Table Body
    mergerTableBody.innerHTML = '';
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      const isFailed = (row['Status'] || '').toLowerCase().includes('gagal') ||
                       (row['Judul Buku / Proceeding'] || '').includes('Gagal');

      tr.innerHTML = `
        <td><b>${idx + 1}</b></td>
        ${headers.map(h => {
          const val = row[h] !== undefined && row[h] !== null ? row[h] : '';
          if (h === 'Link Scopus' || h === 'Link Publisher') {
            return val ? `<td><a href="${escapeHtml(val)}" target="_blank" style="color:var(--primary);font-size:12px;">Link 🔗</a></td>` : '<td>-</td>';
          }
          if (h === 'Status') {
            const badgeClass = isFailed ? 'badge-error' : 'badge-success';
            return `<td><span class="badge-status ${badgeClass}">${escapeHtml(val)}</span></td>`;
          }
          return `<td>${escapeHtml(val)}</td>`;
        }).join('')}
      `;
      mergerTableBody.appendChild(tr);
    });
  }

  // Action Button: Gabungkan CSV
  if (btnMergeCsv) {
    btnMergeCsv.addEventListener('click', executeCsvMerge);
  }

  // Action Button: Download Merged CSV
  function downloadMergedCsvFile() {
    if (!mergedResultData || mergedResultData.rows.length === 0) {
      alert('Belum ada data gabungan untuk diunduh.');
      return;
    }
    const csvContent = convertTableToCsvString(mergedResultData.headers, mergedResultData.rows);
    downloadCsvString(csvContent, 'hasil_penggabungan_metadata.csv');
  }

  function downloadCsvString(csvContent, filename) {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (btnDownloadMergedCsv) btnDownloadMergedCsv.addEventListener('click', downloadMergedCsvFile);
  if (btnBoardExportCsv) btnBoardExportCsv.addEventListener('click', downloadMergedCsvFile);

  // Action Button: SALIN TABEL KE EXCEL (CLIPBOARD)
  function copyTableToExcelClipboard() {
    if (!mergedResultData || mergedResultData.rows.length === 0) {
      alert('Belum ada data gabungan untuk disalin.');
      return;
    }

    const tsvData = convertTableToExcelClipboardString(mergedResultData.headers, mergedResultData.rows);
    
    navigator.clipboard.writeText(tsvData).then(() => {
      if (mergerToastBanner) {
        mergerToastBanner.classList.remove('hidden');
        setTimeout(() => {
          mergerToastBanner.classList.add('hidden');
        }, 4000);
      } else {
        alert('✅ Tabel berhasil disalin ke Clipboard! Siap ditempel (Ctrl + V) di Excel.');
      }
    }).catch(err => {
      console.error('Gagal menyalin tabel ke clipboard:', err);
      // Fallback menggunakan textarea
      const ta = document.createElement('textarea');
      ta.value = tsvData;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('✅ Tabel berhasil disalin ke Clipboard!');
    });
  }

  if (btnCopyMergedTableExcel) btnCopyMergedTableExcel.addEventListener('click', copyTableToExcelClipboard);
  if (btnBoardCopyExcel) btnBoardCopyExcel.addEventListener('click', copyTableToExcelClipboard);

  // Reset Merger
  if (btnClearMerger) {
    btnClearMerger.addEventListener('click', () => {
      mergerSelectedFiles = [];
      mergedResultData = null;
      if (mergerStatFiles) mergerStatFiles.textContent = '0 file';
      if (mergerStatBreakdown) mergerStatBreakdown.textContent = 'Siap digabungkan';
      if (metricMergerFiles) metricMergerFiles.textContent = '0';
      if (metricMergerRows) metricMergerRows.textContent = '0';
      if (metricMergerDuplicates) metricMergerDuplicates.textContent = '0';

      if (btnMergeCsv) btnMergeCsv.disabled = true;
      if (btnDownloadMergedCsv) btnDownloadMergedCsv.disabled = true;
      if (btnCopyMergedTableExcel) btnCopyMergedTableExcel.disabled = true;
      if (btnBoardCopyExcel) btnBoardCopyExcel.disabled = true;
      if (btnBoardExportCsv) btnBoardExportCsv.disabled = true;

      if (mergerTableHead) {
        mergerTableHead.innerHTML = `
          <tr>
            <th width="40">#</th>
            <th width="50">ID</th>
            <th>Judul Buku / Proceeding</th>
            <th>Judul Artikel / Chapter</th>
            <th width="120">ISBN / ISSN</th>
            <th width="60">Tahun</th>
            <th width="150">Publisher</th>
            <th width="180">Link Scopus</th>
          </tr>
        `;
      }
      if (mergerTableBody) {
        mergerTableBody.innerHTML = `
          <tr class="empty-row" id="mergerEmptyRow">
            <td colspan="8">
              <div class="empty-state" id="mergerDropzoneArea" style="cursor:pointer;padding:45px 20px;border:2px dashed var(--border);border-radius:12px;margin:20px;transition:all 0.15s ease;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#025E8D" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <p style="font-size:15px;margin-top:8px;"><b>Seret & Lepas Beberapa File CSV ke Sini</b></p>
                <span style="color:var(--text-muted);">Atau gunakan tombol <b>"Pilih Berkas CSV"</b> di sebelah kiri untuk menggabungkan</span>
              </div>
            </td>
          </tr>
        `;
      }
    });
  }
});
