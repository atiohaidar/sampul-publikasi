/**
 * utils/csv-merger.js
 * ============================================================
 * Modul untuk Menggabungkan Beberapa Berkas CSV Hasil Scrape
 * Memiliki fitur:
 * 1. Penggabungan otomatis beberapa berkas CSV
 * 2. Normalisasi kolom & pembersihan duplikat berdasarkan ID/URL
 * 3. Urutkan data secara rapi berdasarkan ID
 * 4. Ekspor ke CSV & Format Clipboard (Siap Paste di Excel / Google Sheets)
 * ============================================================
 */

/**
 * Robust CSV parser yang mendukung RFC 4180 (penanganan tanda petik & koma)
 */
function parseCsvString(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [] };
  }

  const lines = [];
  let curVal = '';
  let inQuotes = false;
  let curRow = [];

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const nextChar = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && nextChar === '"') {
        curVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && nextChar === '\n') {
        i++;
      }
      curRow.push(curVal.trim());
      if (curRow.some(val => val.length > 0)) {
        lines.push(curRow);
      }
      curRow = [];
      curVal = '';
    } else if (c === ',' && !inQuotes) {
      curRow.push(curVal.trim());
      curVal = '';
    } else {
      curVal += c;
    }
  }

  if (curVal || curRow.length > 0) {
    curRow.push(curVal.trim());
    if (curRow.some(val => val.length > 0)) {
      lines.push(curRow);
    }
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Baris pertama adalah Header
  const rawHeaders = lines[0].map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = [];

  for (let r = 1; r < lines.length; r++) {
    const rowLine = lines[r];
    const rowObj = {};
    let empty = true;

    for (let c = 0; c < rawHeaders.length; c++) {
      const headerName = rawHeaders[c] || `Column_${c + 1}`;
      const val = rowLine[c] ? rowLine[c].replace(/^["']|["']$/g, '').trim() : '';
      rowObj[headerName] = val;
      if (val) empty = false;
    }

    if (!empty) {
      rows.push(rowObj);
    }
  }

  return { headers: rawHeaders, rows };
}

/**
 * Menggabungkan beberapa teks/berkas CSV
 */
function mergeMultipleCsvFiles(csvFilesArray, { deduplicate = true, sortById = true } = {}) {
  const allHeadersSet = new Set();
  const allRows = [];

  // Standardisasi nama-nama kolom utama
  const standardHeadersOrder = [
    'No', 'ID', 'Judul Buku / Proceeding', 'Judul Artikel / Chapter',
    'Subtitle', 'Nama File Cover', 'ISBN / ISSN', 'DOI', 'Tahun',
    'Editor', 'Series', 'Publisher', 'Link Scopus', 'Link Publisher'
  ];

  for (const item of csvFilesArray) {
    const csvContent = typeof item === 'string' ? item : (item.content || '');
    const fileName = typeof item === 'object' ? (item.name || 'CSV') : 'CSV';

    const parsed = parseCsvString(csvContent);
    if (!parsed || parsed.headers.length === 0) continue;

    parsed.headers.forEach(h => allHeadersSet.add(h));

    parsed.rows.forEach(row => {
      row._sourceFileName = fileName;
      allRows.push(row);
    });
  }

  if (allRows.length === 0) {
    return {
      headers: standardHeadersOrder,
      rows: [],
      removedDuplicatesCount: 0,
      totalFiles: csvFilesArray.length
    };
  }

  // Tentukan susunan header gabungan
  const mergedHeaders = [];
  standardHeadersOrder.forEach(sh => {
    if (allHeadersSet.has(sh)) {
      mergedHeaders.push(sh);
    }
  });

  allHeadersSet.forEach(h => {
    if (!mergedHeaders.includes(h)) {
      mergedHeaders.push(h);
    }
  });

  let finalRows = [...allRows];
  let removedDuplicatesCount = 0;

  // Helper untuk menilai kelengkapan & status sukses baris data
  const isFailedRow = (r) => {
    const st = String(r['Status'] || r['status'] || '').toLowerCase();
    const title = r['Judul Buku / Proceeding'] || r['Judul Artikel / Chapter'] || r['title'] || '';
    return st.includes('gagal') || st.includes('failed') || title === 'Gagal Diambil' || !title;
  };

  const getRowQualityScore = (r) => {
    let score = 0;
    if (!isFailedRow(r)) score += 1000;
    if (r['Nama File Cover'] && !r['Nama File Cover'].includes('(failed)')) score += 100;
    if (r['ISBN / ISSN'] || r['isbn']) score += 20;
    if (r['DOI'] || r['doi']) score += 20;
    if (r['Tahun'] || r['year']) score += 10;
    if (r['Link Scopus'] || r['scopusUrl']) score += 10;
    if (r['Judul Buku / Proceeding'] || r['title']) score += 10;
    return score;
  };

  // Hapus Duplikat jika diaktifkan (dengan prioritas Berhasil > Gagal)
  if (deduplicate) {
    const rowByKeyMap = new Map();

    for (const row of finalRows) {
      // Kunci unik: gabungan ID + URL atau ID saja atau Judul
      const idVal = row['ID'] || row['No'] || row['id'] || row['no'] || '';
      const scopusUrl = row['Link Scopus'] || row['Scopus URL'] || row['url'] || '';
      const pubUrl = row['Link Publisher'] || row['Publisher URL'] || '';
      const title = row['Judul Artikel / Chapter'] || row['Judul Buku / Proceeding'] || '';

      let uniqueKey = '';
      if (scopusUrl) {
        uniqueKey = 'scopus:' + scopusUrl.toLowerCase();
      } else if (pubUrl) {
        uniqueKey = 'pub:' + pubUrl.toLowerCase();
      } else if (idVal && title) {
        uniqueKey = `id_title:${idVal}_${title.toLowerCase()}`;
      } else if (idVal) {
        uniqueKey = 'id:' + idVal;
      } else {
        uniqueKey = 'title:' + title.toLowerCase();
      }

      if (uniqueKey) {
        if (!rowByKeyMap.has(uniqueKey)) {
          rowByKeyMap.set(uniqueKey, row);
        } else {
          // Jika kunci sudah ada, bandingkan kualitas data (Success vs Failed)
          const existingRow = rowByKeyMap.get(uniqueKey);
          const existingScore = getRowQualityScore(existingRow);
          const newScore = getRowQualityScore(row);

          // Jika baris baru berstatus Berhasil (atau nilainya lebih tinggi/lengkap), timpa baris lama!
          if (newScore > existingScore) {
            rowByKeyMap.set(uniqueKey, row);
          }
          removedDuplicatesCount++;
        }
      } else {
        // Jika tidak ada kunci unik sama sekali, tetap simpan
        rowByKeyMap.set('auto_' + Math.random(), row);
      }
    }

    finalRows = Array.from(rowByKeyMap.values());
  }

  // Urutkan berdasarkan ID secara numerik jika diaktifkan
  if (sortById) {
    finalRows.sort((a, b) => {
      const idA = a['ID'] || a['No'] || a['id'] || '';
      const idB = b['ID'] || b['No'] || b['id'] || '';

      const numA = parseInt(idA, 10);
      const numB = parseInt(idB, 10);

      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return String(idA).localeCompare(String(idB), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  return {
    headers: mergedHeaders,
    rows: finalRows,
    removedDuplicatesCount,
    totalFiles: csvFilesArray.length
  };
}

/**
 * Mengonversi baris tabel menjadi format TSV (Tab-Separated Values) untuk paste di Excel
 */
function convertTableToExcelClipboardString(headers, rows) {
  if (!headers || headers.length === 0) return '';

  const headerLine = headers.join('\t');
  const rowLines = rows.map(row => {
    return headers.map(h => {
      const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
      return val.replace(/[\r\n\t]+/g, ' ').trim();
    }).join('\t');
  });

  return [headerLine, ...rowLines].join('\n');
}

/**
 * Mengonversi baris tabel menjadi format CSV standar (RFC 4180)
 */
function convertTableToCsvString(headers, rows) {
  if (!headers || headers.length === 0) return '';

  const escapeCsv = (val) => {
    const str = (val !== undefined && val !== null) ? String(val) : '';
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCsv).join(',');
  const rowLines = rows.map(row => {
    return headers.map(h => escapeCsv(row[h])).join(',');
  });

  return [headerLine, ...rowLines].join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCsvString,
    mergeMultipleCsvFiles,
    convertTableToExcelClipboardString,
    convertTableToCsvString
  };
} else if (typeof window !== 'undefined') {
  window.parseCsvString = parseCsvString;
  window.mergeMultipleCsvFiles = mergeMultipleCsvFiles;
  window.convertTableToExcelClipboardString = convertTableToExcelClipboardString;
  window.convertTableToCsvString = convertTableToCsvString;
}
