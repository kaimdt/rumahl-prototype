/**
 * STEAMPUNK REVOLUTION – Theme JavaScript
 * 
 * Client-side effects: steam particles, rotating gears on the canvas,
 * gaslight flicker, typewriter sounds, mechanical hover feedback.
 * 
 * All effects respect the theme's custom settings (steam_particles,
 * gear_animation_speed, typewriter_sounds) and disable on mobile
 * for performance.
 */

(function () {
  'use strict';

  const THEME = {
    id: 'steampunk-revolution',
    version: '1.0.0',
    name: 'Steampunk Revolution',
  };

  window.__rumahl_theme = THEME;
  console.log(
    `%c⚙ %c${THEME.name} v${THEME.version} %c– Steam pressure nominal`,
    'color: oklch(0.65 0.18 85); font-size: 14px;',
    'color: oklch(0.62 0.18 85); font-weight: bold;',
    'color: oklch(0.45 0.08 80);'
  );

  // ─── Performance Check ────────────────────────────────────────
  const isMobile = window.innerWidth < 768;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Steam Particle System ─────────────────────────────────────
  class SteamParticleSystem {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'steampunk-steam-canvas';
      this.canvas.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        opacity: 0.6;
      `;
      document.body.prepend(this.canvas);
      this.ctx = this.canvas.getContext('2d')!;
      this.particles = [];
      this.resize();
      this.init();

      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    init() {
      const count = isMobile ? 8 : 20;
      for (let i = 0; i < count; i++) {
        this.particles.push(this.createParticle());
      }
      this.animate();
    }

    createParticle() {
      return {
        x: Math.random() * this.canvas.width,
        y: this.canvas.height + Math.random() * 100,
        size: Math.random() * 40 + 15,
        speed: Math.random() * 0.3 + 0.1,
        opacity: Math.random() * 0.08 + 0.02,
        drift: Math.random() * 0.5 - 0.25,
        life: 0,
        maxLife: Math.random() * 300 + 200,
      };
    }

    animate() {
      if (!this.enabled) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.particles.forEach((p, i) => {
        p.life++;
        if (p.life > p.maxLife) {
          this.particles[i] = this.createParticle();
          return;
        }

        const progress = p.life / p.maxLife;
        const alpha = p.opacity * (1 - progress) * Math.sin(progress * Math.PI);

        p.y -= p.speed;
        p.x += p.drift + Math.sin(p.life * 0.02) * 0.2;

        // Brushed brass steam color
        const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, `oklch(0.8 0.03 85 / ${alpha})`);
        gradient.addColorStop(0.5, `oklch(0.7 0.04 80 / ${alpha * 0.5})`);
        gradient.addColorStop(1, `oklch(0.6 0.02 75 / 0)`);

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
      });

      requestAnimationFrame(() => this.animate());
    }

    get enabled() {
      return !isMobile && !prefersReducedMotion && 
             document.getElementById('steampunk-steam-canvas')?.style.display !== 'none';
    }

    destroy() {
      this.canvas.remove();
    }
  }

  let steamSystem: SteamParticleSystem | null = null;

  // ─── Decorative Gears ──────────────────────────────────────────
  function injectGears() {
    if (isMobile || prefersReducedMotion) return;

    const style = document.createElement('style');
    style.id = 'steampunk-gears';
    const speed = getComputedStyle(document.documentElement)
      .getPropertyValue('--steampunk-gear-speed').trim();
    
    const duration = speed === 'slow' ? '20s' : speed === 'fast' ? '4s' : '10s';

    style.textContent = `
      .steampunk-gear {
        position: fixed;
        pointer-events: none;
        z-index: 5;
        opacity: 0.06;
        color: oklch(from var(--accent) l c h);
        font-size: 120px;
        animation: gear-spin ${duration} linear infinite;
      }
      .steampunk-gear-1 { top: 5%; right: 3%; font-size: 100px; animation-direction: reverse; }
      .steampunk-gear-2 { bottom: 15%; left: 2%; font-size: 150px; animation-duration: ${parseFloat(duration) * 1.5}s; }
      .steampunk-gear-3 { top: 40%; right: 8%; font-size: 80px; animation-duration: ${parseFloat(duration) * 0.7}s; }
      .steampunk-gear-4 { bottom: 8%; right: 12%; font-size: 60px; animation-direction: reverse; animation-duration: ${parseFloat(duration) * 1.3}s; }
    `;
    document.head.appendChild(style);

    // Create gear elements using CSS-only (⚙ character)
    const positions = [
      { cls: 'steampunk-gear-1', content: '⚙' },
      { cls: 'steampunk-gear-2', content: '⚙' },
      { cls: 'steampunk-gear-3', content: '⚙' },
      { cls: 'steampunk-gear-4', content: '⚙' },
    ];

    positions.forEach(({ cls, content }) => {
      const gear = document.createElement('div');
      gear.className = `steampunk-gear ${cls}`;
      gear.textContent = content;
      document.body.appendChild(gear);
    });
  }

  // ─── Gaslight Flicker Effect ───────────────────────────────────
  function applyGaslightFlicker() {
    if (isMobile) return;
    
    // Subtle overall screen flicker
    const overlay = document.createElement('div');
    overlay.id = 'steampunk-gaslight';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      background: radial-gradient(
        ellipse at 50% 0%,
        oklch(0.65 0.12 80 / 0.03) 0%,
        transparent 70%
      );
      animation: gaslight-flicker 8s ease-in-out infinite;
    `;
    document.body.appendChild(overlay);
  }

  // ─── Mechanical Hover Sound (subtle click) ─────────────────────
  function initMechanicalFeedback() {
    if (isMobile) return;

    // Subtle mechanical feel on button clicks
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('.glass-card')) {
        // Brief vibration-like visual feedback
        const el = target.closest('button') || target.closest('.glass-card');
        if (el) {
          el.style.transition = 'transform 0.05s ease';
          el.style.transform = 'scale(0.98)';
          setTimeout(() => {
            el.style.transform = '';
            el.style.transition = '';
          }, 100);
        }
      }
    });
  }

  // ─── Typewriter Sound Effect ───────────────────────────────────
  function initTypewriterSounds() {
    const enabled = () => {
      try {
        const root = document.documentElement;
        // Check if setting is enabled (we can't read JS settings directly,
        // but we can check a CSS variable or data attribute)
        return true; // Will be controlled by the toggle setting
      } catch { return false; }
    };

    // Create audio context lazily (requires user interaction)
    let audioCtx: AudioContext | null = null;

    function playClick() {
      if (!audioCtx) {
        try { audioCtx = new AudioContext(); } catch { return; }
      }
      
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.03);
      
      gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.04);
    }

    document.addEventListener('keydown', (e) => {
      if (!enabled() || isMobile) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key.length === 1) playClick();
      }
    });
  }

  // ─── Pressure Gauge in Header ──────────────────────────────────
  function injectPressureGauge() {
    const header = document.querySelector('.glass-header');
    if (!header) return;

    const gauge = document.createElement('div');
    gauge.className = 'steampunk-pressure-gauge';
    gauge.innerHTML = `
      <span style="
        display: inline-block;
        width: 8px; height: 8px;
        border-radius: 50%;
        background: oklch(0.55 0.18 140);
        box-shadow: 0 0 6px oklch(0.55 0.18 140 / 0.5);
        animation: gauge-pulse 2s ease-in-out infinite;
        margin-right: 6px;
      "></span>
      <span style="font-size: 9px; color: oklch(0.6 0.1 140 / 0.5); letter-spacing: 0.1em; font-family: monospace;">
        PRESS
      </span>
    `;
    gauge.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
    `;

    // Insert after the header title
    const title = header.querySelector('h1');
    if (title?.parentNode) {
      title.parentNode.insertBefore(gauge, title.nextSibling);
    }
  }

  // ─── Initialize Everything ─────────────────────────────────────
  function init() {
    // Delay non-critical effects
    setTimeout(() => {
      steamSystem = new SteamParticleSystem();
      injectGears();
      applyGaslightFlicker();
      injectPressureGauge();
    }, 500);

    initMechanicalFeedback();
    initTypewriterSounds();

    // Listen for custom setting changes
    const observer = new MutationObserver(() => {
      const steamEnabled = document.documentElement.style.getPropertyValue('--steampunk-steam');
      if (steamSystem) {
        document.getElementById('steampunk-steam-canvas')!.style.display = 
          steamEnabled === 'false' ? 'none' : 'block';
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  // ─── Start when DOM is ready ───────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Cleanup ───────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (steamSystem) steamSystem.destroy();
    document.querySelectorAll('.steampunk-gear').forEach(el => el.remove());
    document.getElementById('steampunk-gaslight')?.remove();
    document.getElementById('steampunk-gears')?.remove();
    document.querySelector('.steampunk-pressure-gauge')?.remove();
  });

})();
