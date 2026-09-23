/**
 * Utility to export scraped Springer books metadata into CSV format.
 * Includes UTF-8 BOM for seamless display in Microsoft Excel.
 */

function escapeCsvField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  // If field contains comma, quote, or newline, escape quotes and wrap in quotes
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateCsvContent(books) {
  const headers = [
    'ID',
    'Link Scopus',
    'Nama File Cover',
    'Judul Publikasi',
    'Judul Chapter / Paper',
    'Tahun',
    'Publisher',
    'Kota / Lokasi Konferensi',
    'ISBN Electronic',
    'ISBN Print',
    'ISBN / Paper ID',
    'Series / Volume',
    'Editor / Penulis',
    'URL Cover Asli',
    'URL Halaman Publisher',
    'Status Scraping'
  ];

  const rows = [headers.map(escapeCsvField).join(',')];

  books.forEach((book, idx) => {
    const rowId = book.customId || book.id || book.scopusId || (idx + 1);
    const row = [
      rowId,
      book.scopusUrl || book.sourceUrl || '',
      book.coverFilename || '',
      book.title || '',
      book.chapterTitle || '',
      book.year || '',
      book.publisher || '',
      book.city || '',
      book.isbnElectronic || '',
      book.isbnPrint || '',
      book.isbn || '',
      book.series || '',
      book.editors || '',
      book.coverUrl || book.coverPdfUrl || '',
      book.bookUrl || book.sourceUrl || '',
      book.status || 'Success'
    ];
    rows.push(row.map(escapeCsvField).join(','));
  });

  // Prepend UTF-8 BOM (\uFEFF)
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Initiates download of the CSV content.
 */
function downloadCsv(books, filename = 'scopus_springer_metadata_buku.csv') {
  const csvContent = generateCsvContent(books);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // Use URL.createObjectURL
  const url = URL.createObjectURL(blob);

  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  } else {
    // Standard DOM anchor click fallback
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeCsvField, generateCsvContent, downloadCsv };
} else if (typeof window !== 'undefined') {
  window.escapeCsvField = escapeCsvField;
  window.generateCsvContent = generateCsvContent;
  window.downloadCsv = downloadCsv;
}
