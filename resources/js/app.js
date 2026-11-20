import './sharing.js';
// PAGE LOADER
document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('page-loader');

    if (!loader) return;

    const alreadyVisited = sessionStorage.getItem('ruang_visited');

    if (alreadyVisited) {
        loader.remove();
        return;
    }

    sessionStorage.setItem('ruang_visited', 'true');

    window.addEventListener('load', () => {
        setTimeout(() => {
            loader.classList.add('hidden');

            setTimeout(() => {
                loader.remove();
            }, 500);
        }, 700);
    });
});
