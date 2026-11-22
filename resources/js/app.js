import './sharing.js';

// PAGE LOADER
(() => {
    const loader = document.getElementById('page-loader');
    if (!loader) return;

    const dismiss = () => {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 500);
    };

    // ponytail: cap 6s so a stalled asset never locks the page.
    const cap = setTimeout(dismiss, 6000);

    (document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }))
    ).then(() => setTimeout(() => {
        clearTimeout(cap);
        dismiss();
    }, 1500));
})();
