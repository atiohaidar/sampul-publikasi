/**
 * utils/iop-parser.js
 * ============================================================
 * Parser untuk IOP Publishing (iopscience.iop.org / doi.org/10.1088):
 * Ekstrak Series Title, Volume/Issue, Gambar Cover, ISSN/DOI, dan Year.
 * ============================================================
 */

function parseIopPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Judul Artikel
  let paperTitle = '';
  const titleEl = doc.querySelector('h1.article-title, .wd-jnl-art-title, h1');
  if (titleEl) {
    paperTitle = titleEl.textContent.trim();
  }

  // 2. Extrak Series / Journal / Issue Link dari Breadcrumb
  let seriesTitle = '';
  let volumeName = '';
  let issueName = '';
  let seriesUrl = '';

  const seriesLink = doc.querySelector('.wd-jnl-art-breadcrumb-title a, a[data-event-action="Title link"]');
  if (seriesLink) {
    seriesTitle = seriesLink.textContent.trim();
    const href = seriesLink.getAttribute('href') || '';
    if (href) {
      seriesUrl = href.startsWith('http') ? href : ('https://iopscience.iop.org' + (href.startsWith('/') ? '' : '/') + href);
    }
  }

  const volLink = doc.querySelector('.wd-jnl-art-breadcrumb-vol a, a[data-event-action="Volume link"]');
  if (volLink) {
    volumeName = volLink.textContent.trim();
  }

  const issueLink = doc.querySelector('.wd-jnl-art-breadcrumb-issue a, a[data-event-action="Issue link"]');
  if (issueLink) {
    issueName = issueLink.textContent.trim();
  }

  // Gabungkan Judul Proceeding Induk
  let fullTitle = seriesTitle;
  if (volumeName) {
    fullTitle += fullTitle ? ` (${volumeName})` : volumeName;
  }

  // 3. Gambar Cover Journal / Proceeding
  let coverUrl = '';
  const coverImg = doc.querySelector(
    '#wd-jnl-hm-intro img, .pull-left img, img[src*="cms.iopscience.org"], img[src*="journal_cover"], meta[property="og:image"]'
  );
  if (coverImg) {
    if (coverImg.tagName.toLowerCase() === 'meta') {
      coverUrl = coverImg.getAttribute('content') || '';
    } else {
      coverUrl = coverImg.getAttribute('src') || coverImg.src || '';
    }
  }

  if (coverUrl && !coverUrl.startsWith('http')) {
    coverUrl = 'https://iopscience.iop.org' + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;
  }

  // 4. ISSN, Real ISBN & DOI
  let issn = '';
  let isbnElectronic = '';
  let isbnPrint = '';
  let city = '';
  let doi = '';
  const bodyText = doc.body ? doc.body.textContent : '';

  const issnMatch = bodyText.match(/ISSN:?\s*([\d-]+)/i);
  if (issnMatch) issn = issnMatch[1];

  // Ekstrak ISBN asli jika tersedia (hanya jika lolos isValidIsbn)
  if (typeof extractGenericPublicationMetadata === 'function') {
    const meta = extractGenericPublicationMetadata(doc, { doi, sourceUrl });
    isbnElectronic = meta.isbnElectronic || '';
    isbnPrint = meta.isbnPrint || '';
    city = meta.city || '';
  }

  // Ekstrak Lokasi Konferensi / City dari IOP jika belum terambil
  if (!city) {
    const confLocMatch = bodyText.match(/(?:Conference\s*Location|Held\s*in)[\s:]*([^\n\r<]+)/i) ||
                         bodyText.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*[-–—]\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*,?\s*([A-Za-z\s,.-]+)/);
    if (confLocMatch && confLocMatch[1]) {
      city = typeof cleanCityOrLocation === 'function' ? cleanCityOrLocation(confLocMatch[1]) : confLocMatch[1].trim();
    }
  }

  const doiMatch = bodyText.match(/10\.1088\/[-._;()/:A-Za-z0-9]+/);
  if (doiMatch) doi = doiMatch[0];
  if (!doi && sourceUrl) {
    const match = sourceUrl.match(/10\.1088\/[-._;()/:A-Za-z0-9]+/);
    if (match) doi = match[0];
  }

  // 5. Tahun
  let year = '';
  const yearMatch = bodyText.match(/Citation.*?\b(19\d\d|20\d\d)\b|©\s*(\d{4})|(\b20\d{2}\b)/i);
  if (yearMatch) {
    year = yearMatch[1] || yearMatch[2] || yearMatch[3];
  }

  // ISBN hanya diisi jika BENAR-BENAR ada ISBN, BUKAN ISSN
  const realIsbn = isbnElectronic || isbnPrint || '';

  return {
    success: !!(coverUrl || seriesTitle),
    title: fullTitle || seriesTitle || paperTitle || 'IOP Conference Proceeding',
    chapterTitle: paperTitle,
    seriesTitle: seriesTitle,
    volumeName: volumeName,
    issueName: issueName,
    seriesUrl: seriesUrl || sourceUrl,
    coverUrl: coverUrl,
    isbn: realIsbn,
    isbnElectronic: isbnElectronic,
    isbnPrint: isbnPrint,
    issn: issn,
    city: city,
    doi: doi,
    year: year,
    publisher: 'IOP Publishing',
    sourceUrl: sourceUrl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseIopPage };
} else if (typeof window !== 'undefined') {
  window.parseIopPage = parseIopPage;
}
