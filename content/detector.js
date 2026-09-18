/**
 * content/detector.js
 * ============================================================
 * Content script yang berjalan di halaman web (seperti landing page index.html)
 * untuk menandai bahwa ekstensi "Sampul Publikasi" telah terpasang dan aktif.
 * ============================================================
 */
(function () {
  const notifyExtensionInstalled = () => {
    try {
      if (document.documentElement) {
        document.documentElement.setAttribute('data-extension-installed', 'true');
        document.documentElement.setAttribute('data-extension-version', '1.1.0');
      }

      window.dispatchEvent(new CustomEvent('SAMPUL_PUBLIKASI_INSTALLED', {
        detail: {
          installed: true,
          version: '1.1.0',
          dashboardUrl: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('dashboard/dashboard.html') : ''
        }
      }));
    } catch (e) {
      console.warn('[Sampul Publikasi Detector] Error:', e);
    }
  };

  notifyExtensionInstalled();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyExtensionInstalled);
  }
})();
