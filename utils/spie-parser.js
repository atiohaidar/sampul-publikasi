/**
 * utils/spie-parser.js
 * ============================================================
 * Parser untuk SPIE Digital Library (spiedigitallibrary.org / spie.org):
 * 1. Halaman Artikel Paper: Ekstrak link Proceeding Volume TOC (/conference-proceedings-of-spie/*.toc)
 * 2. Halaman Proceeding TOC: Ekstrak Front Matter PDF / Cover Image & info konferensi
 * ============================================================
 */

function parseSpieDocumentPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Ekstrak Judul Paper
  let paperTitle = '';
  const titleEl = doc.querySelector('h1, .DetailStyles-module__paperTitle___MpP__');
  if (titleEl) {
    paperTitle = titleEl.textContent.trim();
  }

  // 2. Ekstrak Link Proceeding Conference dari Header / Breadcrumb
  let proceedingUrl = '';
  const procLink = doc.querySelector(
    'a[href*="/conference-proceedings-of-spie/"][href$=".toc"], .DetailStyles-module__headerDetailsLink___nGMdB, a[aria-label*="Volume link"]'
  );

  if (procLink) {
    const href = procLink.getAttribute('href') || '';
    if (href) {
      proceedingUrl = href.startsWith('http') ? href : ('https://www.spiedigitallibrary.org' + (href.startsWith('/') ? '' : '/') + href);
    }
  }

  return {
    success: !!proceedingUrl,
    paperTitle,
    proceedingUrl,
    sourceUrl
  };
}

function parseSpieProceedingPage(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Ekstrak Nama Konferensi
  let conferenceName = '';
  const confTitleEl = doc.querySelector('.TocHeader-module__titleSlot___qafgr, .TocStyles-module__proceedingsVolumeNumberTitle___ho5AC, h1');
  if (confTitleEl) {
    conferenceName = confTitleEl.textContent.trim();
  }

  // 2. Ekstrak Tahun Publikasi
  let year = '';
  const bodyText = doc.body ? doc.body.textContent : '';
  const yearMatch = bodyText.match(/(\b20\d{2}\b)/);
  if (yearMatch) {
    year = yearMatch[1];
  }

  // 3. Cari Front Matter (Dokumen Cover PDF SPIE)
  let coverPdfUrl = '';
  let coverDirectPdfUrl = '';
  let coverTitle = '';
  let coverArnumber = '';

  const frontSection = doc.querySelector('[id*="FRONTMATTER"], .TocStyles-module__sectionTitle___mfd3G');
  const frontItem = doc.querySelector('[id*="FRONTMATTER"] ~ .TocStyles-module__paperItem___uGaLj, .TocStyles-module__paperItem___uGaLj');

  if (frontItem) {
    const titleLink = frontItem.querySelector('.TocStyles-module__paperTitle___MpP__ a, a[href*="Front-Matter"]');
    if (titleLink) {
      coverTitle = titleLink.textContent.trim();
      const href = titleLink.getAttribute('href') || '';
      
      const articleIdMatch = href.match(/\/(\d+)\/(\d+)\//);
      if (articleIdMatch) {
        coverArnumber = articleIdMatch[2]; // e.g. 1394101
        coverPdfUrl = `https://www.spiedigitallibrary.org/conference-proceedings-of-spie/article-pdf/${articleIdMatch[1]}/${articleIdMatch[2]}/front-matter.pdf`;
        coverDirectPdfUrl = coverPdfUrl;
      } else if (href) {
        const fullHref = href.startsWith('http') ? href : ('https://www.spiedigitallibrary.org' + (href.startsWith('/') ? '' : '/') + href);
        coverPdfUrl = fullHref;
        coverDirectPdfUrl = fullHref;
      }
    }
  }

  // 4. Cari Gambar Cover (jika ada)
  let coverImageUrl = '';
  const imgEl = doc.querySelector('.CoverWithLogo-module__coverWithLogoWrapper___QeLwn img, img[alt*="Cover of"], img[src*="Proceedings-Cover"]');
  if (imgEl) {
    const src = imgEl.getAttribute('src') || '';
    if (src) {
      coverImageUrl = src.startsWith('http') ? src : ('https://www.spiedigitallibrary.org' + (src.startsWith('/') ? '' : '/') + src);
    }
  }

  const coverFound = !!(coverPdfUrl || coverImageUrl);

  return {
    success: true,
    coverFound,
    conferenceName: conferenceName || 'SPIE Conference Proceeding',
    year: year || '',
    coverTitle: coverTitle || (coverFound ? 'Front Matter' : ''),
    coverPdfUrl: coverDirectPdfUrl || coverPdfUrl || '',
    coverDirectPdfUrl: coverDirectPdfUrl || coverPdfUrl || '',
    coverImageUrl: coverImageUrl || '',
    coverArnumber: coverArnumber || '',
    isPdfCover: !!coverPdfUrl,
    sourceUrl: sourceUrl || ''
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSpieDocumentPage, parseSpieProceedingPage };
} else if (typeof window !== 'undefined') {
  window.parseSpieDocumentPage = parseSpieDocumentPage;
  window.parseSpieProceedingPage = parseSpieProceedingPage;
}
