/**
 * utils/sciencedirect-parser.js
 * ============================================================
 * Parser untuk ScienceDirect / Elsevier:
 * 1. Halaman Chapter: Ekstrak link Buku induk, judul chapter, tahun, series
 * 2. Halaman Book: Ekstrak judul buku, subtitle, cover resolusi tinggi (.gif/.jpg), ISBN, editors, series
 * ============================================================
 */

function parseScienceDirectChapterHtml(htmlOrDoc, currentUrl = '') {
  let doc = htmlOrDoc;
  if (typeof htmlOrDoc === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(htmlOrDoc, 'text/html');
  }

  // 1. Ekstrak Judul Chapter / Article
  let chapterTitle = '';
  const titleEl = doc.querySelector(
    '#screen-reader-main-title .title-text, h1.content-title .title-text, h1.content-title, #screen-reader-main-title, .title-text, h1'
  );
  if (titleEl) {
    chapterTitle = titleEl.textContent.replace(/^Chapter\s+\d+\s*[-–—:]\s*/i, '').trim();
  }

  // 2. Ekstrak Link Buku Induk (jika format Book Chapter)
  let bookUrl = '';
  let preliminaryBookTitle = '';
  const bookLink = doc.querySelector(
    '.publication-details a[href*="/book/"], .publication-cover-image a[href*="/book/"], a[href*="/book/"]'
  );
  if (bookLink) {
    const href = bookLink.getAttribute('href') || '';
    bookUrl = href.startsWith('http') ? href : ('https://www.sciencedirect.com' + (href.startsWith('/') ? '' : '/') + href);
    preliminaryBookTitle = bookLink.textContent.trim();
  }

  // 3. Ekstrak Link Journal / Procedia (jika format Journal / Conference Proceeding)
  let journalUrl = '';
  const journalLink = doc.querySelector(
    '.publication-details a[href*="/journal/"], .publication-cover-image a[href*="/journal/"], .publication-title a, a[href*="/journal/"]'
  );
  if (journalLink) {
    const href = journalLink.getAttribute('href') || '';
    journalUrl = href.startsWith('http') ? href : ('https://www.sciencedirect.com' + (href.startsWith('/') ? '' : '/') + href);
    if (!preliminaryBookTitle) {
      preliminaryBookTitle = journalLink.textContent.trim();
    }
  }

  // 4. Judul Publikasi (Buku atau Journal/Procedia) dari Header
  const pubTitleEl = doc.querySelector(
    '.publication-title, [data-aa-region="publication-title"], h2.publication-title'
  );
  const publicationTitle = pubTitleEl ? pubTitleEl.textContent.trim() : (preliminaryBookTitle || 'Elsevier Publication');

  // 5. Ekstrak Cover Image (upgrade cov150h -> cov200h)
  let coverUrl = '';
  const coverImg = doc.querySelector('.publication-cover-image img, .publication img, #publication img');
  if (coverImg) {
    coverUrl = coverImg.getAttribute('src') || '';
    const srcset = coverImg.getAttribute('srcset') || '';
    if (srcset) {
      const match200 = srcset.match(/https:\/\/[^\s,]+cov200h\.gif/);
      if (match200) {
        coverUrl = match200[0];
      }
    }
    if (coverUrl.includes('cov150h.gif')) {
      coverUrl = coverUrl.replace('cov150h.gif', 'cov200h.gif');
    }
  }

  // 6. Ekstrak Volume & Tahun
  let volume = '';
  const volEl = doc.querySelector('.publication-volume, .publication-metadata .volume');
  if (volEl) {
    volume = volEl.textContent.trim();
  }

  let year = '';
  if (volume) {
    const yMatch = volume.match(/\b(19\d\d|20\d\d)\b/);
    if (yMatch) year = yMatch[1];
  }
  if (!year) {
    const yearMatch = (doc.body ? doc.body.textContent : '').match(/Date:\s*<!--\s*-->\s*(\d{4})|Date:\s*(\d{4})|Copyright\s*©\s*(\d{4})|(\d{4})\s*Elsevier/i);
    if (yearMatch) {
      year = yearMatch[1] || yearMatch[2] || yearMatch[3] || yearMatch[4];
    }
  }

  // 7. Ekstrak Series
  let series = volume;
  const seriesEl = doc.querySelector('.series, .publication-metadata .series');
  if (seriesEl) {
    series = seriesEl.textContent.trim();
  }

  return {
    chapterTitle,
    bookUrl,
    journalUrl,
    publicationTitle,
    isBook: !!bookUrl,
    isJournalOrProceeding: !bookUrl && (!!journalUrl || !!coverUrl || !!publicationTitle),
    coverUrl,
    year,
    volume,
    series,
    sourceUrl: currentUrl
  };
}

function parseScienceDirectBookHtml(htmlOrDoc, currentUrl = '') {
  let doc = htmlOrDoc;
  if (typeof htmlOrDoc === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(htmlOrDoc, 'text/html');
  }

  // 1. Ekstrak Judul Buku
  let title = '';
  const titleEl = doc.querySelector('#book-title-and-authors h1, h1.u-font-serif, .book-title, h1');
  if (titleEl) {
    title = titleEl.textContent.trim();
  }

  // 2. Ekstrak Subtitle
  let subtitle = '';
  const subtitleCandidates = doc.querySelectorAll('#book-title-and-authors p, .banner-grid p');
  for (const p of subtitleCandidates) {
    const text = p.textContent.trim();
    if (!text.includes('Part of series:') && !text.includes('Edited by:') && !text.includes('Author(s):') && text.length > 2) {
      subtitle = text;
      break;
    }
  }

  // 3. Ekstrak Series
  let series = '';
  const seriesEl = doc.querySelector('.book-series-text, .series');
  if (seriesEl) {
    series = seriesEl.textContent.replace(/Book\s*•\s*Part of series:\s*/i, '').trim();
  }

  // 4. Ekstrak Editor / Penulis
  let editors = '';
  for (const p of subtitleCandidates) {
    const text = p.textContent.trim();
    if (text.includes('Edited by:') || text.includes('Author(s):')) {
      editors = text.replace(/^(Edited by|Author\(s\)):\s*/i, '').trim();
      break;
    }
  }

  // 5. Ekstrak Gambar Cover Resolusi Tinggi
  let coverUrl = '';
  const coverImg = doc.querySelector(
    '.book-cover-img, #book-cover-and-meta img, .book-cover-img-wrapper img, .publication-cover-image img'
  );
  if (coverImg) {
    coverUrl = coverImg.getAttribute('src') || '';
    const srcset = coverImg.getAttribute('srcset') || '';
    if (srcset) {
      const match200 = srcset.match(/https:\/\/[^\s,]+cov200h\.gif/);
      if (match200) {
        coverUrl = match200[0];
      }
    }
    // Upgrade ke resolusi 200h jika masih 150h
    if (coverUrl.includes('cov150h.gif')) {
      coverUrl = coverUrl.replace('cov150h.gif', 'cov200h.gif');
    }
  }

  // 6. Ekstrak ISBN dari URL (/book/9780443338717/...)
  let isbn = '';
  const isbnMatch = currentUrl.match(/\/book\/(\d{10,13})/i);
  if (isbnMatch) {
    isbn = isbnMatch[1];
  }

  // 7. Ekstrak Tahun dari Halaman jika ada
  let year = '';
  const yearMatch = (doc.body ? doc.body.textContent : '').match(/Copyright\s*©\s*(\d{4})|(\d{4})\s*Elsevier/i);
  if (yearMatch) {
    year = yearMatch[1] || yearMatch[2];
  }

  return {
    title: title || 'Elsevier Book',
    subtitle,
    series,
    editors: editors || 'Elsevier',
    coverUrl,
    isbn,
    year,
    publisher: 'Elsevier',
    publisherType: 'Elsevier',
    isPdfCover: false,
    bookUrl: currentUrl,
    sourceUrl: currentUrl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseScienceDirectChapterHtml, parseScienceDirectBookHtml };
} else if (typeof window !== 'undefined') {
  window.parseScienceDirectChapterHtml = parseScienceDirectChapterHtml;
  window.parseScienceDirectBookHtml = parseScienceDirectBookHtml;
}
