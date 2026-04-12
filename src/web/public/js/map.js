// Sol System Map — canvas renderer
(function () {
  const canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('map-info');
  const detailPanel = document.getElementById('map-detail');

  let bodies = [];
  let settlements = [];
  let bodiesDetailed = []; // full body data with resources/physical
  let scale = 80; // pixels per AU
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };
  let dragMoved = false;

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

  async function loadSettlements() {
    try {
      var res = await fetch('/api/public/settlements');
      if (res.ok) {
        settlements = await res.json();
      }
    } catch (e) {
      // settlements unavailable — non-critical
    }
  }

  // ── Click-to-show-info panel ──────────────────────────────────────
  function findBodyAtPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    var closest = null;
    var closestDist = Infinity;

    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var pos = worldToScreen(b.position.x, b.position.y);
      var size = sizes[b.type] || 3;
      var hitRadius = size + 10;
      var dx = mx - pos.sx;
      var dy = my - pos.sy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < hitRadius && dist < closestDist) {
        closest = b;
        closestDist = dist;
      }
    }
    return closest;
  }

  function formatNumber(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function showDetailPanel(body) {
    if (!detailPanel) return;

    // Name & type
    document.getElementById('detail-name').textContent = body.name;
    document.getElementById('detail-type').textContent = (body.type || '').replace('_', ' ');

    // Position (distance from Sol)
    var distFromSol = Math.sqrt(
      body.position.x * body.position.x +
      body.position.y * body.position.y +
      (body.position.z || 0) * (body.position.z || 0)
    );
    var posDiv = document.getElementById('detail-position');
    posDiv.innerHTML =
      '<div class="detail-row"><span class="label">Distance from Sol</span><span class="value">' + distFromSol.toFixed(3) + ' AU</span></div>' +
      '<div class="detail-row"><span class="label">X</span><span class="value">' + body.position.x.toFixed(4) + ' AU</span></div>' +
      '<div class="detail-row"><span class="label">Y</span><span class="value">' + body.position.y.toFixed(4) + ' AU</span></div>';
    document.getElementById('detail-position-section').style.display = '';

    // Physical properties (if available)
    var physSection = document.getElementById('detail-physical-section');
    var physDiv = document.getElementById('detail-physical');
    if (body.physical) {
      var p = body.physical;
      var html = '';
      if (p.mass != null) html += '<div class="detail-row"><span class="label">Mass</span><span class="value">' + p.mass.toExponential(2) + ' kg</span></div>';
      if (p.radius != null) html += '<div class="detail-row"><span class="label">Radius</span><span class="value">' + formatNumber(p.radius) + ' km</span></div>';
      if (p.gravity != null) html += '<div class="detail-row"><span class="label">Gravity</span><span class="value">' + p.gravity.toFixed(2) + ' m/s2</span></div>';
      if (p.hasAtmosphere != null) html += '<div class="detail-row"><span class="label">Atmosphere</span><span class="value">' + (p.hasAtmosphere ? 'Yes' : 'No') + '</span></div>';
      physDiv.innerHTML = html;
      physSection.style.display = html ? '' : 'none';
    } else {
      physSection.style.display = 'none';
    }

    // Resources (if available)
    var resSection = document.getElementById('detail-resources-section');
    var resDiv = document.getElementById('detail-resources');
    if (body.resources && body.resources.length > 0) {
      var rhtml = '';
      for (var i = 0; i < body.resources.length; i++) {
        var r = body.resources[i];
        var pct = r.totalDeposit > 0 ? Math.round((r.remaining / r.totalDeposit) * 100) : 0;
        rhtml += '<div class="resource-bar-wrap">' +
          '<div class="resource-bar-label"><span>' + r.resourceType + '</span><span>' + pct + '% remaining</span></div>' +
          '<div class="resource-bar"><div class="resource-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>';
      }
      resDiv.innerHTML = rhtml;
      resSection.style.display = '';
    } else {
      resSection.style.display = 'none';
    }

    // Settlements on this body
    var settSection = document.getElementById('detail-settlements-section');
    var settDiv = document.getElementById('detail-settlements');
    var bodySettlements = settlements.filter(function (s) {
      return s.bodyId === body._id;
    });
    if (bodySettlements.length > 0) {
      var shtml = '';
      for (var j = 0; j < bodySettlements.length; j++) {
        var s = bodySettlements[j];
        var spaceport = (s.economy && s.economy.spaceportLevel) ? ' | Spaceport Lv.' + s.economy.spaceportLevel : '';
        shtml += '<div class="settlement-item">' +
          '<div class="sett-name">' + s.name + '</div>' +
          '<div class="sett-meta">' + s.type.replace('_', ' ') + ' | ' + s.nation + ' | Pop: ' + formatNumber(s.population) + spaceport + '</div>' +
          '<div class="sett-meta">' + s.status + '</div>' +
          '</div>';
      }
      settDiv.innerHTML = shtml;
      settSection.style.display = '';
    } else {
      settDiv.innerHTML = '<div class="no-data">No known settlements</div>';
      settSection.style.display = '';
    }

    detailPanel.classList.add('open');
  }

  function closeDetailPanel() {
    if (detailPanel) detailPanel.classList.remove('open');
  }

  // Close button
  var closeBtn = document.getElementById('panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeDetailPanel);
  }

  // Click handler on canvas
  canvas.addEventListener('click', function (e) {
    // Ignore if the user was dragging
    if (dragMoved) return;
    var body = findBodyAtPoint(e.clientX, e.clientY);
    if (body) {
      showDetailPanel(body);
    } else {
      closeDetailPanel();
    }
  });

  // Pan
  canvas.addEventListener('mousedown', function (e) {
    dragging = true;
    dragMoved = false;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragOffset.x = 0;
    dragOffset.y = 0;
  });
  canvas.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    dragOffset.x = e.clientX - dragStart.x;
    dragOffset.y = e.clientY - dragStart.y;
    if (Math.abs(dragOffset.x) > 3 || Math.abs(dragOffset.y) > 3) {
      dragMoved = true;
    }
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
  loadSettlements();

  // Refresh every 5s
  setInterval(loadBodies, 5000);
  setInterval(loadSettlements, 30000);
})();
