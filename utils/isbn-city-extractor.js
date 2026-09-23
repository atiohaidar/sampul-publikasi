/**
 * utils/isbn-city-extractor.js
 * ============================================================
 * Ekstraktor Cerdas untuk:
 * 1. ISBN (Electronic ISBN & Print ISBN dipisah rapi)
 * 2. Menolak & Mengabaikan ISSN (Hanya ISBN yang diambil)
 * 3. Kota / Lokasi Konferensi (City / Conference Location)
 * 4. Mendukung Scopus (Flyout "Detailed information", Bibliographic info, __NEXT_DATA__)
 * 5. Mendukung IEEE Xplore, Springer, ScienceDirect, ACM, SPIE, IGI Global, IOP, OJS, dan Universal Fallback
 * ============================================================
 */

/**
 * Validasi apakah suatu string adalah format ISBN yang valid (Bukan ISSN)
 * ISBN memiliki 10 atau 13 digit.
 * ISSN hanya memiliki 8 digit (format: XXXX-XXXX).
 */
function isValidIsbn(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = str.trim();

  // Tolak tegas jika ada label ISSN atau format ISSN 8 digit
  if (/^ISSN\b/i.test(clean) || /\bISSN\b/i.test(clean)) return false;

  const digits = clean.replace(/[^0-9Xx]/g, '');
  if (digits.length === 8) {
    // 8 digit adalah format standar ISSN, bukan ISBN
    return false;
  }

  // ISBN valid harus 10 atau 13 digit
  if (digits.length === 10 || digits.length === 13) {
    if (digits.length === 13) {
      // ISBN-13 diawali dengan 978 atau 979
      return digits.startsWith('978') || digits.startsWith('979');
    }
    return true;
  }

  return false;
}

/**
 * Bersihkan string ISBN agar rapi
 */
function sanitizeIsbn(str) {
  if (!str) return '';
  return str.replace(/^(?:ISBN(?:-13|-10)?|E-?ISBN(?:-13)?|Print\s*ISBN(?:-13)?|Electronic\s*ISBN(?:-13)?|eBook\s*ISBN(?:-13)?|Print\s*on\s*Demand\s*\(PoD\)\s*ISBN)[\s:]*/i, '')
            .replace(/[^\d-X]/gi, '')
            .replace(/^-+|-+$/g, '')
            .trim();
}

/**
 * Bersihkan string Kota / Lokasi Konferensi
 */
function cleanCityOrLocation(str) {
  if (!str) return '';
  let clean = str.replace(/^(?:Conference\s*Location|Conference\s*City|Location|City|Venue|Held\s*in)[\s:]*/i, '')
                 .replace(/^(?:Hybrid|Virtual|Online)\s*,\s*/i, '')
                 .replace(/[\r\n\t]+/g, ' ')
                 .replace(/\s{2,}/g, ' ')
                 .trim();

  // Jika ada rentang tanggal (misal: "01/10/2025 - 02/10/2025 Kuala Lumpur, Malaysia" atau "17-18 June 2026 Yogyakarta, Indonesia")
  const dateRangeMatch = clean.match(/(?:(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s*[-–—]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*[-–—]?\s*(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})?)\s*,?\s*([A-Za-z\s,.-]+)$/i);
  if (dateRangeMatch && dateRangeMatch[1]) {
    const candidate = dateRangeMatch[1].trim();
    if (candidate.length > 2 && !/^\d+$/.test(candidate)) {
      clean = candidate;
    }
  }

  // Hilangkan sisa tanggal di depan jika masih ada
  clean = clean.replace(/^(?:\d{1,2}\s*[-–—]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*,?\s*/i, '');

  // Hilangkan sisa Hybrid / Virtual di depan jika ada lagi
  clean = clean.replace(/^(?:Hybrid|Virtual|Online)\s*,\s*/i, '');

  // Hilangkan karakter pembatas yang tertinggal
  clean = clean.replace(/^[,;.\-–—\s]+|[,;.\-–—\s]+$/g, '');
  return clean;
}

/**
 * Parsing teks yang mengandung satu atau lebih ISBN (misal dari Scopus atau halaman publisher)
 * Otomatis memisahkan Electronic ISBN dan Print ISBN jika tersedia 2 atau lebih.
 */
function parseIsbnDetails(rawStringOrArray, { doi = '' } = {}) {
  let electronicIsbn = '';
  let printIsbn = '';
  const candidateList = [];

  if (Array.isArray(rawStringOrArray)) {
    rawStringOrArray.forEach(item => {
      if (typeof item === 'string') {
        const parts = item.split(/[,;\n\r|]+/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          const match = p.match(/([0-9-]{10,17}[0-9Xx])/);
          if (match && isValidIsbn(match[1])) {
            const found = sanitizeIsbn(match[1]);
            if (!candidateList.includes(found)) candidateList.push(found);
          }
        }
      }
    });
  } else if (typeof rawStringOrArray === 'string') {
    const raw = rawStringOrArray.trim();

    // 1. Cek pola berlabel eksplisit (misal: "Electronic ISBN: 979... Print on Demand: 979...")
    const electronicMatch = raw.match(/(?:Electronic(?:\s*ISBN)?|eBook(?:\s*ISBN)?|E-?ISBN(?:13)?|Online(?:\s*ISBN)?)[\s:]*([0-9-]{10,17}[0-9Xx])/i);
    if (electronicMatch && isValidIsbn(electronicMatch[1])) {
      electronicIsbn = sanitizeIsbn(electronicMatch[1]);
    }

    const printMatch = raw.match(/(?:Print(?:\s*on\s*Demand)?(?:\s*\(PoD\))?(?:\s*ISBN)?|Hardcover(?:\s*ISBN)?|Softcover(?:\s*ISBN)?|Paperback(?:\s*ISBN)?|ISBN13\s*Softcover)[\s:]*([0-9-]{10,17}[0-9Xx])/i);
    if (printMatch && isValidIsbn(printMatch[1])) {
      printIsbn = sanitizeIsbn(printMatch[1]);
    }

    // 2. Jika dipisahkan tanda koma atau baris baru (misal Scopus: "978-139438989-6, 978-139438986-5")
    const parts = raw.split(/[,;\n\r|]+/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/([0-9-]{10,17}[0-9Xx])/);
      if (match && isValidIsbn(match[1])) {
        const foundIsbn = sanitizeIsbn(match[1]);
        if (!candidateList.includes(foundIsbn)) {
          candidateList.push(foundIsbn);
        }
      }
    }
  }

  // Jika belum terisi dari label eksplisit namun ada kandidat ISBN:
  if (candidateList.length === 1) {
    if (!electronicIsbn && !printIsbn) {
      // Jika hanya ada 1 ISBN dan DOI mengandung angka ISBN tersebut -> Electronic ISBN
      const digitsOnly = candidateList[0].replace(/[^0-9Xx]/g, '');
      if (doi && doi.replace(/[^0-9Xx]/g, '').includes(digitsOnly)) {
        electronicIsbn = candidateList[0];
      } else {
        electronicIsbn = candidateList[0];
      }
    }
  } else if (candidateList.length >= 2) {
    if (!electronicIsbn && !printIsbn) {
      // Bandingkan dengan DOI untuk menentukan mana yang Electronic
      const firstDigits = candidateList[0].replace(/[^0-9Xx]/g, '');
      const secondDigits = candidateList[1].replace(/[^0-9Xx]/g, '');
      const cleanDoi = (doi || '').replace(/[^0-9Xx]/g, '');

      if (cleanDoi && cleanDoi.includes(secondDigits)) {
        electronicIsbn = candidateList[1];
        printIsbn = candidateList[0];
      } else if (cleanDoi && cleanDoi.includes(firstDigits)) {
        electronicIsbn = candidateList[0];
        printIsbn = candidateList[1];
      } else {
        // Default konvensi Scopus/Katalog: Urutan pertama = Electronic, kedua = Print
        electronicIsbn = candidateList[0];
        printIsbn = candidateList[1];
      }
    } else if (electronicIsbn && !printIsbn) {
      const other = candidateList.find(isbn => isbn !== electronicIsbn);
      if (other) printIsbn = other;
    } else if (!electronicIsbn && printIsbn) {
      const other = candidateList.find(isbn => isbn !== printIsbn);
      if (other) electronicIsbn = other;
    }
  }

  return {
    isbnElectronic: electronicIsbn || '',
    isbnPrint: printIsbn || '',
    allIsbns: candidateList
  };
}

/**
 * Ekstraksi Metadata Scopus (ISBN Electronic, ISBN Print, Publisher, City/Location)
 * Mendukung pembacaan dari Flyout "Detailed information", Bibliographic info, meta tags, atau __NEXT_DATA__ di halaman Scopus.
 */
function extractScopusMetadata(docOrHtml) {
  let doc = null;
  if (typeof docOrHtml === 'object' && docOrHtml !== null) {
    doc = docOrHtml;
  } else if (typeof docOrHtml === 'string' && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(docOrHtml, 'text/html');
    } catch (e) {}
  }

  let rawIsbnText = '';
  let publisher = '';
  let city = '';
  let doi = '';
  let sourceTitle = '';

  // 1. Ekstrak dari Elemen Scopus Flyout / Detailed Information jika ada DOM
  if (doc && typeof doc.querySelector === 'function') {
    const isbnEl = doc.querySelector('[data-testid="source-info-isbn"], [data-testid="document-info-isbn"]');
    if (isbnEl) {
      rawIsbnText = isbnEl.textContent.trim();
    }

    if (!rawIsbnText) {
      const dts = doc.querySelectorAll('dl div dt, dl dt');
      for (const dt of dts) {
        const label = dt.textContent.trim().toLowerCase();
        const dd = dt.nextElementSibling || dt.parentElement.querySelector('dd');
        if (label === 'isbn' && dd) {
          rawIsbnText = dd.textContent.trim();
          break;
        }
      }
    }

    if (!rawIsbnText) {
      const isbnMeta = doc.querySelector('meta[name="citation_isbn"]');
      if (isbnMeta) rawIsbnText = isbnMeta.getAttribute('content') || '';
    }

    // 2. Ekstrak DOI dari Scopus
    const doiEl = doc.querySelector('[data-testid="document-info-doi"]');
    if (doiEl) {
      doi = doiEl.textContent.trim();
    }
    if (!doi) {
      const doiMeta = doc.querySelector('meta[name="citation_doi"]');
      if (doiMeta) doi = doiMeta.getAttribute('content') || '';
    }

    // 3. Ekstrak Publisher dari Scopus
    const pubEl = doc.querySelector('[data-testid="source-info-publisher"], [data-testid="document-info-publisher"]');
    if (pubEl) {
      publisher = pubEl.textContent.trim();
    }
    if (!publisher) {
      const pubMeta = doc.querySelector('meta[name="citation_publisher"]');
      if (pubMeta) publisher = pubMeta.getAttribute('content') || '';
    }

    // 4. Ekstrak Conference Location / City dari Scopus
    const locEl = doc.querySelector(
      '[data-testid="source-info-conference-city"], [data-testid*="conference-city"], [data-testid*="conference-location"], [data-testid*="location"], .DetailedInformationFlyout_metadata___Juk7 [data-testid*="location"]'
    );
    if (locEl) {
      city = cleanCityOrLocation(locEl.textContent);
    }

    if (!city) {
      const dts = doc.querySelectorAll('dl div dt, dl dt');
      for (const dt of dts) {
        const label = dt.textContent.trim().toLowerCase();
        const dd = dt.nextElementSibling || dt.parentElement.querySelector('dd');
        if ((label.includes('location') || label.includes('city') || label.includes('venue')) && dd) {
          city = cleanCityOrLocation(dd.textContent);
          break;
        }
      }
    }
  }

  // 5. Ekstrak Source Title (Judul Buku / Prosiding)
  if (doc && typeof doc.querySelector === 'function') {
    const sourceTitleEl = doc.querySelector('[data-testid="source-info-source-title"]');
    if (sourceTitleEl) {
      sourceTitle = sourceTitleEl.textContent.trim();
    }
  }

  // 6. Cek JSON __NEXT_DATA__ jika masih belum lengkap
  if (doc && (!rawIsbnText || !city || !publisher)) {
    try {
      const nextScript = doc.getElementById ? doc.getElementById('__NEXT_DATA__') : doc.querySelector('#__NEXT_DATA__');
      if (nextScript && nextScript.textContent) {
        const nextJson = JSON.parse(nextScript.textContent);
        const searchNextData = (obj, depth = 0) => {
          if (!obj || depth > 8) return;
          if (typeof obj !== 'object') return;

          if (!rawIsbnText && (obj.isbn || obj.isbnList || obj.isbns)) {
            const candidate = obj.isbn || obj.isbnList || obj.isbns;
            if (Array.isArray(candidate)) rawIsbnText = candidate.join(', ');
            else if (typeof candidate === 'string') rawIsbnText = candidate;
          }
          if (!city && (obj.conferenceLocation || obj.confLocation || obj.city)) {
            const locVal = obj.conferenceLocation || obj.confLocation || obj.city;
            if (typeof locVal === 'string') city = cleanCityOrLocation(locVal);
          }
          if (!publisher && (obj.publisherName || obj.publisher)) {
            const pubVal = obj.publisherName || obj.publisher;
            if (typeof pubVal === 'string') publisher = pubVal.trim();
          }
          if (!doi && obj.doi && typeof obj.doi === 'string') {
            doi = obj.doi.trim();
          }
          if (!sourceTitle && obj.sourceTitle && typeof obj.sourceTitle === 'string') {
            sourceTitle = obj.sourceTitle.trim();
          }

          for (const key of Object.keys(obj)) {
            searchNextData(obj[key], depth + 1);
          }
        };
        searchNextData(nextJson);
      }
    } catch (e) {}
  }

  // Fallback regex jika parsing string HTML
  if (typeof docOrHtml === 'string') {
    if (!rawIsbnText) {
      const isbnDlMatch = docOrHtml.match(/<dt[^>]*>\s*ISBN\s*:?[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/i);
      if (isbnDlMatch) {
        rawIsbnText = isbnDlMatch[1].replace(/<[^>]+>/g, '').trim();
      }
    }
    if (!publisher) {
      const pubDlMatch = docOrHtml.match(/<dt[^>]*>\s*Publisher\s*:?[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/i);
      if (pubDlMatch) {
        publisher = pubDlMatch[1].replace(/<[^>]+>/g, '').trim();
      }
    }
    if (!city) {
      const locMatch = docOrHtml.match(/<dt[^>]*>\s*Conference\s*location\s*:?[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/i);
      if (locMatch) {
        city = cleanCityOrLocation(locMatch[1].replace(/<[^>]+>/g, '').trim());
      }
    }
  }

  // 7. Pisahkan ISBN Electronic dan Print
  const isbnParsed = parseIsbnDetails(rawIsbnText, { doi });

  return {
    rawIsbn: rawIsbnText,
    isbnElectronic: isbnParsed.isbnElectronic,
    isbnPrint: isbnParsed.isbnPrint,
    allIsbns: isbnParsed.allIsbns,
    publisher,
    city,
    doi,
    sourceTitle
  };
}

/**
 * Ekstraksi Metadata IEEE Document Page (Electronic ISBN, Print on Demand ISBN, Conference Location)
 */
function extractIeeeDocumentMetadata(docOrHtml) {
  let doc = null;
  if (typeof docOrHtml === 'object' && docOrHtml !== null) {
    doc = docOrHtml;
  } else if (typeof docOrHtml === 'string' && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(docOrHtml, 'text/html');
    } catch (e) {}
  }

  let electronicIsbn = '';
  let printIsbn = '';
  let city = '';
  let doi = '';
  let publisher = 'IEEE';

  // 1. Ekstrak Electronic ISBN & Print on Demand ISBN dari block abstract-metadata-indent
  if (doc && typeof doc.querySelectorAll === 'function') {
    const metadataDivs = doc.querySelectorAll('.abstract-metadata-indent div, .abstract-metadata-indent, .doc-abstract-confdate ~ div, .u-pb-1 div');
    metadataDivs.forEach(div => {
      const text = (div.textContent || '').trim();

      if (/Electronic\s*ISBN/i.test(text)) {
        const match = text.match(/([0-9-]{10,17}[0-9Xx])/);
        if (match && isValidIsbn(match[1])) {
          electronicIsbn = sanitizeIsbn(match[1]);
        }
      }
      if (/Print(?:[\s\S]*?ISBN)/i.test(text)) {
        const match = text.match(/([0-9-]{10,17}[0-9Xx])/);
        if (match && isValidIsbn(match[1])) {
          printIsbn = sanitizeIsbn(match[1]);
        }
      }
    });

    const locEl = doc.querySelector('.doc-abstract-conferenceLoc, .stats-document-abstract-confloc, [class*="conferenceLoc"]');
    if (locEl) {
      city = cleanCityOrLocation(locEl.textContent);
    }
  }

  // Fallback regex jika HTML string atau tertutup tombol akordeon
  const htmlString = typeof docOrHtml === 'string' ? docOrHtml : (doc && doc.body ? doc.body.innerHTML : '');
  if (htmlString) {
    if (!electronicIsbn) {
      const m = htmlString.match(/Electronic\s*ISBN\s*:?[\s\S]{0,100}?([0-9-]{10,17}[0-9Xx])/i);
      if (m && isValidIsbn(m[1])) electronicIsbn = sanitizeIsbn(m[1]);
    }
    if (!printIsbn) {
      const m = htmlString.match(/Print[\s\S]{0,40}?ISBN\s*:?[\s\S]{0,100}?([0-9-]{10,17}[0-9Xx])/i);
      if (m && isValidIsbn(m[1])) printIsbn = sanitizeIsbn(m[1]);
    }
    if (!city) {
      const m = htmlString.match(/Conference\s*Location\s*:?[\s\S]{0,100}?([^\n\r<]{3,80})/i);
      if (m) city = cleanCityOrLocation(m[1]);
    }
  }

  // 3. Ekstrak DOI dari IEEE
  if (doc && typeof doc.querySelector === 'function') {
    const doiEl = doc.querySelector('.stats-document-abstract-doi a, [href*="doi.org/10."]');
    if (doiEl) {
      const match = (doiEl.getAttribute('href') || doiEl.textContent || '').match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
      if (match) doi = match[0];
    }
  }

  return {
    isbnElectronic: electronicIsbn,
    isbnPrint: printIsbn,
    city,
    doi,
    publisher
  };
}

/**
 * Universal Ekstraktor Umum / Fallback untuk semua jenis publikasi & penerbit.
 * Secara ketat menolak ISSN dan memisahkan Electronic vs Print ISBN.
 */
function extractGenericPublicationMetadata(docOrHtml, { doi = '', sourceUrl = '' } = {}) {
  let doc = null;
  if (typeof docOrHtml === 'object' && docOrHtml !== null) {
    doc = docOrHtml;
  } else if (typeof docOrHtml === 'string' && typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(docOrHtml, 'text/html');
    } catch (e) {}
  }

  let rawIsbns = [];
  let electronicIsbn = '';
  let printIsbn = '';
  let city = '';
  let publisher = '';

  // 1. Ekstrak dari Meta Tags Standar jika ada DOM
  if (doc && typeof doc.querySelector === 'function') {
    const onlineIsbnMeta = doc.querySelector('meta[name="citation_online_isbn"]');
    if (onlineIsbnMeta && isValidIsbn(onlineIsbnMeta.getAttribute('content'))) {
      electronicIsbn = sanitizeIsbn(onlineIsbnMeta.getAttribute('content'));
    }

    const printIsbnMeta = doc.querySelector('meta[name="citation_print_isbn"]');
    if (printIsbnMeta && isValidIsbn(printIsbnMeta.getAttribute('content'))) {
      printIsbn = sanitizeIsbn(printIsbnMeta.getAttribute('content'));
    }

    const generalIsbnMeta = doc.querySelectorAll('meta[name="citation_isbn"], meta[property="book:isbn"]');
    generalIsbnMeta.forEach(meta => {
      const val = meta.getAttribute('content');
      if (isValidIsbn(val)) {
        rawIsbns.push(sanitizeIsbn(val));
      }
    });
  }

  // 2. Ekstrak dari Bibliographic Items atau Teks Body
  const bodyText = doc.body ? doc.body.textContent : '';

  if (!electronicIsbn) {
    const eMatch = bodyText.match(/(?:Electronic\s*ISBN|eBook\s*ISBN|Online\s*ISBN|E-?ISBN(?:13)?)[\s:]*([0-9-]{10,17}[0-9Xx])/i);
    if (eMatch && isValidIsbn(eMatch[1])) {
      electronicIsbn = sanitizeIsbn(eMatch[1]);
    }
  }

  if (!printIsbn) {
    const pMatch = bodyText.match(/(?:Print(?:\s*on\s*Demand)?(?:\s*\(PoD\))?(?:\s*ISBN)?|Hardcover(?:\s*ISBN)?|Softcover(?:\s*ISBN)?|Paperback(?:\s*ISBN)?)[\s:]*([0-9-]{10,17}[0-9Xx])/i);
    if (pMatch && isValidIsbn(pMatch[1])) {
      printIsbn = sanitizeIsbn(pMatch[1]);
    }
  }

  // Cari ISBN umum lainnya di teks hanya jika ada awalan kata ISBN eksplisit
  const allIsbnMatches = bodyText.match(/\bISBN(?:-13|-10)?[\s:]+([0-9-]{10,17}[0-9Xx])\b/gi);
  if (allIsbnMatches) {
    allIsbnMatches.forEach(m => {
      const matchOnly = m.match(/([0-9-]{10,17}[0-9Xx])/);
      if (matchOnly && isValidIsbn(matchOnly[1])) {
        const clean = sanitizeIsbn(matchOnly[1]);
        if (!rawIsbns.includes(clean)) {
          rawIsbns.push(clean);
        }
      }
    });
  }

  // 3. Ekstrak Lokasi Konferensi / City
  const locMeta = doc.querySelector('meta[name="citation_conference_location"], meta[name="citation_location"]');
  if (locMeta) {
    city = cleanCityOrLocation(locMeta.getAttribute('content'));
  }

  if (!city) {
    const locEl = doc.querySelector('[data-test*="location"], [class*="conferenceLoc"], [class*="location"], .conference-location');
    if (locEl) {
      city = cleanCityOrLocation(locEl.textContent);
    }
  }

  if (!city) {
    const locMatch = bodyText.match(/(?:Conference\s*Location|Held\s*in|Conference\s*Venue):?\s*([^\n\r<]{3,80})/i);
    if (locMatch) {
      city = cleanCityOrLocation(locMatch[1]);
    }
  }

  // 4. Ekstrak Publisher
  const pubMeta = doc.querySelector('meta[name="citation_publisher"], meta[property="og:site_name"]');
  if (pubMeta) publisher = pubMeta.getAttribute('content') || '';

  // 5. Harmonisasikan ISBN Electronic & Print
  const resolved = parseIsbnDetails([...rawIsbns, electronicIsbn, printIsbn].filter(Boolean), { doi });
  if (!electronicIsbn && resolved.isbnElectronic) electronicIsbn = resolved.isbnElectronic;
  if (!printIsbn && resolved.isbnPrint) printIsbn = resolved.isbnPrint;

  return {
    isbnElectronic: electronicIsbn,
    isbnPrint: printIsbn,
    allIsbns: resolved.allIsbns,
    city,
    publisher,
    doi
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isValidIsbn,
    sanitizeIsbn,
    cleanCityOrLocation,
    parseIsbnDetails,
    extractScopusMetadata,
    extractIeeeDocumentMetadata,
    extractGenericPublicationMetadata
  };
} else if (typeof window !== 'undefined') {
  window.isValidIsbn = isValidIsbn;
  window.sanitizeIsbn = sanitizeIsbn;
  window.cleanCityOrLocation = cleanCityOrLocation;
  window.parseIsbnDetails = parseIsbnDetails;
  window.extractScopusMetadata = extractScopusMetadata;
  window.extractIeeeDocumentMetadata = extractIeeeDocumentMetadata;
  window.extractGenericPublicationMetadata = extractGenericPublicationMetadata;
}
