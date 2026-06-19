/* Tailwind Play CDN configuration — mirrors tailwind.config.js so the app
   renders identically whether using the CDN (dev) or the built stylesheet. */
if (window.tailwind) {
  window.tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          brand: { 50:'#ecfdf5',100:'#d1fae5',200:'#a7f3d0',300:'#6ee7b7',400:'#34d399',500:'#10b981',600:'#059669',700:'#047857',800:'#065f46',900:'#064e3b' },
          accent: { 400:'#a78bfa',500:'#8b5cf6',600:'#7c3aed' },
          ink: { 900:'#05060a',800:'#0a0c14',700:'#10131f',600:'#171b2b',500:'#1f2438' },
        },
        fontFamily: {
          sans: ['Inter','ui-sans-serif','system-ui','sans-serif'],
          display: ['Orbitron','Inter','sans-serif'],
          mono: ['"JetBrains Mono"','ui-monospace','monospace'],
        },
      },
    },
  };
}
