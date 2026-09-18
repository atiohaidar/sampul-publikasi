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

/**
 * Render Halaman Pertama Dokumen PDF ke Gambar PNG Resolusi Tinggi
 */
async function renderPdfPageToPng(pdfDataOrUrl, { scale = 2.0, timeoutMs = 12000 } = {}) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('Pustaka pdfjsLib tidak ditemukan.');
  }

  const overallTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Waktu render PDF ke PNG melebihi batas (timeout)')), timeoutMs);
  });

  const doRender = async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
      } catch (e) {}
    }
    if (typeof pdfjsLib.verbosity !== 'undefined') {
      pdfjsLib.verbosity = 0;
    }

    let pdfBuffer = null;

    if (typeof pdfDataOrUrl === 'string' && /^https?:\/\//i.test(pdfDataOrUrl)) {
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), timeoutMs - 2000);

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
      throw new Error('Konten yang diterima bukan format PDF valid.');
    }

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

    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    const pngDataUrl = canvas.toDataURL('image/png');
    return pngDataUrl;
  };

  return Promise.race([doRender(), overallTimeoutPromise]);
}

/**
 * Konversi Gambar Raster (JPG, GIF, WebP, dsb.) ke PNG Data URL
 */
async function convertImageToPng(imageUrlOrData, { timeoutMs = 10000 } = {}) {
  if (!imageUrlOrData) {
    throw new Error('URL atau data gambar tidak boleh kosong.');
  }

  // Jika sudah format PNG data URL, langsung kembalikan
  if (typeof imageUrlOrData === 'string' && imageUrlOrData.startsWith('data:image/png')) {
    return imageUrlOrData;
  }

  const overallTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Waktu konversi gambar ke PNG melebihi batas (timeout)')), timeoutMs);
  });

  const doConvert = async () => {
    let blobUrl = null;
    let needRevoke = false;

    try {
      if (typeof imageUrlOrData === 'string' && /^https?:\/\//i.test(imageUrlOrData)) {
        // Ambil data gambar melalui fetch (di ekstensi tidak terkena CORS tainted canvas)
        const controller = new AbortController();
        const fetchTimer = setTimeout(() => controller.abort(), timeoutMs - 2000);
        const res = await fetch(imageUrlOrData, {
          credentials: 'include',
          signal: controller.signal
        });
        clearTimeout(fetchTimer);

        if (!res.ok) {
          throw new Error(`Gagal mengunduh gambar: HTTP ${res.status}`);
        }

        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        needRevoke = true;
      } else if (typeof Blob !== 'undefined' && imageUrlOrData instanceof Blob) {
        blobUrl = URL.createObjectURL(imageUrlOrData);
        needRevoke = true;
      } else {
        blobUrl = imageUrlOrData;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Gagal memuat format gambar untuk konversi PNG.'));
        img.src = blobUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 800;
      canvas.height = img.naturalHeight || img.height || 1200;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      ctx.drawImage(img, 0, 0);
      const pngDataUrl = canvas.toDataURL('image/png');
      return pngDataUrl;
    } finally {
      if (needRevoke && blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    }
  };

  return Promise.race([doConvert(), overallTimeoutPromise]);
}

/**
 * Konversi Cover (baik PDF maupun Gambar) menjadi PNG Data URL
 */
async function convertCoverToPng(coverUrlOrPdfUrl, isPdf = false, options = {}) {
  if (isPdf) {
    return await renderPdfPageToPng(coverUrlOrPdfUrl, options);
  } else {
    return await convertImageToPng(coverUrlOrPdfUrl, options);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderPdfPageToJpeg,
    renderPdfPageToPng,
    convertImageToPng,
    convertCoverToPng
  };
} else if (typeof window !== 'undefined') {
  window.renderPdfPageToJpeg = renderPdfPageToJpeg;
  window.renderPdfPageToPng = renderPdfPageToPng;
  window.convertImageToPng = convertImageToPng;
  window.convertCoverToPng = convertCoverToPng;
}
