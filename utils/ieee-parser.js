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

  // Helper: Deteksi judul cover langsung (Cover, Front Cover, Cover Page, Back Cover)
  // Menghindari false positive pada istilah paper seperti "coverage" atau "undercover"
  const isDirectCover = (title) => {
    const t = (title || '').trim();
    if (/\b(?:front\s*cover|back\s*cover|cover\s*page|inside\s*(?:front\s*)?cover)\b/i.test(t)) return true;
    if (/\bcovers?\b/i.test(t)) {
      if (/coverage|discovering|recovering|undercover/i.test(t)) return false;
      if (/\b(?:radio|network|land|cloud|spatial|code|test|fault|sensor|depth)\s+cover/i.test(t)) return false;
      return true;
    }
    return false;
  };

  // Helper: Deteksi judul Proceedings, Front Matter, Title Page, Hak Cipta, Prelims, dsb.
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

  // 3. Scan item proceeding dan ekstrak info PDF
  const items = doc.querySelectorAll('xpl-issue-results-items, .result-item, .List-results-items');

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

    // Cek apakah ada author
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

  // 4. Deteksi Detail Paginasi Lengkap (Single arrow, Next 10 set, active, max page)
  const pageButtons = Array.from(doc.querySelectorAll(
    'xpl-paginator button, .pagination-bar button, ul.pagination button, .pagination-bar a'
  ));
  const numericPages = pageButtons
    .map(b => parseInt((b.innerText || b.textContent || '').trim(), 10))
    .filter(n => !isNaN(n) && n > 0);
  const maxVisiblePage = numericPages.length > 0 ? Math.max(...numericPages) : 1;

  const activeBtn = doc.querySelector('xpl-paginator button.active, .pagination button.active, xpl-paginator li.active button');
  const currentPage = activeBtn ? parseInt(activeBtn.textContent.trim(), 10) : (numericPages[0] || 1);

  // Next page set button (e.g. Next 10 pages / stats-Pagination_Next_11)
  const nextSetBtn = doc.querySelector('.next-page-set button, button[class*="stats-Pagination_Next_"]');
  let hasNextSet = false;
  let nextSetPage = 0;
  if (nextSetBtn && !nextSetBtn.disabled && !nextSetBtn.classList.contains('disabled') && !nextSetBtn.getAttribute('disabled')) {
    const className = nextSetBtn.className || '';
    const match = className.match(/stats-Pagination_Next_(\d+)/);
    nextSetPage = match ? parseInt(match[1], 10) : (maxVisiblePage + 1);
    hasNextSet = true;
  }

  // Next single page arrow button (e.g. stats-Pagination_arrow_next_11)
  const nextArrowBtn = doc.querySelector('.next-btn button, button[class*="stats-Pagination_arrow_next_"]');
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

  return {
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
    maxPage: maxVisiblePage,
    sourceUrl: sourceUrl || ''
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseIeeeDocumentPage, parseIeeeProceedingPage };
} else if (typeof window !== 'undefined') {
  window.parseIeeeDocumentPage = parseIeeeDocumentPage;
  window.parseIeeeProceedingPage = parseIeeeProceedingPage;
}
