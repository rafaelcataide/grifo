// Câmera do próprio Grifo para fotografar grifos: usa a resolução máxima do sensor (a câmera aberta
// pelo navegador às vezes entrega a foto pequena), mostra uma moldura para enquadrar a página e
// tira a foto sozinha quando a imagem fica firme e nítida. Também tem botão manual e lanterna.

export const cameraAvailable = () => !!navigator.mediaDevices?.getUserMedia;

// Quanto a imagem mudou entre dois quadros (0 = parada) e quão nítida ela está (bordas fortes)
function frameStats(ctx, w, h, prev) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let diff = 0, edge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (prev) diff += Math.abs(gray[k] - prev[k]);
      const lap = 4 * gray[k] - gray[k - 1] - gray[k + 1] - gray[k - w] - gray[k + w];
      edge += lap * lap;
    }
  }
  const n = (w - 2) * (h - 2);
  return { gray, motion: prev ? diff / n : Infinity, sharp: edge / n };
}

/**
 * Abre a câmera em tela cheia e devolve a foto (Blob JPEG) ou null se a pessoa fechar.
 * Lança erro se a câmera não puder ser usada (sem permissão, sem câmera): quem chama usa a câmera do sistema.
 */
export async function capturePage({ texts = {} } = {}) {
  const t = { hint: 'Enquadre a página e segure firme', steady: 'Segure firme…', auto: 'Foto automática', close: 'Fechar', torch: 'Lanterna', shot: 'Tirar foto', ...texts };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
  });
  const track = stream.getVideoTracks()[0];
  // <dialog> em tela cheia: fica por cima até da janela da nota (as duas ficam na camada do topo)
  const ui = document.createElement('dialog');
  ui.className = 'cam';
  ui.innerHTML = `<video playsinline muted autoplay></video>
    <div class="cam-frame"><i></i><i></i><i></i><i></i></div>
    <div class="cam-top"><button type="button" class="cam-btn" data-cam="close" aria-label="${t.close}">✕</button>
      <span class="cam-hint" aria-live="polite">${t.hint}</span>
      <button type="button" class="cam-btn" data-cam="torch" aria-label="${t.torch}" hidden>🔦</button></div>
    <div class="cam-bottom"><label class="cam-auto"><input type="checkbox" checked> ${t.auto}</label>
      <button type="button" class="cam-shutter" data-cam="shot" aria-label="${t.shot}"><span></span></button><span class="cam-res"></span></div>`;
  document.body.append(ui);
  ui.showModal();
  const video = ui.querySelector('video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  const hint = ui.querySelector('.cam-hint');
  const auto = ui.querySelector('.cam-auto input');
  // a escolha da foto automática fica guardada no aparelho
  try { auto.checked = localStorage.getItem('grifo.camAuto') !== '0'; } catch { /* sem armazenamento */ }
  auto.onchange = () => { try { localStorage.setItem('grifo.camAuto', auto.checked ? '1' : '0'); } catch { /* sem armazenamento */ } };
  const shutter = ui.querySelector('.cam-shutter');
  const caps = track.getCapabilities?.() || {};
  let torchOn = false;
  if (caps.torch) ui.querySelector('[data-cam=torch]').hidden = false;
  const s = track.getSettings?.() || {};
  ui.querySelector('.cam-res').textContent = s.width ? `${s.width}×${s.height}` : '';

  // foto na resolução máxima: ImageCapture (Android) ou o quadro do vídeo.
  // Algumas câmeras demoram ou travam no takePhoto: depois de 5 s, vale o quadro do vídeo.
  const limit = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('demorou')), ms))]);
  async function take() {
    try {
      if ('ImageCapture' in window) {
        const ic = new window.ImageCapture(track);
        const pc = await limit(ic.getPhotoCapabilities(), 2000).catch(() => null);
        const opts = pc?.imageWidth?.max ? { imageWidth: pc.imageWidth.max, imageHeight: pc.imageHeight?.max } : {};
        if (torchOn) opts.fillLightMode = 'flash';
        return await limit(ic.takePhoto(opts).catch(() => ic.takePhoto()), 5000);
      }
    } catch { /* cai no quadro do vídeo */ }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.95));
  }

  return new Promise((resolve) => {
    let done = false, timer = 0, prev = null, steadySince = 0, sharpMax = 0;
    const probe = document.createElement('canvas');
    probe.width = 96; probe.height = 72;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    const finish = async (shoot) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      let blob = null;
      if (shoot) {
        ui.classList.add('flash');
        shutter.disabled = true;
        blob = await take();
      }
      track.stop();
      ui.close();
      ui.remove();
      resolve(blob);
    };
    // "firme": pouco movimento por ~0,8 s e nitidez perto da melhor vista até agora
    timer = setInterval(() => {
      if (done || !video.videoWidth) return;
      pctx.drawImage(video, 0, 0, probe.width, probe.height);
      const st = frameStats(pctx, probe.width, probe.height, prev);
      prev = st.gray;
      sharpMax = Math.max(sharpMax * 0.995, st.sharp);
      const steady = st.motion < 4 && st.sharp > sharpMax * 0.7 && st.sharp > 40;
      const now = performance.now();
      if (!steady) { steadySince = 0; ui.classList.remove('steady'); hint.textContent = t.hint; return; }
      if (!steadySince) steadySince = now;
      ui.classList.add('steady');
      hint.textContent = t.steady;
      if (auto.checked && now - steadySince > 800) finish(true);
    }, 120);
    ui.onclick = async (e) => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      if (b.dataset.cam === 'close') finish(false);
      else if (b.dataset.cam === 'shot') finish(true);
      else if (b.dataset.cam === 'torch') {
        torchOn = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
        b.classList.toggle('on', torchOn);
      }
    };
    // voltar do Android / Esc fecha a câmera
    ui.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    ui.dataset.ready = '1'; // botões prontos (os testes esperam por isto)
  });
}
