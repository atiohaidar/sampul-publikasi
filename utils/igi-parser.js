/**
 * utils/igi-parser.js
 * ============================================================
 * Parser untuk IGI Global (igi-global.com / doi.org/10.4018):
 * Ekstrak Metadata, Judul Buku/Source, ISBN, dan Gambar Cover.
 * ============================================================
 */

function parseIgiPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Judul Chapter / Artikel
  let chapterTitle = '';
  const chapterTitleEl = doc.querySelector('h1 span[id*="lblTitleName"], h1.bottom-space, h1');
  if (chapterTitleEl) {
    chapterTitle = chapterTitleEl.textContent.trim();
  }

  // 2. Judul Buku Induk (Source Title) & Link Buku
  let bookTitle = '';
  let bookUrl = '';
  const sourceLink = doc.querySelector(
    'span[id*="lblSource"] a[href*="/gateway/book/"], a[href*="/gateway/book/"], .bottom-space a[href*="/book/"]'
  );
  if (sourceLink) {
    bookTitle = sourceLink.textContent.trim();
    const href = sourceLink.getAttribute('href') || '';
    if (href) {
      bookUrl = href.startsWith('http') ? href : ('https://www.igi-global.com' + (href.startsWith('/') ? '' : '/') + href);
    }
  }
  if (!bookTitle) {
    bookTitle = chapterTitle; // Fallback jika halaman utama adalah buku
  }

  // 3. Gambar Cover (Resolusi Tinggi / High quality webp / jpg)
  let coverUrl = '';
  const coverImg = doc.querySelector(
    'img[id*="imgCover"], img.cover-img-b, img[src*="coverimages.igi-global.com"], meta[property="og:image"]'
  );
  if (coverImg) {
    if (coverImg.tagName.toLowerCase() === 'meta') {
      coverUrl = coverImg.getAttribute('content') || '';
    } else {
      coverUrl = coverImg.getAttribute('src') || coverImg.src || '';
    }
  }

  if (coverUrl && coverUrl.startsWith('//')) {
    coverUrl = 'https:' + coverUrl;
  }

  // 4. ISBN13 / EISBN13
  let isbn = '';
  const isbnEl = doc.querySelector('.isbn-doi-inner-platform [title*="ISBN13"], span[title*="ISBN"]');
  if (isbnEl) {
    const rawIsbn = isbnEl.getAttribute('title') || isbnEl.textContent || '';
    const match = rawIsbn.match(/(\d{13}|\d{10})/);
    if (match) isbn = match[1];
  }
  if (!isbn) {
    const bodyText = doc.body ? doc.body.textContent : '';
    const match = bodyText.match(/ISBN13:?\s*(\d{13})/i);
    if (match) isbn = match[1];
  }

  // 5. DOI
  let doi = '';
  const doiEl = doc.querySelector('.isbn-doi-inner-platform [title*="DOI"]');
  if (doiEl) {
    const rawDoi = doiEl.getAttribute('title') || doiEl.textContent || '';
    const match = rawDoi.match(/10\.4018\/[-._;()/:A-Za-z0-9]+/);
    if (match) doi = match[0];
  }
  if (!doi && sourceUrl) {
    const match = sourceUrl.match(/10\.4018\/[-._;()/:A-Za-z0-9]+/);
    if (match) doi = match[0];
  }

  // 6. Tahun Publikasi
  let year = '';
  const releaseEl = doc.querySelector('span[id*="lblReleaseDate"], .isbn-doi-outer-platform');
  const releaseText = releaseEl ? releaseEl.textContent : (doc.body ? doc.body.textContent : '');
  const yearMatch = releaseText.match(/©\s*(\d{4})|Copyright:?\s*©?\s*(\d{4})|(\b20\d{2}\b)/i);
  if (yearMatch) {
    year = yearMatch[1] || yearMatch[2] || yearMatch[3];
  }

  return {
    success: !!(coverUrl || bookTitle),
    title: bookTitle || chapterTitle || 'IGI Global Book',
    chapterTitle: chapterTitle,
    bookUrl: bookUrl || sourceUrl,
    coverUrl: coverUrl,
    isbn: isbn ? `ISBN-${isbn}` : '',
    doi: doi,
    year: year,
    publisher: 'IGI Global Scientific Publishing',
    sourceUrl: sourceUrl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseIgiPage };
} else if (typeof window !== 'undefined') {
  window.parseIgiPage = parseIgiPage;
}
