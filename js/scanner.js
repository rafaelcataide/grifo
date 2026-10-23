// Leitura do código de barras (EAN-13 / ISBN) pela câmera ou por uma foto.
// Usa o leitor nativo do navegador (Chrome no Android) e, se não houver, o ZXing em WebAssembly.

const PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/+esm';
const FORMATS = ['ean_13', 'ean_8', 'upc_a'];
let detectorPromise;

function getDetector() {
  detectorPromise ||= (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported.includes('ean_13')) return new window.BarcodeDetector({ formats: FORMATS });
      } catch { /* cai no ZXing */ }
    }
    const { BarcodeDetector } = await import(PONYFILL);
    return new BarcodeDetector({ formats: FORMATS });
  })().catch((e) => { detectorPromise = null; throw e; });
  return detectorPromise;
}

// ISBN-13 válido (978/979 + dígito verificador)
export function toIsbn(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!/^97[89]\d{10}$/.test(d)) return null;
  const sum = [...d.slice(0, 12)].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(d[12]) ? d : null;
}

async function detectIsbn(source) {
  const detector = await getDetector();
  const codes = await detector.detect(source);
  for (const c of codes) {
    const isbn = toIsbn(c.rawValue);
    if (isbn) return isbn;
  }
  return null;
}

export async function scanImage(file) {
  const bmp = await createImageBitmap(file);
  return detectIsbn(bmp);
}

export const cameraAvailable = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

// Liga a câmera traseira no <video> e chama onIsbn quando achar um ISBN. Devolve a função de parar.
export async function startCamera(video, onIsbn) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  await getDetector();
  let running = true;
  const stop = () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const loop = async () => {
    if (!running) return;
    if (!video.isConnected) { stop(); return; }
    try {
      const isbn = video.readyState >= 2 ? await detectIsbn(video) : null;
      if (isbn && running) {
        if (navigator.vibrate) navigator.vibrate(80);
        stop();
        onIsbn(isbn);
        return;
      }
    } catch { /* quadro ruim: tenta o próximo */ }
    setTimeout(loop, 250);
  };
  loop();
  return stop;
}
