/* ─────────────────────────────────────────────────────────────
   REXX ULTRA — FLOATING LAUNCHER + CONTROL UI
   Separate post-DSP layer
   ───────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ---------- FLOATING ICON ---------- */

  function RHUltraFAB() {
    if (document.getElementById('rh-ultra-fab')) return;
    if (!document.body) return;

    const fab = document.createElement('button');
    fab.id = 'rh-ultra-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Rexx Ultra');

    fab.innerHTML = `
      <svg width="23" height="23" viewBox="0 0 24 24"
           fill="none" aria-hidden="true">
        <path
          d="M13.1 2.5L5.7 13h5.1l-.9 8.5L18.3 11h-5.1l-.1-8.5Z"
          fill="currentColor"/>
      </svg>
    `;

    Object.assign(fab.style, {
      position: 'fixed',
      left: '18px',
      bottom: '18px',
      width: '48px',
      height: '48px',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '14px',
      background: 'linear-gradient(145deg,#20242b,#111318)',
      color: '#fff',
      boxShadow: '0 8px 28px rgba(0,0,0,.45)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      padding: '0',
      outline: 'none',
      userSelect: 'none',
      transition: 'transform .12s ease, box-shadow .12s ease'
    });

    fab.onmouseenter = function () {
      fab.style.transform = 'scale(1.07)';
      fab.style.boxShadow = '0 10px 32px rgba(0,0,0,.55)';
    };

    fab.onmouseleave = function () {
      fab.style.transform = 'scale(1)';
      fab.style.boxShadow = '0 8px 28px rgba(0,0,0,.45)';
    };

    fab.onclick = function () {
      const panel = document.getElementById('rh-ultra');
      if (!panel) return;

      const hidden = panel.style.display === 'none';

      panel.style.display = hidden ? 'block' : 'none';

      fab.style.background = hidden
        ? 'linear-gradient(145deg,#7c3aed,#4c1d95)'
        : 'linear-gradient(145deg,#20242b,#111318)';
    };

    document.body.appendChild(fab);
  }


  /* ---------- ULTRA UI ---------- */

  function RHUltraUI() {
    if (document.getElementById('rh-ultra')) return;
    if (!document.body) return;

    const panel = document.createElement('div');
    panel.id = 'rh-ultra';

    panel.innerHTML = `
      <div class="ru-head">
        <div>
          <b>⚡ REXX ULTRA</b>
          <small>POST-DSP</small>
        </div>

        <button id="ru-close" title="Close">×</button>
      </div>

      <div class="ru-sub">
        Independent layer • runs ABOVE existing Loud chain
      </div>

      <div id="ru-status">
        ● POST-DSP • OFF
      </div>

      <div class="ru-grid"></div>

      <button id="ru-reset">
        ↺ Reset Ultra
      </button>
    `;

    const style = document.createElement('style');

    style.textContent = `
      #rh-ultra {
        position: fixed;
        right: 18px;
        bottom: 76px;
        width: 330px;
        max-height: 72vh;
        overflow-y: auto;
        z-index: 2147483646;

        background:
          linear-gradient(
            145deg,
            rgba(15,23,42,.98),
            rgba(7,10,20,.98)
          );

        color: #e5e7eb;
        border: 1px solid rgba(139,92,246,.35);
        border-radius: 16px;
        padding: 13px;

        box-shadow:
          0 20px 60px rgba(0,0,0,.7),
          0 0 35px rgba(124,58,237,.12);

        font-family:
          Inter,
          system-ui,
          -apple-system,
          sans-serif;

        font-size: 12px;

        scrollbar-width: thin;
        scrollbar-color:
          rgba(139,92,246,.35)
          transparent;
      }

      #rh-ultra::-webkit-scrollbar {
        width: 4px;
      }

      #rh-ultra::-webkit-scrollbar-thumb {
        background: rgba(139,92,246,.4);
        border-radius: 5px;
      }

      #rh-ultra .ru-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 2px;
      }

      #rh-ultra .ru-head b {
        color: #fbbf24;
        font-size: 15px;
        letter-spacing: .3px;
      }

      #rh-ultra .ru-head small {
        margin-left: 7px;
        color: #64748b;
        font-size: 8px;
        font-weight: 700;
      }

      #ru-close {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.05);
        color: #94a3b8;
        cursor: pointer;
        font-size: 17px;
      }

      #ru-close:hover {
        background: rgba(255,255,255,.1);
        color: white;
      }

      #rh-ultra .ru-sub {
        color: #64748b;
        font-size: 9px;
        margin-bottom: 8px;
      }

      #ru-status {
        padding: 7px 9px;
        border-radius: 8px;
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.06);
        color: #64748b;
        font-size: 9px;
        font-family: monospace;
        margin-bottom: 9px;
      }

      #ru-status.ru-on {
        color: #22c55e;
        border-color: rgba(34,197,94,.25);
        background: rgba(34,197,94,.06);
      }

      .ru-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      .ru-c {
        padding: 8px;
        border-radius: 9px;
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.06);
      }

      .ru-c:hover {
        border-color: rgba(139,92,246,.25);
      }

      .ru-c label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 7px;
        color: #cbd5e1;
        font-size: 9px;
      }

      .ru-c .ru-v {
        color: #fbbf24;
        font-family: monospace;
        font-size: 9px;
      }

      .ru-c input[type="range"] {
        width: 100%;
        height: 4px;
        appearance: none;
        -webkit-appearance: none;
        background: rgba(255,255,255,.1);
        border-radius: 4px;
        outline: none;
      }

      .ru-c input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fbbf24;
        border: 2px solid #92400e;
        cursor: pointer;
      }

      #ru-reset {
        width: 100%;
        margin-top: 9px;
        padding: 9px;

        border: 1px solid rgba(255,255,255,.08);
        border-radius: 9px;

        background: rgba(255,255,255,.05);
        color: #cbd5e1;

        cursor: pointer;
        font-weight: 600;
      }

      #ru-reset:hover {
        background: rgba(139,92,246,.16);
        border-color: rgba(139,92,246,.3);
      }

      @media (max-width: 600px) {
        #rh-ultra {
          left: 10px;
          right: 10px;
          bottom: 76px;
          width: auto;
          max-height: 70vh;
        }

        #rh-ultra-fab {
          left: 14px !important;
          bottom: 14px !important;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);


    /* ---------- CONTROLS ---------- */

    const defs = [
      ['master',  'Ultra Gain'],
      ['pre',     'Preamp'],
      ['low',     'Low Boost'],
      ['lowcut',  'Low Cut'],
      ['mid',     'Mid Boost'],
      ['pres',    'Presence'],
      ['air',     'Air'],
      ['clarity', 'Clarity'],
      ['warm',    'Warmth'],
      ['sat',     'Saturation'],
      ['soft',    'Soft Clip'],
      ['comp',    'Compressor'],
      ['limit',   'Limiter'],
      ['attack',  'Attack'],
      ['release', 'Release'],
      ['gate',    'Gate'],
      ['stereo',  'Stereo Width'],
      ['balance', 'Balance'],
      ['excite',  'Exciter'],
      ['mix',     'Output Mix']
    ];

    const grid = panel.querySelector('.ru-grid');

    defs.forEach(function (def) {

      const key = def[0];
      const name = def[1];

      const card = document.createElement('div');
      card.className = 'ru-c';

      let defaultValue = 0;

      if (key === 'limit') defaultValue = 100;
      if (key === 'mix') defaultValue = 100;
      if (key === 'balance') defaultValue = 50;
      if (key === 'attack') defaultValue = 50;
      if (key === 'release') defaultValue = 50;

      card.innerHTML = `
        <label>
          <span>${name}</span>
          <span class="ru-v">${defaultValue}%</span>
        </label>

        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value="${defaultValue}"
        >
      `;

      const slider = card.querySelector('input');
      const value = card.querySelector('.ru-v');

      slider.addEventListener('input', function () {

        const v = Number(this.value);

        value.textContent = v + '%';

        if (
          window.CHAIN &&
          CHAIN.ultra &&
          CHAIN.ultra.state
        ) {
          CHAIN.ultra.state[key] = v;
          CHAIN.ultra.update();
        }

        const status =
          panel.querySelector('#ru-status');

        status.textContent =
          '● POST-DSP • ON';

        status.className = 'ru-on';

      });

      grid.appendChild(card);
    });


    /* ---------- CLOSE ---------- */

    panel.querySelector('#ru-close').onclick = function () {

      panel.style.display = 'none';

      const fab =
        document.getElementById('rh-ultra-fab');

      if (fab) {
        fab.style.background =
          'linear-gradient(145deg,#20242b,#111318)';
      }
    };


    /* ---------- RESET ---------- */

    panel.querySelector('#ru-reset').onclick = function () {

      defs.forEach(function (def) {

        const key = def[0];

        let v = 0;

        if (key === 'limit') v = 100;
        if (key === 'mix') v = 100;
        if (key === 'balance') v = 50;
        if (key === 'attack') v = 50;
        if (key === 'release') v = 50;

        const cards =
          Array.from(grid.children);

        const card = cards.find(function (x) {
          const label = x.querySelector('label span');
          return label && label.textContent === def[1];
        });

        if (card) {
          const slider =
            card.querySelector('input');

          const value =
            card.querySelector('.ru-v');

          slider.value = v;
          value.textContent = v + '%';
        }
      });


      if (
        window.CHAIN &&
        CHAIN.ultra
      ) {

        CHAIN.ultra.state = {
          master: 0,
          pre: 0,
          low: 0,
          lowcut: 0,
          mid: 0,
          pres: 0,
          air: 0,
          clarity: 0,
          warm: 0,
          sat: 0,
          soft: 0,
          comp: 0,
          limit: 100,
          attack: 50,
          release: 50,
          gate: 0,
          stereo: 0,
          balance: 50,
          excite: 0,
          mix: 100
        };

        CHAIN.ultra.update();
      }


      const status =
        panel.querySelector('#ru-status');

      status.textContent =
        '● POST-DSP • OFF';

      status.className = '';

    };

  }


  /* ---------- BOOT ---------- */

  function RHUltraBoot() {

    if (!document.body || !document.head) {
      setTimeout(RHUltraBoot, 50);
      return;
    }

    RHUltraFAB();

    setTimeout(function () {

      try {
        RHUltraUI();
      } catch (e) {
        console.warn('[RHUltra] UI error:', e);
      }

      RHUltraFAB();

    }, 350);


    /* Keep FAB alive if Discord rerenders DOM */

    let tries = 0;

    const timer = setInterval(function () {

      RHUltraFAB();

      tries++;

      if (tries > 40) {
        clearInterval(timer);
      }

    }, 250);
  }


  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      RHUltraBoot
    );
  } else {
    RHUltraBoot();
  }

})();
