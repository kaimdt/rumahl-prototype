/**
 * Steampunk Revolution – Interactive Theme Engine
 * Handles gear animations, steam particles, typewriter effects, and vignette.
 */
(function() {
  const THEME_ID = 'steampunk-revolution';
  
  function init() {
    if (document.documentElement.getAttribute('data-theme') !== THEME_ID) return;
    initGearAnimations();
    initSteamParticles();
    initTypewriterEffect();
    initBrassBorders();
    initVignette();
  }

  function initGearAnimations() {
    const speed = getComputedStyle(document.documentElement).getPropertyValue('--steampunk-gear-speed').trim();
    const durations = { slow: '20s', normal: '12s', fast: '6s' };
    document.documentElement.style.setProperty('--gear-duration', durations[speed] || '12s');
    
    document.querySelectorAll('.glass-card').forEach((card, i) => {
      card.style.setProperty('--gear-delay', `${i * 0.5}s`);
    });
  }

  function initSteamParticles() {
    const enabled = document.documentElement.style.getPropertyValue('--steampunk-steam') !== 'none';
    if (!enabled) return;
    
    const container = document.createElement('div');
    container.className = 'steampunk-steam-container';
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden;';
    
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.className = 'steampunk-steam-particle';
      particle.style.cssText = `
        position:absolute;width:${60 + Math.random() * 100}px;height:${30 + Math.random() * 40}px;
        background:radial-gradient(ellipse, oklch(0.55 0.04 85 / 0.06) 0%, transparent 70%);
        left:${Math.random() * 100}%;bottom:-20px;
        animation:steam-rise ${8 + Math.random() * 12}s ease-in-out infinite;
        animation-delay:${Math.random() * 8}s;border-radius:50%;
      `;
      container.appendChild(particle);
    }
    document.body.appendChild(container);
  }

  function initTypewriterEffect() {
    document.querySelectorAll('input[type="text"], textarea').forEach(el => {
      el.addEventListener('keydown', () => {
        el.classList.add('typewriter-active');
        setTimeout(() => el.classList.remove('typewriter-active'), 150);
      });
    });
  }

  function initBrassBorders() {
    const enabled = document.documentElement.style.getPropertyValue('--steampunk-brass-borders') !== '0';
    if (!enabled) return;
    document.querySelectorAll('.glass-card').forEach(card => {
      card.classList.add('brass-border');
    });
  }

  function initVignette() {
    const intensity = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--steampunk-vignette')) || 60;
    document.documentElement.style.setProperty('--vignette-opacity', `${intensity / 100 * 0.4}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on theme change
  const observer = new MutationObserver(() => init());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
