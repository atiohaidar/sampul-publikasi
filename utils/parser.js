/**
 * Parser for Springer Nature Book Pages
 * Extracts book title, subtitle, cover image (high-res), ISBN, DOI, editors, year, etc.
 */

function parseSpringerBookHtml(htmlString, sourceUrl = '') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // 1. Try to extract JSON-LD structured data first
  let jsonLd = null;
  try {
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      const parsed = JSON.parse(script.textContent || '{}');
      if (parsed['@type'] === 'Book' || (Array.isArray(parsed['@type']) && parsed['@type'].includes('Book'))) {
        jsonLd = parsed;
        break;
      }
    }
  } catch (e) {
    console.warn('Failed to parse JSON-LD:', e);
  }

  // 2. Extract Title
  let title = '';
  const titleEl = doc.querySelector('[data-test="book-title"]') ||
                  doc.querySelector('h1.app-article-masthead--book__info--book-title') ||
                  doc.querySelector('meta[property="og:title"]') ||
                  doc.querySelector('meta[name="title"]');

  if (titleEl) {
    title = titleEl.textContent ? titleEl.textContent.trim() : (titleEl.getAttribute('content') || '').trim();
  } else if (jsonLd && jsonLd.name) {
    title = jsonLd.name.replace(/\s*\([^)]*(eBook|Hardcover|Book)\)\s*$/i, '').trim();
  } else {
    // Fallback to <title>
    title = (doc.title || '').replace(/\s*\|\s*Springer.*$/i, '').replace(/:\s*Automating.*$/i, '').trim();
  }

  // 3. Extract Subtitle
  let subtitle = '';
  const subtitleEl = doc.querySelector('[data-test="book-subtitle"]') ||
                     doc.querySelector('.app-article-masthead--book__subtitle');
  if (subtitleEl) {
    subtitle = subtitleEl.textContent.trim();
  }

  // 4. Extract Cover Image URL (Prefer High-Resolution)
  let coverUrl = '';
  const highResLink = doc.querySelector('[data-test="cover-image"] a[data-img-src]') ||
                      doc.querySelector('a[data-component="cover-zoom"][data-img-src]');
  if (highResLink && highResLink.getAttribute('data-img-src')) {
    coverUrl = highResLink.getAttribute('data-img-src');
  } else {
    const pictureSource = doc.querySelector('[data-test="cover-image"] picture source');
    if (pictureSource && pictureSource.getAttribute('srcset')) {
      // Pick first srcset URL
      const srcset = pictureSource.getAttribute('srcset');
      const firstUrl = srcset.split(',')[0].trim().split(' ')[0];
      coverUrl = firstUrl;
    } else {
      const imgEl = doc.querySelector('[data-test="cover-image"] img');
      if (imgEl && (imgEl.getAttribute('src') || imgEl.getAttribute('srcset'))) {
        coverUrl = imgEl.getAttribute('src') || imgEl.getAttribute('srcset').split(',')[0].trim().split(' ')[0];
      } else if (doc.querySelector('meta[property="og:image"]')) {
        coverUrl = doc.querySelector('meta[property="og:image"]').getAttribute('content');
      } else if (jsonLd && jsonLd.image) {
        coverUrl = jsonLd.image;
      }
    }
  }

  // Upgrade image to high-res if it's thumbnail/low-res URL
  if (coverUrl) {
    if (coverUrl.startsWith('//')) {
      coverUrl = 'https:' + coverUrl;
    }
    // Replace /w153/ or /w158/ or /w90/ with /full/
    coverUrl = coverUrl.replace(/\/w\d+h?\d*\//, '/full/');
    // Switch to cover-hires path if it's cover
    coverUrl = coverUrl.replace('/cover/book/', '/cover-hires/book/');
    // Remove as=webp parameter if present to get clean JPEG
    coverUrl = coverUrl.replace(/\?as=webp.*/, '');
  }

  // 5. Extract ISBN
  let isbn = '';
  if (jsonLd && jsonLd.isbn) {
    isbn = jsonLd.isbn;
  }
  if (!isbn) {
    // Check bibliographic section
    const biblioItems = doc.querySelectorAll('.c-bibliographic-information__list-item, [data-test="bibliographic-information"] li');
    for (const item of biblioItems) {
      const text = item.textContent || '';
      if (/eBook ISBN|Hardcover ISBN|Softcover ISBN/i.test(text)) {
        const match = text.match(/([0-9]{3}-[0-9]-[0-9]{3}-[0-9]{5}-[0-9]|[0-9]{13}|[0-9]{10})/);
        if (match) {
          isbn = match[1];
          break;
        }
      }
    }
  }
  if (!isbn) {
    const isxnInput = doc.querySelector('input[name="isxn"]');
    if (isxnInput) {
      isbn = isxnInput.value;
    }
  }
  if (!isbn && coverUrl) {
    const match = coverUrl.match(/([0-9]{3}-[0-9]-[0-9]{3}-[0-9]{5}-[0-9]|[0-9]{13})/);
    if (match) {
      isbn = match[1];
    }
  }

  // 6. Extract DOI
  let doi = '';
  const doiMeta = doc.querySelector('meta[name="doi"]') ||
                  doc.querySelector('meta[name="citation_doi"]');
  if (doiMeta) {
    doi = doiMeta.getAttribute('content');
  } else if (jsonLd && jsonLd.identifier && jsonLd.identifier.value) {
    doi = jsonLd.identifier.value;
  } else if (sourceUrl) {
    const doiMatch = sourceUrl.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    if (doiMatch) {
      doi = doiMatch[0];
    }
  }

  // 7. Extract Year
  let year = '';
  const copyrightEl = doc.querySelector('.c-article-identifiers__copyright');
  if (copyrightEl && copyrightEl.parentElement) {
    const yearMatch = copyrightEl.parentElement.textContent.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
      year = yearMatch[1];
    }
  }
  if (!year) {
    const biblio = doc.querySelector('.c-bibliographic-information');
    if (biblio) {
      const match = biblio.textContent.match(/Published:\s*\d+\s+[A-Za-z]+\s+(20\d\d|19\d\d)/i);
      if (match) {
        year = match[1];
      }
    }
  }

  // 8. Extract Editors / Authors
  let editors = '';
  const editorList = doc.querySelector('[data-component="book-contributor-list"]');
  if (editorList) {
    editors = editorList.textContent.trim();
  } else {
    const authorEls = doc.querySelectorAll('[data-test="book-editor-links"] [data-test="author-name"], [data-test="editors-listing"] [data-test="author-name"]');
    if (authorEls.length > 0) {
      editors = Array.from(authorEls).map(el => el.textContent.trim()).filter(Boolean).join('; ');
    }
  }

  // 9. Extract Series
  let series = '';
  const seriesLink = doc.querySelector('[data-test="series-link"] a') ||
                     doc.querySelector('.app-book-series-listing a');
  if (seriesLink) {
    series = seriesLink.textContent.trim();
  }

  // 10. Extract Publisher
  let publisher = 'Springer';
  const pubEl = doc.querySelector('.c-bibliographic-information');
  if (pubEl) {
    const pubMatch = pubEl.textContent.match(/Publisher\s*:\s*([^\n\r<]+)/i);
    if (pubMatch) {
      publisher = pubMatch[1].trim();
    }
  }

  return {
    title: title || 'Tanpa Judul',
    subtitle: subtitle || '',
    coverUrl: coverUrl || '',
    isbn: isbn || '',
    doi: doi || '',
    year: year || '',
    editors: editors || '',
    series: series || '',
    publisher: publisher || 'Springer',
    sourceUrl: sourceUrl || ''
  };
}

/**
 * Universal Smart Fallback Parser for any academic / book publisher page
 */
function parseGenericPublisherHtml(docOrHtml, sourceUrl = '') {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(docOrHtml, 'text/html');
  }

  // 1. Title
  let title = '';
  const titleEl = doc.querySelector('meta[property="og:title"]') ||
                  doc.querySelector('meta[name="citation_title"]') ||
                  doc.querySelector('meta[name="title"]') ||
                  doc.querySelector('h1');
  if (titleEl) {
    title = titleEl.getAttribute('content') || titleEl.textContent || '';
    title = title.trim();
  }
  if (!title && doc.title) {
    title = doc.title.split('|')[0].split('-')[0].trim();
  }

  // 2. Cover Image (Detecting various cover image conventions)
  let coverUrl = '';
  const coverImgCandidates = [
    doc.querySelector('img[id*="imgCover" i]'),
    doc.querySelector('img.cover-img-b'),
    doc.querySelector('.item.cover_image img'),
    doc.querySelector('.entry_details .cover_image img'),
    doc.querySelector('#wd-jnl-hm-intro img'),
    doc.querySelector('.pull-left img[src*="cover" i]'),
    doc.querySelector('.publication-cover-image img'),
    doc.querySelector('img[src*="cover" i]'),
    doc.querySelector('img[alt*="cover" i]'),
    doc.querySelector('meta[property="og:image"]'),
    doc.querySelector('meta[name="twitter:image"]')
  ];

  for (const candidate of coverImgCandidates) {
    if (!candidate) continue;
    let src = '';
    if (candidate.tagName && candidate.tagName.toLowerCase() === 'meta') {
      src = candidate.getAttribute('content') || '';
    } else {
      src = candidate.getAttribute('src') || candidate.src || candidate.getAttribute('data-src') || '';
    }
    if (src && !src.includes('badge') && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
      coverUrl = src;
      break;
    }
  }

  if (coverUrl) {
    if (coverUrl.startsWith('//')) {
      coverUrl = 'https:' + coverUrl;
    } else if (!coverUrl.startsWith('http') && sourceUrl) {
      try {
        const origin = new URL(sourceUrl).origin;
        coverUrl = origin + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;
      } catch (e) {}
    }
  }

  // 3. ISBN / DOI
  let isbn = '';
  const isbnMeta = doc.querySelector('meta[name="citation_isbn"]');
  if (isbnMeta) isbn = isbnMeta.getAttribute('content') || '';
  if (!isbn) {
    const text = doc.body ? doc.body.textContent : '';
    const match = text.match(/ISBN(?:-13)?:?\s*(\d{13}|\d{10}|\d{3}-\d-\d{3}-\d{5}-\d)/i);
    if (match) isbn = match[1];
  }

  let doi = '';
  const doiMeta = doc.querySelector('meta[name="citation_doi"]');
  if (doiMeta) doi = doiMeta.getAttribute('content') || '';
  if (!doi && sourceUrl) {
    const match = sourceUrl.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    if (match) doi = match[0];
  }

  // 4. Year
  let year = '';
  const dateMeta = doc.querySelector('meta[name="citation_publication_date"]') ||
                   doc.querySelector('meta[name="citation_date"]') ||
                   doc.querySelector('meta[name="dc.date"]');
  if (dateMeta) {
    const match = (dateMeta.getAttribute('content') || '').match(/\b(19\d\d|20\d\d)\b/);
    if (match) year = match[1];
  }
  if (!year) {
    const text = doc.body ? doc.body.textContent : '';
    const match = text.match(/©\s*(\d{4})|Copyright:?\s*©?\s*(\d{4})|(\b20\d{2}\b)/i);
    if (match) year = match[1] || match[2] || match[3];
  }

  // 5. Publisher Name
  let publisher = '';
  const pubMeta = doc.querySelector('meta[name="citation_publisher"]') ||
                  doc.querySelector('meta[property="og:site_name"]');
  if (pubMeta) publisher = pubMeta.getAttribute('content') || '';
  if (!publisher && sourceUrl) {
    try {
      publisher = new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch (e) {}
  }

  return {
    success: !!(coverUrl || title),
    title: title || 'Publisher Document',
    coverUrl: coverUrl || '',
    isbn: isbn ? `ISBN-${isbn}` : '',
    doi: doi,
    year: year,
    publisher: publisher || 'General Publisher',
    sourceUrl: sourceUrl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSpringerBookHtml, parseGenericPublisherHtml };
} else if (typeof window !== 'undefined') {
  window.parseSpringerBookHtml = parseSpringerBookHtml;
  window.parseGenericPublisherHtml = parseGenericPublisherHtml;
}

