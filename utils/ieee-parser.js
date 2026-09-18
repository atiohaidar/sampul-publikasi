/**
 * utils/ieee-parser.js
 * ============================================================
 * Parser untuk IEEE Xplore:
 * 1. Halaman Dokumen/Paper: Ekstrak judul paper, penulis, dan link Conference Proceeding
 * 2. Halaman Proceeding: Cari item "Front Cover Page", link PDF cover, nama conference, dan tahun
 * ============================================================
 */

function parseIeeeDocumentPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Ekstrak Judul Paper
  let paperTitle = '';
  const titleEl = doc.querySelector('h1.document-title, .document-title-fix h1, [data-test="document-title"]');
  if (titleEl) {
    paperTitle = titleEl.textContent.trim();
  }

  // 2. Ekstrak Penulis
  let authors = '';
  const authorEls = doc.querySelectorAll('xpl-author-banner .authors-info a, .authors-info-container a');
  if (authorEls.length > 0) {
    authors = Array.from(authorEls).map(a => a.textContent.trim()).filter(Boolean).join('; ');
  }

  // 3. Ekstrak Link Proceeding Conference dari Breadcrumbs
  let proceedingUrl = '';
  let conferenceName = '';

  const proceedingLinks = doc.querySelectorAll('.breadcrumbs a[href*="/proceeding"], .document-header a[href*="/conhome/"]');
  for (const link of proceedingLinks) {
    const href = link.getAttribute('href') || '';
    if (href.includes('/proceeding') || href.includes('/conhome/')) {
      proceedingUrl = href.startsWith('http') ? href : ('https://ieeexplore.ieee.org' + (href.startsWith('/') ? '' : '/') + href);
      conferenceName = link.textContent.trim();
      break;
    }
  }

  return {
    paperTitle,
    authors,
    proceedingUrl,
    conferenceName,
    sourceUrl
  };
}

function parseIeeeProceedingPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Ekstrak Nama Conference Proceeding
  let conferenceName = '';
  const confLinks = doc.querySelectorAll('.description a[href*="/proceeding"], a.stats-conhome-title, .breadcrumbs a[href*="/proceeding"]');
  if (confLinks.length > 0) {
    for (const cl of confLinks) {
      const text = cl.textContent.trim();
      if (text.length > 5 && !text.includes('<<') && !text.includes('Results')) {
        conferenceName = text;
        break;
      }
    }
  }

  if (!conferenceName) {
    const headerTitle = doc.querySelector('h1, .document-title, title');
    if (headerTitle) {
      conferenceName = headerTitle.textContent.replace(/\s*\|\s*IEEE.*$/i, '').trim();
    }
  }

  // 2. Ekstrak Tahun Publikasi
  let year = '';
  const yearMatch = (doc.body ? doc.body.textContent : '').match(/Publication Year:\s*(\d{4})|Year:\s*(\d{4})/i);
  if (yearMatch) {
    year = yearMatch[1] || yearMatch[2];
  }

  // 3. Cari Front Cover Page di daftar hasil proceeding
  let coverPdfUrl = '';
  let coverDirectPdfUrl = '';
  let coverTitle = '';
  let coverArnumber = '';

  const items = doc.querySelectorAll('xpl-issue-results-items, .result-item, .List-results-items');

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

  // Prioritas 2: Jika tidak ada kata "cover", scan untuk kata kunci halaman depan / informasi hak cipta
  if (!coverPdfUrl) {
    const frontKeywords = ['copyright page', 'front matter', 'title page', 'table of contents', 'half title', 'preliminar', 'preface'];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const titleEl = item.querySelector('h2, .result-item-title, .title, [xplmathjax]');
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

  // Deteksi jumlah halaman paginasi jika ada
  const pageButtons = Array.from(doc.querySelectorAll(
    'xpl-paginator button, .pagination-bar button, ul.pagination button, .pagination-bar a'
  ));
  const numericPages = pageButtons
    .map(b => parseInt((b.innerText || b.textContent || '').trim(), 10))
    .filter(n => !isNaN(n) && n > 0);
  const maxPage = numericPages.length > 0 ? Math.max(...numericPages) : 1;

  const coverFound = !!coverPdfUrl;

  return {
    success: true,
    coverFound: coverFound,
    maxPage: maxPage,
    conferenceName: conferenceName || 'IEEE Conference Proceeding',
    year: year || '',
    coverTitle: matchedTitle || (coverFound ? 'Cover' : ''),
    coverPdfUrl: coverPdfUrl || '',
    coverDirectPdfUrl: coverDirectPdfUrl || coverPdfUrl || '',
    coverArnumber: coverArnumber || '',
    sourceUrl: sourceUrl || ''
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseIeeeDocumentPage, parseIeeeProceedingPage };
} else if (typeof window !== 'undefined') {
  window.parseIeeeDocumentPage = parseIeeeDocumentPage;
  window.parseIeeeProceedingPage = parseIeeeProceedingPage;
}
