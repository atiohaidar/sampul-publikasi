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
  const dashNamingPattern = document.getElementById('dashNamingPattern');
  const dashDelay = document.getElementById('dashDelay');
  const dashChkActiveTab = document.getElementById('dashChkActiveTab');
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

  const dashTableBody = document.getElementById('dashTableBody');

  let scraperEngine = new SpringerScraperEngine();
  let scrapedResults = [];

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
    chrome.storage.local.get(['subfolder', 'namingPattern', 'downloadCovers', 'autoCsv', 'activeTab', 'pendingUrls'], (data) => {
      if (data.subfolder !== undefined && dashSubfolder) dashSubfolder.value = data.subfolder;
      if (data.namingPattern !== undefined && data.namingPattern !== 'title' && dashNamingPattern) {
        dashNamingPattern.value = data.namingPattern;
      } else if (dashNamingPattern) {
        dashNamingPattern.value = 'id_only';
        chrome.storage.local.set({ namingPattern: 'id_only' });
      }
      if (data.downloadCovers !== undefined && dashChkCovers) dashChkCovers.checked = data.downloadCovers;
      if (data.autoCsv !== undefined && dashChkAutoCsv) dashChkAutoCsv.checked = data.autoCsv;
      if (data.activeTab !== undefined && dashChkActiveTab) dashChkActiveTab.checked = data.activeTab;

      if (data.pendingUrls && !dashUrlInput.value.trim()) {
        dashUrlInput.value = data.pendingUrls;
        updateUrlCount();
        chrome.storage.local.remove(['pendingUrls']);
      }
    });
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
          <div><b>Penerbit:</b> <span style="color:#025e8d;font-weight:600;">${book.publisher || 'Unknown'}</span></div>
          <div><b>ISBN/ID:</b> ${book.isbn || '-'}</div>
          ${book.doi ? `<div><b>DOI:</b> ${book.doi}</div>` : ''}
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

  // Start Process
  btnDashStart.addEventListener('click', async () => {
    const entries = parseInputEntries(dashUrlInput.value);
    if (entries.length === 0) {
      alert('Silakan masukkan minimal 1 URL Scopus / Springer / IEEE.');
      dashUrlInput.focus();
      return;
    }

    scrapedResults = [];
    scraperEngine = new SpringerScraperEngine();

    // Reset Table
    dashTableBody.innerHTML = '';
    btnDashExportCsv.disabled = true;

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
      },

      onFinished: (summary) => {
        scrapedResults = summary.results;
        btnDashStart.disabled = false;
        btnDashStop.classList.add('hidden');
        if (btnDashSkip) btnDashSkip.classList.add('hidden');

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
});
