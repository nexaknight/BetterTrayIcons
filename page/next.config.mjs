// GitHub Pages serves files only. trailingSlash writes index.html files so
// every route resolves as a folder, basePath stays empty because the site
// lives at the root of its custom domain, and images skip the optimizer
// that a static export can't run. The repo root has its own lockfile, the
// turbopack root keeps Next from treating the repo as the workspace.
export default {
    output: 'export',
    trailingSlash: true,
    images: {unoptimized: true},
    turbopack: {root: import.meta.dirname},
};
