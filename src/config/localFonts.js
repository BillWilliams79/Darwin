// localFonts.js — Roboto bundled into the build (req #4076).
// Imported only when the product's font source is `local` (the internal build),
// so the four weights darwin.one loads from Google Fonts come from
// @fontsource/roboto's files, emitted by Vite into the build output.
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
