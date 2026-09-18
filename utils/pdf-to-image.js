/**
 * utils/pdf-to-image.js
 * ============================================================
 * Mengonversi Halaman Pertama PDF menjadi Gambar Resolusi Tinggi (JPEG)
 * Menggunakan engine PDF.js yang disematkan di folder /libs
 * ============================================================
 */

async function renderPdfPageToJpeg(pdfDataOrUrl, { scale = 1.8, quality = 0.92, timeoutMs = 8000 } = {}) {
  // Pastikan pdfjsLib tersedia
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('Pustaka pdfjsLib tidak ditemukan.');
  }

  // Gunakan timeout keseluruhan agar tidak pernah menggantung proses
  const overallTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Waktu render PDF melebihi batas (timeout)')), timeoutMs);
  });

  const doRender = async () => {
    // Set workerSrc jika berjalan di ekstensi Chrome
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
      } catch (e) {}
    }
    if (typeof pdfjsLib.verbosity !== 'undefined') {
      pdfjsLib.verbosity = 0;
    }

    let pdfBuffer = null;

    // Jika input adalah string URL, fetch dengan AbortController
    if (typeof pdfDataOrUrl === 'string' && /^https?:\/\//i.test(pdfDataOrUrl)) {
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), 6500);

      try {
        const res = await fetch(pdfDataOrUrl, {
          credentials: 'include',
          signal: controller.signal
        });
        clearTimeout(fetchTimer);

        if (!res.ok) {
          throw new Error(`Gagal mengunduh PDF: HTTP ${res.status}`);
        }

        pdfBuffer = await res.arrayBuffer();
      } catch (fetchErr) {
        clearTimeout(fetchTimer);
        throw new Error(`Koneksi fetch PDF gagal: ${fetchErr.message}`);
      }
    } else if (pdfDataOrUrl instanceof ArrayBuffer || ArrayBuffer.isView(pdfDataOrUrl)) {
      pdfBuffer = pdfDataOrUrl instanceof ArrayBuffer ? pdfDataOrUrl : pdfDataOrUrl.buffer;
    }

    if (!pdfBuffer || pdfBuffer.byteLength < 10) {
      throw new Error('Data berkas PDF kosong atau tidak valid.');
    }

    // VALIDASI HEADER PDF: Berkas PDF valid WAJIB diawali dengan "%PDF-"
    const headerBytes = new Uint8Array(pdfBuffer.slice(0, 5));
    const headerMagic = String.fromCharCode(...headerBytes);
    if (headerMagic !== '%PDF-') {
      throw new Error('Konten yang diterima bukan format PDF valid (mungkin halaman proteksi atau HTML).');
    }

    // Load dokumen PDF
    const loadingTask = pdfjsLib.getDocument({
      data: pdfBuffer,
      verbosity: 0
    });

    let pdfDoc = null;
    try {
      pdfDoc = await loadingTask.promise;
    } catch (loadErr) {
      try { loadingTask.destroy(); } catch (e) {}
      throw new Error(`Gagal membaca struktur PDF: ${loadErr.message}`);
    }

    const page = await pdfDoc.getPage(1); // Ambil halaman pertama (Front Cover)
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl;
  };

  return Promise.race([doRender(), overallTimeoutPromise]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderPdfPageToJpeg };
} else if (typeof window !== 'undefined') {
  window.renderPdfPageToJpeg = renderPdfPageToJpeg;
}
