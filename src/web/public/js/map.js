// Sol System Map — canvas renderer
(function () {
  const canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('map-info');

  let bodies = [];
  let scale = 80; // pixels per AU
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };

  const colors = {
    star: '#fbbf24',
    planet: '#3b82f6',
    dwarf_planet: '#8b5cf6',
    moon: '#6b7280',
    asteroid: '#a3a3a3',
    belt_zone: '#525252',
    comet: '#06b6d4',
  };

  const sizes = {
    star: 12,
    planet: 6,
    dwarf_planet: 4,
    moon: 3,
    asteroid: 2,
    belt_zone: 1,
    comet: 2,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    draw();
  }

  function worldToScreen(x, y) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2 + offsetX + dragOffset.x;
    const cy = rect.height / 2 + offsetY + dragOffset.y;
    return {
      sx: cx + x * scale,
      sy: cy + y * scale,
    };
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Draw orbit circles for planets around the sun
    const sun = bodies.find(function (b) { return b.type === 'star'; });
    if (sun) {
      const sunScreen = worldToScreen(sun.position.x, sun.position.y);
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.type !== 'planet' && b.type !== 'dwarf_planet') continue;
        if (b.parentId && b.parentId !== (sun._id || '')) continue;
        var dist = Math.sqrt(
          Math.pow(b.position.x - sun.position.x, 2) +
          Math.pow(b.position.y - sun.position.y, 2)
        );
        if (dist > 0) {
          ctx.beginPath();
          ctx.arc(sunScreen.sx, sunScreen.sy, dist * scale, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(42, 42, 42, 0.6)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Draw bodies
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var pos = worldToScreen(b.position.x, b.position.y);
      var color = colors[b.type] || '#737373';
      var size = sizes[b.type] || 3;

      // Glow for star
      if (b.type === 'star') {
        var gradient = ctx.createRadialGradient(pos.sx, pos.sy, 0, pos.sx, pos.sy, size * 3);
        gradient.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
        gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.beginPath();
        ctx.arc(pos.sx, pos.sy, size * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Body dot
      ctx.beginPath();
      ctx.arc(pos.sx, pos.sy, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Label (only for planets, star, dwarf planets)
      if (b.type === 'star' || b.type === 'planet' || b.type === 'dwarf_planet') {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = '#a3a3a3';
        ctx.textAlign = 'center';
        ctx.fillText(b.name, pos.sx, pos.sy + size + 14);
      }
    }
  }

  async function loadBodies() {
    try {
      var res = await fetch('/api/public/bodies');
      if (res.ok) {
        bodies = await res.json();
        if (info) info.textContent = bodies.length + ' bodies loaded';
        draw();
      }
    } catch (e) {
      if (info) info.textContent = 'Failed to load bodies';
    }
  }

  // Pan
  canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragOffset.x = 0;
    dragOffset.y = 0;
  });
  canvas.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    dragOffset.x = e.clientX - dragStart.x;
    dragOffset.y = e.clientY - dragStart.y;
    draw();
  });
  canvas.addEventListener('mouseup', function () {
    if (dragging) {
      offsetX += dragOffset.x;
      offsetY += dragOffset.y;
      dragOffset.x = 0;
      dragOffset.y = 0;
      dragging = false;
    }
  });
  canvas.addEventListener('mouseleave', function () {
    if (dragging) {
      offsetX += dragOffset.x;
      offsetY += dragOffset.y;
      dragOffset.x = 0;
      dragOffset.y = 0;
      dragging = false;
    }
  });

  // Zoom with wheel
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 0.9 : 1.1;
    scale *= factor;
    scale = Math.max(5, Math.min(2000, scale));
    draw();
  }, { passive: false });

  // Button controls
  document.getElementById('zoom-in').addEventListener('click', function () {
    scale *= 1.3;
    scale = Math.min(2000, scale);
    draw();
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    scale *= 0.7;
    scale = Math.max(5, scale);
    draw();
  });
  document.getElementById('zoom-reset').addEventListener('click', function () {
    scale = 80;
    offsetX = 0;
    offsetY = 0;
    draw();
  });

  // Init
  window.addEventListener('resize', resize);
  resize();
  loadBodies();

  // Refresh every 5s
  setInterval(loadBodies, 5000);
})();
