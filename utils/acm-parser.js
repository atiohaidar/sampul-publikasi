/**
 * utils/acm-parser.js
 * ============================================================
 * Parser untuk ACM Digital Library (dl.acm.org / acm.org):
 * 1. Halaman Paper/Article: Ekstrak judul paper & link publikasi induk (/doi/proceedings/... atau /toc/...)
 * 2. Halaman Proceeding / Journal TOC: Ekstrak judul prosiding/jurnal, cover (.cover.jpg atau Front matter PDF),
 *    Editor, ISBN/ISSN, penerbit, dan tahun publikasi.
 * ============================================================
 */

function parseAcmArticleHtml(htmlOrDoc, currentUrl = '') {
  let doc = htmlOrDoc;
  if (typeof htmlOrDoc === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(htmlOrDoc, 'text/html');
  }

  // 1. Ekstrak Judul Paper / Article
  let paperTitle = '';
  const titleEl = doc.querySelector(
    'h1.citation__title, .citation__title, h1.left-bordered-title, .core-self-citation [property="name"], h1'
  );
  if (titleEl) {
    paperTitle = titleEl.textContent.trim();
  }

  // 2. Ekstrak Link Publikasi Induk (Conference Proceeding / Journal TOC)
  let proceedingUrl = '';
  let preliminaryProceedingTitle = '';

  const citationParentLink = doc.querySelector(
    '.core-self-citation .core-enumeration a[href*="/toc/"], ' +
    '.core-self-citation [property="isPartOf"] a[href*="/doi/proceedings/"], ' +
    '.core-self-citation [property="isPartOf"] a[href*="/toc/"], ' +
    '.core-self-citation a[href*="/doi/proceedings/"], ' +
    '.core-self-citation a[href*="/toc/"], ' +
    '.core-enumeration a[href*="/toc/"], ' +
    'a[href*="/doi/proceedings/"], a[href*="/toc/"]'
  );

  if (citationParentLink) {
    const href = citationParentLink.getAttribute('href') || '';
    proceedingUrl = href.startsWith('http') ? href : ('https://dl.acm.org' + (href.startsWith('/') ? '' : '/') + href);
    preliminaryProceedingTitle = citationParentLink.textContent.trim().replace(/\s+/g, ' ');
  }

  // 3. Ekstrak DOI Paper
  let paperDoi = '';
  const doiEl = doc.querySelector('.core-self-citation .doi a, a[href*="doi.org/10."], meta[name="dc.Identifier"][scheme="doi"]');
  if (doiEl) {
    const doiHref = doiEl.getAttribute('href') || doiEl.getAttribute('content') || doiEl.textContent || '';
    const match = doiHref.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    if (match) {
      paperDoi = match[0];
    }
  }

  // 4. Cek apakah ada cover langsung di halaman artikel
  let coverUrl = '';
  const coverImg = doc.querySelector(
    '.overlay-cover-wrapper img, .left-side-image img, img[alt*="cover" i], img[src*=".cover." i], img[data-src*=".cover." i]'
  );
  if (coverImg) {
    const src = coverImg.getAttribute('data-src') || coverImg.getAttribute('src') || coverImg.src || '';
    if (src && !src.includes('badge') && !src.includes('logo')) {
      coverUrl = src.startsWith('http') ? src : ('https://dl.acm.org' + (src.startsWith('/') ? '' : '/') + src);
    }
  }

  return {
    success: !!(proceedingUrl || coverUrl),
    isArticle: true,
    paperTitle: paperTitle,
    proceedingUrl: proceedingUrl,
    preliminaryProceedingTitle: preliminaryProceedingTitle,
    paperDoi: paperDoi,
    coverUrl: coverUrl
  };
}

function parseAcmProceedingsHtml(htmlOrDoc, currentUrl = '') {
  let doc = htmlOrDoc;
  if (typeof htmlOrDoc === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(htmlOrDoc, 'text/html');
  }

  // 1. Judul Proceeding / Conference / Journal
  let title = '';
  const titleEl = doc.querySelector(
    '.colored-block__title h2, h2.left-bordered-title, .colored-block.item-meta h2, .item-meta h2, h1.left-bordered-title, .publication-title, h1, h2'
  );
  if (titleEl) {
    title = titleEl.textContent.trim();
  }

  // 2. Ekstrak Metadata dari .item-meta-row
  let conferenceName = '';
  let publisher = 'ACM';
  let isbnOrIssn = '';
  let publishedDate = '';
  let year = '';
  let editors = '';

  const metaRows = doc.querySelectorAll('.item-meta-row');
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
      publishedDate = valText;
      const yMatch = valText.match(/\b(19\d\d|20\d\d)\b/);
      if (yMatch) {
        year = yMatch[1];
      }
    }
  });

  // Ekstrak tahun dari URL jika /toc/.../2025/...
  if (!year) {
    const urlYearMatch = currentUrl.match(/\/(\d{4})\//);
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
    const pageYearMatch = (doc.body ? doc.body.textContent : '').match(/Copyright\s*©\s*(\d{4})|(\d{4})\s*ACM/i);
    if (pageYearMatch) year = pageYearMatch[1] || pageYearMatch[2];
  }

  // 3. Ekstrak Cover Image (.cover.jpg)
  let coverUrl = '';
  const coverImg = doc.querySelector(
    '.overlay-cover-wrapper img, .left-side-image img, img.image-lazy-loaded, img[alt*="cover" i], img[src*=".cover." i], img[data-src*=".cover." i]'
  );
  if (coverImg) {
    const src = coverImg.getAttribute('data-src') || coverImg.getAttribute('src') || coverImg.src || '';
    if (src && !src.includes('badge') && !src.includes('logo')) {
      coverUrl = src.startsWith('http') ? src : ('https://dl.acm.org' + (src.startsWith('/') ? '' : '/') + src);
    }
  }

  // 4. Ekstrak Front Matter PDF / Issue PDF jika cover image tidak tersedia
  let coverPdfUrl = '';
  const fmPdfLink = doc.querySelector(
    'a[href*="/action/showFmPdf"], a[title*="Front matter" i], a[href*="showFmPdf"], a[href*="/doi/pdf/"]'
  );
  if (fmPdfLink) {
    const href = fmPdfLink.getAttribute('href') || '';
    coverPdfUrl = href.startsWith('http') ? href : ('https://dl.acm.org' + (href.startsWith('/') ? '' : '/') + href);
  }

  // 5. DOI Proceeding dari URL atau halaman
  let doi = '';
  const urlDoiMatch = currentUrl.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
  if (urlDoiMatch) {
    doi = urlDoiMatch[0];
  }

  const isPdfCover = !coverUrl && !!coverPdfUrl;

  return {
    success: !!(title || coverUrl || coverPdfUrl),
    title: title || conferenceName || 'ACM Publication',
    subtitle: conferenceName || title,
    publisher: publisher || 'ACM',
    series: conferenceName ? 'ACM Conference Proceedings' : 'ACM Publications',
    isbn: isbnOrIssn || (doi ? `ACM-${doi}` : ''),
    doi: doi,
    year: year,
    editors: editors || 'ACM',
    coverUrl: coverUrl,
    coverPdfUrl: coverPdfUrl,
    isPdfCover: isPdfCover
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAcmArticleHtml, parseAcmProceedingsHtml };
} else if (typeof window !== 'undefined') {
  window.parseAcmArticleHtml = parseAcmArticleHtml;
  window.parseAcmProceedingsHtml = parseAcmProceedingsHtml;
}
