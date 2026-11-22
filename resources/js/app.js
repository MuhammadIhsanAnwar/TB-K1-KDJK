import './sharing.js';

// PAGE LOADER
document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('page-loader');

    if (!loader) return;

    window.addEventListener('load', () => {
        setTimeout(() => {
            loader.classList.add('hidden');

            setTimeout(() => {
                loader.remove();
            }, 500);
        }, 1500);
    });
});
