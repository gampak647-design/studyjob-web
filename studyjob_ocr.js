(() => {
  let workerPromise = null;
  let queue = Promise.resolve();
  let pickerSequence = 0;
  let rememberedOcrToken = '';
  let rememberedOcrDataUrl = '';

  const OCR_ENGINE = 'web_tesseract_v7_ru_psm11_focus_fast';

  async function waitForTesseract(timeoutMs = 6000) {
    const startedAt = Date.now();
    while (
      (!globalThis.Tesseract ||
        typeof globalThis.Tesseract.createWorker !== 'function') &&
      Date.now() - startedAt < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!globalThis.Tesseract || typeof globalThis.Tesseract.createWorker !== 'function') {
      throw new Error('tesseract_not_loaded');
    }
  }

  async function getWorker() {
    await waitForTesseract();
    if (!workerPromise) {
      workerPromise = (async () => {
        const worker = await globalThis.Tesseract.createWorker('rus', 1, {
          logger: () => {},
        });
        try {
          if (worker && typeof worker.setParameters === 'function') {
            await worker.setParameters({
              tessedit_pageseg_mode: '11',
              preserve_interword_spaces: '1',
              user_defined_dpi: '300',
            });
          }
        } catch (_) {}
        return worker;
      })();
    }
    try {
      return await workerPromise;
    } catch (error) {
      workerPromise = null;
      throw error;
    }
  }

  async function warmupInternal() {
    try {
      await getWorker();
      return 'ok';
    } catch (_) {
      return 'unavailable';
    }
  }

  function rememberOcrDataUrl(dataUrl) {
    pickerSequence += 1;
    rememberedOcrToken = `${Date.now().toString(36)}_${pickerSequence.toString(36)}`;
    rememberedOcrDataUrl = dataUrl;
    return rememberedOcrToken;
  }

  function resolveOcrSource(imageSource) {
    const value = String(imageSource || '').trim();
    const prefix = 'studyjob-picker:';
    if (!value.startsWith(prefix)) return value;
    const token = value.slice(prefix.length);
    if (!token || token !== rememberedOcrToken || !rememberedOcrDataUrl) {
      throw new Error('picker_image_expired');
    }
    return rememberedOcrDataUrl;
  }

  function hasPrefixedTicket(text) {
    const prepared = String(text || '')
      .normalize('NFKC')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/[|\\]/g, '/')
      .toUpperCase();
    return /(?:[CAD\u0421\u0410\u0414])\s*[-:]?\s*\d{2,5}\s*[\/:\-]\s*\d{2,4}(?!\d)/u.test(prepared);
  }

  function bareTicketToken(text) {
    const prepared = String(text || '')
      .normalize('NFKC')
      .replace(/[|\\]/g, '/')
      .trim();
    return /^\d{3,5}\s*[\/:\-]\s*\d{2,4}$/u.test(prepared);
  }

  function collectBlockWords(blocks) {
    const words = [];
    if (!Array.isArray(blocks)) return words;
    for (const block of blocks) {
      const paragraphs = block && Array.isArray(block.paragraphs) ? block.paragraphs : [];
      for (const paragraph of paragraphs) {
        const lines = paragraph && Array.isArray(paragraph.lines) ? paragraph.lines : [];
        for (const line of lines) {
          const lineWords = line && Array.isArray(line.words) ? line.words : [];
          for (const word of lineWords) words.push(word);
        }
      }
    }
    return words;
  }

  function findBareTicketWord(blocks) {
    const words = collectBlockWords(blocks);
    let maxX = 0;
    let maxY = 0;
    let candidate = null;
    for (const word of words) {
      const bbox = word && word.bbox ? word.bbox : null;
      if (bbox) {
        maxX = Math.max(maxX, Number(bbox.x1 || 0));
        maxY = Math.max(maxY, Number(bbox.y1 || 0));
      }
      if (!candidate && bareTicketToken(word && word.text)) candidate = word;
    }
    if (!candidate || !candidate.bbox) return null;
    return { word: candidate, maxX, maxY };
  }

  function focusedRectangle(ticket) {
    const bbox = ticket.word.bbox;
    const x0 = Number(bbox.x0 || 0);
    const y0 = Number(bbox.y0 || 0);
    const x1 = Number(bbox.x1 || 0);
    const y1 = Number(bbox.y1 || 0);
    const wordWidth = Math.max(12, x1 - x0);
    const wordHeight = Math.max(12, y1 - y0);

    const left = Math.max(0, Math.floor(x0 - wordWidth * 2.8));
    const top = Math.max(0, Math.floor(y0 - wordHeight * 0.9));
    let right = Math.ceil(x1 + wordWidth * 1.2);
    let bottom = Math.ceil(y1 + wordHeight * 0.9);
    if (ticket.maxX > 0) right = Math.min(right, Math.ceil(ticket.maxX));
    if (ticket.maxY > 0) bottom = Math.min(bottom, Math.ceil(ticket.maxY));

    return {
      left,
      top,
      width: Math.max(24, right - left),
      height: Math.max(24, bottom - top),
    };
  }

  async function recognizeTicketFocus(worker, imageSource, data, text) {
    if (hasPrefixedTicket(text)) return '';
    const ticket = findBareTicketWord(data && data.blocks);
    if (!ticket) return '';

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '7',
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: 'CAD\u0421\u0410\u0414NnOo0123456789-/: ',
      });
      const focused = await worker.recognize(
        imageSource,
        { rectangle: focusedRectangle(ticket) },
        { text: true },
      );
      return String(focused && focused.data ? focused.data.text || '' : '').trim();
    } catch (_) {
      return '';
    } finally {
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '11',
          preserve_interword_spaces: '1',
          tessedit_char_whitelist: '',
          user_defined_dpi: '300',
        });
      } catch (_) {}
    }
  }

  async function recognizeInternal(imageSource) {
    let value = '';
    try {
      value = resolveOcrSource(imageSource);
    } catch (_) {
      return JSON.stringify({
        available: false,
        text: '',
        confidence: null,
        engine: OCR_ENGINE,
        error: 'picker_image_expired',
      });
    }

    if (!value) {
      return JSON.stringify({
        available: false,
        text: '',
        confidence: null,
        engine: OCR_ENGINE,
        error: 'empty_image_url',
      });
    }

    try {
      const worker = await getWorker();
      const result = await worker.recognize(
        value,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      const data = result && result.data ? result.data : {};
      let text = String(data.text || '').trim();
      const focusedText = await recognizeTicketFocus(worker, value, data, text);
      if (focusedText && !text.includes(focusedText)) {
        text = `${text}\n${focusedText}`.trim();
      }
      const confidenceRaw = Number(data.confidence);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
        : null;
      return JSON.stringify({
        available: text.length > 0,
        text,
        confidence,
        engine: OCR_ENGINE,
        error: text.length > 0 ? null : 'empty_ocr_text',
      });
    } catch (_) {
      return JSON.stringify({
        available: false,
        text: '',
        confidence: null,
        engine: OCR_ENGINE,
        error: 'web_ocr_failed',
      });
    }
  }

  function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + chunkSize, bytes.length),
      );
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function readFileAsDataUrl(file, mime) {
    let buffer;
    if (file && typeof file.arrayBuffer === 'function') {
      buffer = await file.arrayBuffer();
    } else if (typeof Response === 'function') {
      buffer = await new Response(file).arrayBuffer();
    } else {
      throw new Error('array_buffer_unavailable');
    }

    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) throw new Error('empty_file');
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  async function decodeImageFile(file) {
    if (typeof globalThis.createImageBitmap === 'function') {
      try {
        const bitmap = await globalThis.createImageBitmap(file, {
          imageOrientation: 'from-image',
        });
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          dispose() {
            try { bitmap.close(); } catch (_) {}
          },
        };
      } catch (_) {
        try {
          const bitmap = await globalThis.createImageBitmap(file);
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            dispose() {
              try { bitmap.close(); } catch (_) {}
            },
          };
        } catch (_) {}
      }
    }

    if (!globalThis.URL || typeof globalThis.URL.createObjectURL !== 'function') {
      throw new Error('image_decode_unavailable');
    }

    const url = globalThis.URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('image_decode_failed'));
        image.src = url;
      });
      return {
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        dispose() {
          try { globalThis.URL.revokeObjectURL(url); } catch (_) {}
        },
      };
    } catch (error) {
      try { globalThis.URL.revokeObjectURL(url); } catch (_) {}
      throw error;
    }
  }

  function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    context.imageSmoothingEnabled = true;
    try { context.imageSmoothingQuality = 'high'; } catch (_) {}
    return { canvas, context };
  }

  function canvasDataUrl(canvas, quality) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (!String(dataUrl || '').startsWith('data:image/jpeg;base64,')) {
      throw new Error('canvas_encode_failed');
    }
    return dataUrl;
  }

  async function preparePickedImage(file, mime) {
    let decoded = null;
    try {
      decoded = await decodeImageFile(file);
      const width = Number(decoded.width || 0);
      const height = Number(decoded.height || 0);
      if (width < 16 || height < 16) throw new Error('image_dimensions_invalid');

      const uploadMaxDimension = 2560;
      const uploadScale = Math.min(1, uploadMaxDimension / Math.max(width, height));
      const uploadWidth = Math.max(1, Math.round(width * uploadScale));
      const uploadHeight = Math.max(1, Math.round(height * uploadScale));
      const upload = createCanvas(uploadWidth, uploadHeight);
      upload.context.fillStyle = '#ffffff';
      upload.context.fillRect(0, 0, uploadWidth, uploadHeight);
      upload.context.drawImage(decoded.source, 0, 0, uploadWidth, uploadHeight);
      const uploadDataUrl = canvasDataUrl(upload.canvas, 0.88);

      const ocrMaxDimension = 1800;
      const ocrScale = Math.min(1, ocrMaxDimension / Math.max(width, height));
      const ocrWidth = Math.max(1, Math.round(width * ocrScale));
      const ocrHeight = Math.max(1, Math.round(height * ocrScale));
      const ocr = createCanvas(ocrWidth, ocrHeight);
      ocr.context.fillStyle = '#ffffff';
      ocr.context.fillRect(0, 0, ocrWidth, ocrHeight);
      ocr.context.drawImage(decoded.source, 0, 0, ocrWidth, ocrHeight);
      const ocrDataUrl = canvasDataUrl(ocr.canvas, 0.9);

      return {
        uploadDataUrl,
        ocrDataUrl,
        mime: 'image/jpeg',
      };
    } catch (_) {
      const dataUrl = await readFileAsDataUrl(file, mime);
      return {
        uploadDataUrl: dataUrl,
        ocrDataUrl: dataUrl,
        mime,
      };
    } finally {
      if (decoded) decoded.dispose();
    }
  }

  function pickImageInternal(source) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.style.position = 'fixed';
      input.style.left = '-10000px';
      input.style.top = '-10000px';
      if (String(source || '') === 'camera') {
        input.setAttribute('capture', 'environment');
      }

      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        try { input.remove(); } catch (_) {}
        resolve(JSON.stringify(payload));
      };

      input.addEventListener('change', () => {
        const file = input.files && input.files.length > 0 ? input.files[0] : null;
        if (!file) {
          finish({ cancelled: true });
          return;
        }

        const mime = String(file.type || '').toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
          finish({ cancelled: false, error: 'unsupported_image' });
          return;
        }

        void (async () => {
          try {
            const prepared = await preparePickedImage(file, mime);
            const token = rememberOcrDataUrl(prepared.ocrDataUrl);
            finish({
              cancelled: false,
              data_url: prepared.uploadDataUrl,
              mime: prepared.mime,
              name: String(file.name || 'verification-image'),
              size: Number(file.size || 0),
              ocr_token: token,
            });
          } catch (error) {
            const detail = String(
              error && error.message ? error.message : error || 'unknown',
            );
            finish({
              cancelled: false,
              error: `file_prepare_failed:${detail}`,
            });
          }
        })();
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  globalThis.StudyJobOcr = {
    warmup() {
      return warmupInternal();
    },
    recognize(imageSource) {
      queue = queue.catch(() => {}).then(() => recognizeInternal(imageSource));
      return queue;
    },
    pickImage(source) {
      return pickImageInternal(source);
    },
  };
})();
