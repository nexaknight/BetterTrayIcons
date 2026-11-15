// components/page.js and components/modal.js import every page and dialog
// they draw, so the pages, the dialogs and the code below them call the two
// through this object. prefs.js fills it before anything renders.
export const views = {};
