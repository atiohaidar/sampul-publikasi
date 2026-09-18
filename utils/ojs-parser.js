/**
 * utils/ojs-parser.js
 * ============================================================
 * Parser untuk PKP OJS / Academic Conferences (papers.academic-conferences.org):
 * Ekstrak Issue Cover Image, Judul Proceeding / Issue, Galley PDF, dan Metadata.
 * ============================================================
 */

function parseOjsPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Judul Artikel / Chapter
  let paperTitle = '';
  const titleEl = doc.querySelector('h1.page_title, h1, .item.title');
  if (titleEl) {
    paperTitle = titleEl.textContent.trim();
  }

  // 2. Link & Judul Issue / Proceeding Induk
  let issueTitle = '';
  let issueUrl = '';
  const issueLink = doc.querySelector(
    '.item.issue a.title, .item.issue .value a, .item.cover_image a[href*="/issue/view/"]'
  );
  if (issueLink) {
    issueTitle = issueLink.textContent.trim();
    const href = issueLink.getAttribute('href') || '';
    if (href) {
      issueUrl = href.startsWith('http') ? href : ('https://papers.academic-conferences.org' + (href.startsWith('/') ? '' : '/') + href);
    }
  }

  // 3. Gambar Cover (Issue Cover Image)
  let coverUrl = '';
  const coverImg = doc.querySelector(
    '.item.cover_image img, img[src*="cover_issue_"], .entry_details .cover_image img, meta[property="og:image"]'
  );
  if (coverImg) {
    if (coverImg.tagName.toLowerCase() === 'meta') {
      coverUrl = coverImg.getAttribute('content') || '';
    } else {
      coverUrl = coverImg.getAttribute('src') || coverImg.src || '';
    }
  }

  if (coverUrl && !coverUrl.startsWith('http')) {
    const origin = sourceUrl ? new URL(sourceUrl).origin : 'https://papers.academic-conferences.org';
    coverUrl = origin + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;
  }

  // 4. Galley PDF Link (jika artikel)
  let pdfUrl = '';
  const pdfLink = doc.querySelector('a.obj_galley_link.pdf, .galleys_links a[href*="/article/view/"]');
  if (pdfLink) {
    const href = pdfLink.getAttribute('href') || '';
    if (href) {
      const origin = sourceUrl ? new URL(sourceUrl).origin : 'https://papers.academic-conferences.org';
      pdfUrl = href.startsWith('http') ? href : (origin + (href.startsWith('/') ? '' : '/') + href);
    }
  }

  // 5. Tahun Publikasi
  let year = '';
  const pubDateEl = doc.querySelector('.item.published .value, .published .value');
  if (pubDateEl) {
    const yMatch = pubDateEl.textContent.match(/\b(19\d\d|20\d\d)\b/);
    if (yMatch) year = yMatch[1];
  }
  if (!year && issueTitle) {
    const yMatch = issueTitle.match(/\b(19\d\d|20\d\d)\b/);
    if (yMatch) year = yMatch[1];
  }

  return {
    success: !!(coverUrl || issueTitle),
    title: issueTitle || paperTitle || 'Academic Conferences Proceeding',
    chapterTitle: paperTitle,
    issueUrl: issueUrl || sourceUrl,
    coverUrl: coverUrl,
    pdfUrl: pdfUrl,
    year: year,
    publisher: 'Academic Conferences / PKP OJS',
    sourceUrl: sourceUrl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseOjsPage };
} else if (typeof window !== 'undefined') {
  window.parseOjsPage = parseOjsPage;
}
