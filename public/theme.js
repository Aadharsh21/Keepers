// Apply a saved theme before first paint so the page never flashes the wrong colors.
try {
  var t = JSON.parse(localStorage.getItem('keeper.prefs') || '{}').theme
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch (e) {}
