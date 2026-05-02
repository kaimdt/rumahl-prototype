// Steampunk Theme – Runtime JS
// This runs when the theme is applied
(function() {
  console.log('[Steampunk] Theme activated');

  // Add gear spinning animation to loading elements
  document.addEventListener('DOMContentLoaded', function() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes gear-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .steampunk-gear { animation: gear-spin 4s linear infinite; display: inline-block; }
    `;
    document.head.appendChild(style);
  });
})();
