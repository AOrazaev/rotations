// Cached references to DOM elements shared across the app's other script
// files. Declared once here (not per-file) because these are plain classic
// <script> files - not ES modules - so they all execute in one shared
// global scope, and redeclaring the same `const` name in more than one file
// would throw a SyntaxError. Loaded first, before anything that uses them.
const rosterEl = document.querySelector('#roster');
const playerTemplate = document.querySelector('#playerTemplate');
const rotationCard = document.querySelector('#rotationCard');
const minutesGrid = document.querySelector('#minutesGrid');
const summary = document.querySelector('#rotationSummary');
const timelineGrid = document.querySelector('#timelineGrid');
const seedInput = document.querySelector('#regenerateSeed');
const rosterCompactTab = document.querySelector('#rosterCompactTab');
const rosterEditTab = document.querySelector('#rosterEditTab');
const addPlayerBtn = document.querySelector('#addPlayer');
const swapModeBtn = document.querySelector('#swapMode');
const swapHint = document.querySelector('#swapHint');
const undoSwapBtn = document.querySelector('#undoSwap');
const redoSwapBtn = document.querySelector('#redoSwap');
