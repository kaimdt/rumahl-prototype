/**
 * Material Sidebar Theme – Client-side JavaScript
 * 
 * This JS file is loaded by the theme system and runs in the browser.
 * It adds visual effects and interactivity that CSS alone can't achieve.
 * 
 * IMPORTANT: Theme JS runs in the browser only. It cannot access the
 * server or backend APIs. For server-side functionality, use apps/plugins.
 */

(function () {
  'use strict';

  // ─── Theme Metadata ──────────────────────────────────────────
  const THEME = {
    id: 'material-sidebar',
    version: '1.0.0',
    name: 'Material Sidebar',
  };

  // Make theme info available globally
  window.__rumahl_theme = THEME;

  console.log(
    `%c🎨 ${THEME.name} v${THEME.version} %cactive`,
    'color: oklch(0.6 0.22 260); font-weight: bold;',
    'color: oklch(0.5 0.1 260);'
  );

  // ─── Ripple Effect on Click ──────────────────────────────────
  function createRipple(event, element) {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
      border-radius: 50%;
      background: oklch(1 0 0 / 0.12);
      transform: scale(0);
      animation: theme-ripple 0.6s ease-out;
      pointer-events: none;
    `;

    element.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  // Add ripple effect to glass cards and buttons
  document.addEventListener('click', (e) => {
    const target = e.target.closest('.glass-card, button:not([data-nav])');
    if (target && !target.querySelector('[data-no-ripple]')) {
      createRipple(e, target);
    }
  });

  // ─── Add ripple keyframes ────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes theme-ripple {
      to { transform: scale(4); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // ─── Parallax Effect on Widget Cards ─────────────────────────
  let parallaxEnabled = true;

  // Disable parallax on mobile for performance
  if (window.innerWidth < 768) {
    parallaxEnabled = false;
  }

  window.addEventListener('resize', () => {
    parallaxEnabled = window.innerWidth >= 768;
  });

  if (parallaxEnabled) {
    document.addEventListener('mousemove', (e) => {
      const cards = document.querySelectorAll('.glass-card');
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = (e.clientX - centerX) / rect.width;
        const deltaY = (e.clientY - centerY) / rect.height;

        // Subtle tilt effect
        card.style.transform = `perspective(800px) rotateY(${deltaX * 2}deg) rotateX(${-deltaY * 2}deg) translateZ(2px)`;
      });
    });

    // Reset transforms on mouse leave
    document.addEventListener('mouseleave', () => {
      document.querySelectorAll('.glass-card').forEach((card) => {
        card.style.transform = '';
      });
    });
  }

  // ─── Smooth Theme Transitions ────────────────────────────────
  // Observe theme changes and animate smoothly
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-theme'
      ) {
        // Theme changed – any custom transition logic here
        const newTheme = document.documentElement.getAttribute('data-theme');
        console.log(`%c🎨 Theme switched to: ${newTheme}`, 'color: oklch(0.5 0.1 260);');
      }
    });
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-nav-position'],
  });

  // ─── Cleanup on theme removal ────────────────────────────────
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  });

})();
