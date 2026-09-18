/**
 * Sanitizes a string to make it safe for Windows/Linux/macOS file and directory names.
 * Removes illegal characters: < > : " / \ | ? * and ASCII control characters.
 */
function sanitizeFilename(name, fallback = 'untitled') {
  if (!name || typeof name !== 'string') {
    return fallback;
  }

  // Remove HTML tags if any
  let clean = name.replace(/<[^>]*>/g, '');

  // Replace invalid filesystem characters with an underscore
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // Replace consecutive underscores and spaces
  clean = clean.replace(/_+/g, '_').replace(/\s+/g, ' ').trim();

  // Strip leading/trailing dots or spaces (invalid on Windows)
  clean = clean.replace(/^[.\s]+|[.\s]+$/g, '');

  // Truncate to maximum safe length for Windows path safety (120 chars)
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim();
  }

  return clean || fallback;
}

/**
 * Formats cover filename based on user configuration pattern
 * @param {string} pattern - 'title' | 'isbn_title' | 'index_title'
 * @param {object} book - Book object containing title, isbn, index
 * @param {string} extension - File extension, e.g. '.jpg'
 */
function formatCoverFilename(pattern, book, extension = '.jpg') {
  const safeTitle = sanitizeFilename(book.title || 'buku_tanpa_judul');
  const safeIsbn = sanitizeFilename(book.isbn || 'no-isbn');
  const indexStr = String(book.index || 1).padStart(3, '0');
  const rawId = book.customId || book.id || book.scopusId || String(book.index || 1);
  const safeId = sanitizeFilename(String(rawId), 'item');

  let filename = '';
  switch (pattern) {
    case 'id_only':
      filename = safeId;
      break;
    case 'isbn_title':
      filename = `[${safeIsbn}] ${safeTitle}`;
      break;
    case 'index_title':
      filename = `${indexStr} - ${safeTitle}`;
      break;
    case 'title':
    default:
      filename = safeTitle;
      break;
  }

  // Ensure extension
  if (extension && !filename.toLowerCase().endsWith(extension.toLowerCase())) {
    filename += extension;
  }

  return filename;
}

// Export for ES modules and regular window/worker scope
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sanitizeFilename, formatCoverFilename };
} else if (typeof window !== 'undefined') {
  window.sanitizeFilename = sanitizeFilename;
  window.formatCoverFilename = formatCoverFilename;
}
