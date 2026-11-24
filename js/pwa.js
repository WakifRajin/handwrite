// PWA glue: service worker registration, update/offline toasts, install button.
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

let deferredPrompt = null;
const installBtn = () => document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = installBtn();
  if (b) b.hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const b = installBtn();
  if (b) b.hidden = true;
});

function wireInstallButton() {
  const b = installBtn();
  if (!b) return;
  b.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    const p = deferredPrompt;
    deferredPrompt = null;
    b.hidden = true;
    p.prompt();
    try { await p.userChoice; } catch (_) {}
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireInstallButton);
else wireInstallButton();

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let notified = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !notified) {
      notified = true;
      toast('update installed, reload to use it');
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w || hadController) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') toast('ready to work offline');
        });
      });
    }).catch(() => {});
  });
}
