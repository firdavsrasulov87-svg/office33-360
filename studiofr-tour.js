/* Studio FR — 360° tour navigation layer on top of Marzipano.
   Hotspots at real door openings, persistent room menu, clickable mini-map with the current
   room and view cone, smooth transitions that keep the walking direction, zoom, fullscreen.
   All panoramas share one camera orientation (forward = scene −X, right = +Y), so a yaw value
   means the same world heading in every room. */
(function (global) {
  'use strict';

  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 19 12l-1.4 1.4-4.6-4.9V20h-2V8.5L6.4 13.4 5 12z"/></svg>';
  var DEG = Math.PI / 180;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function maxTextureSize() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
    } catch (e) { return 4096; }
  }

  function buildSource(Mz, s, base) {
    if (s.cube) { // Marzipano Tool export: multires cube tiles
      var url = base + s.cube.path + '/{z}/{f}/{y}/{x}.jpg';
      return {
        source: Mz.ImageUrlSource.fromString(url, { cubeMapPreviewUrl: base + s.cube.path + '/preview.jpg' }),
        geometry: new Mz.CubeGeometry(s.cube.levels)
      };
    }
    var maxTex = maxTextureSize();
    var lv = s.equirect.filter(function (l) { return l.width <= maxTex; });
    if (!lv.length) lv = [s.equirect[0]];
    var urls = lv.map(function (l) { return base + l.url; });
    return {
      source: new Mz.ImageUrlSource(function (tile) { return { url: urls[tile.z] }; }),
      geometry: new Mz.EquirectGeometry(lv.map(function (l) { return { width: l.width }; }))
    };
  }

  function mount(root, cfg) {
    var Mz = global.Marzipano;
    var base = cfg.base || '';
    root.classList.add('sfr-tour');
    root.innerHTML = '';

    var pano = el('div', 'sfr-pano');
    var ui = el('div', 'sfr-ui');
    root.appendChild(pano);
    root.appendChild(ui);

    var viewer = new Mz.Viewer(pano, { controls: { mouseViewMode: 'drag' }, stage: { progressive: true } });
    var limiter = Mz.RectilinearView.limit.traditional(cfg.maxResolution || 2048, 100 * DEG, 120 * DEG);

    var byId = {};
    cfg.scenes.forEach(function (s) {
      var g = buildSource(Mz, s, base);
      var view = new Mz.RectilinearView({ yaw: s.initial.yaw * DEG, pitch: s.initial.pitch * DEG, fov: (s.initial.fov || 90) * DEG }, limiter);
      var scene = viewer.createScene({ source: g.source, geometry: g.geometry, view: view, pinFirstLevel: true });
      s._scene = scene;
      s._view = view;
      byId[s.id] = s;
    });

    // ---------- hotspots ----------
    cfg.scenes.forEach(function (s) {
      (s.links || []).forEach(function (lk) {
        var target = byId[lk.to];
        var b = el('button', 'sfr-hs');
        b.type = 'button';
        b.setAttribute('aria-label', 'Перейти: ' + target.name);
        b.innerHTML = '<span class="sfr-hs-dot">' + ARROW + '</span><span class="sfr-hs-lbl">' + (lk.label || target.name) + '</span>';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); go(lk.to, lk); });
        b.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
        b.addEventListener('touchstart', function (ev) { ev.stopPropagation(); }, { passive: true });
        s._scene.hotspotContainer().createHotspot(b, { yaw: lk.yaw * DEG, pitch: lk.pitch * DEG });
      });
    });

    // ---------- title ----------
    var title = el('div', 'sfr-title');
    title.innerHTML = '<span class="sfr-kicker">' + (cfg.kicker || '360° тур') + '</span><b></b>';
    ui.appendChild(title);

    // ---------- menu ----------
    var menu = el('nav', 'sfr-menu');
    menu.setAttribute('aria-label', 'Помещения');
    cfg.scenes.forEach(function (s, i) {
      var b = el('button', 'sfr-mi', '<i>' + String(i + 1).padStart(2, '0') + '</i>' + s.name);
      b.type = 'button';
      b.dataset.id = s.id;
      b.addEventListener('click', function () { go(s.id); });
      menu.appendChild(b);
    });
    ui.appendChild(menu);

    // ---------- tools: zoom + fullscreen ----------
    var tools = el('div', 'sfr-tools');
    var zin = el('button', 'sfr-tb', '+'); zin.type = 'button'; zin.setAttribute('aria-label', 'Приблизить');
    var zout = el('button', 'sfr-tb', '−'); zout.type = 'button'; zout.setAttribute('aria-label', 'Отдалить');
    var fs = el('button', 'sfr-tb sfr-fs', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 3v-3h2v5h-5v-2z"/></svg>');
    fs.type = 'button'; fs.setAttribute('aria-label', 'Полноэкранный режим');
    tools.appendChild(zin); tools.appendChild(zout); tools.appendChild(fs);
    ui.appendChild(tools);
    function zoom(f) {
      var v = current._view;
      current._scene.lookTo({ yaw: v.yaw(), pitch: v.pitch(), fov: Math.min(110 * DEG, Math.max(35 * DEG, v.fov() * f)) }, { transitionDuration: 260 });
    }
    zin.addEventListener('click', function () { zoom(0.8); });
    zout.addEventListener('click', function () { zoom(1.25); });

    function isFs() { return document.fullscreenElement === root || document.webkitFullscreenElement === root || root.classList.contains('sfr-pseudo-fs'); }
    fs.addEventListener('click', function () {
      if (isFs()) {
        if (root.classList.contains('sfr-pseudo-fs')) { root.classList.remove('sfr-pseudo-fs'); document.documentElement.classList.remove('sfr-lock'); }
        else if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        var req = root.requestFullscreen || root.webkitRequestFullscreen;
        var p = null;
        try { p = req ? req.call(root) : null; } catch (e) { p = null; }
        var pseudo = function () { root.classList.add('sfr-pseudo-fs'); document.documentElement.classList.add('sfr-lock'); };
        if (!req) pseudo(); else if (p && p.catch) p.catch(pseudo);
      }
      setTimeout(function () { viewer.updateSize(); }, 120);
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (n) {
      document.addEventListener(n, function () { root.classList.toggle('sfr-is-fs', isFs()); setTimeout(function () { viewer.updateSize(); }, 60); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('sfr-pseudo-fs')) fs.click(); });

    // ---------- mini-map ----------
    var map = cfg.map;
    var mapBox = el('div', 'sfr-map');
    var mapBtn = el('button', 'sfr-map-toggle', 'План');
    mapBtn.type = 'button';
    mapBtn.setAttribute('aria-expanded', 'true');
    mapBtn.addEventListener('click', function () {
      var open = mapBox.classList.toggle('sfr-map-closed') === false;
      mapBtn.setAttribute('aria-expanded', String(open));
    });
    var vb = map.viewBox;
    var svg = '<svg class="sfr-map-svg" viewBox="' + vb.join(' ') + '" role="img" aria-label="' + (cfg.mapLabel || 'План') + '">';
    (map.static || []).forEach(function (r) { svg += '<rect class="sfr-m-static" x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>'; });
    cfg.scenes.forEach(function (s) {
      var r = s.mapRect;
      svg += '<g class="sfr-m-room" data-id="' + s.id + '" tabindex="0" role="button" aria-label="' + s.name + '">' +
        '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>' +
        '<text x="' + (r[0] + r[2] / 2) + '" y="' + (r[1] + r[3] / 2) + '">' + (s.mapLabel || s.name) + '</text></g>';
    });
    (map.doors || []).forEach(function (d) { svg += '<line class="sfr-m-door" x1="' + d[0] + '" y1="' + d[1] + '" x2="' + d[2] + '" y2="' + d[3] + '"/>'; });
    svg += '<g class="sfr-m-cam"><path d="M0 0 L90 -63 A110 110 0 0 1 90 63 Z"/><circle r="16"/></g></svg>';
    mapBox.innerHTML = svg;
    mapBox.appendChild(mapBtn);
    ui.appendChild(mapBox);
    var camG = mapBox.querySelector('.sfr-m-cam');
    mapBox.querySelectorAll('.sfr-m-room').forEach(function (g) {
      g.addEventListener('click', function () { go(g.dataset.id); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(g.dataset.id); } });
    });

    function updateCam() {
      if (!current) return;
      var yaw = current._view.yaw();
      // world forward = (-cos yaw, sin yaw); map flips Y (north up)
      // forwardPlusX: камеры смотрят в +X, вправо = −Y (офис 33); иначе вперёд = −X, вправо = +Y (тур 20 мкр)
      var a = cfg.forwardPlusX ? yaw / DEG : Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) / DEG;
      var p = current.map;
      camG.setAttribute('transform', 'translate(' + p[0] + ' ' + p[1] + ') rotate(' + a.toFixed(1) + ')');
    }

    // ---------- navigation ----------
    var current = null;
    var busy = false;
    function setUi(s) {
      title.querySelector('b').textContent = s.name;
      menu.querySelectorAll('.sfr-mi').forEach(function (b) { b.setAttribute('aria-current', b.dataset.id === s.id ? 'true' : 'false'); });
      mapBox.querySelectorAll('.sfr-m-room').forEach(function (g) { g.classList.toggle('on', g.dataset.id === s.id); });
      root.dataset.scene = s.id;
      updateCam();
    }

    function go(id, viaLink) {
      var next = byId[id];
      if (!next || busy || next === current) return;
      busy = true;
      var heading = viaLink ? (viaLink.arrive != null ? viaLink.arrive : viaLink.yaw) : next.initial.yaw;
      var tMs = cfg.transitionMs || 1100;
      var arrived = false;
      var arrive = function () {
        if (arrived) return; // runs once: from the animation callback or the timer fallback
        arrived = true;
        next._view.setParameters({ yaw: heading * DEG, pitch: (viaLink ? 0 : next.initial.pitch) * DEG, fov: (next.initial.fov || 90) * DEG });
        next._scene.switchTo({ transitionDuration: tMs });
        current = next;
        setUi(next);
        setTimeout(function () { busy = false; }, tMs + 50);
      };
      if (viaLink && current) {
        // turn gently toward the door before stepping through it
        var v = current._view;
        var dy = Math.abs(((viaLink.yaw * DEG - v.yaw() + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        var turnMs = Math.round(350 + dy * 260);
        current._scene.lookTo({ yaw: viaLink.yaw * DEG, pitch: viaLink.pitch * 0.5 * DEG, fov: v.fov() * 0.85 }, { transitionDuration: turnMs }, arrive);
        setTimeout(arrive, turnMs + 120);
      } else {
        arrive();
      }
    }

    viewer.addEventListener('viewChange', updateCam);
    var start = byId[cfg.start] || cfg.scenes[0];
    start._scene.switchTo({ transitionDuration: 0 });
    current = start;
    setUi(start);
    if ((root.clientWidth || window.innerWidth) < 560) {
      mapBox.classList.add('sfr-map-closed');
      mapBtn.setAttribute('aria-expanded', 'false');
    }
    return { viewer: viewer, go: go, current: function () { return current && current.id; }, scenes: byId };
  }

  global.StudioFRTour = { mount: mount };
})(window);
