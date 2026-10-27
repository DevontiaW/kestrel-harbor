// Scripted ~96-second tour for the screen recording (?tour, or ?tour&capture for frame-exact rendering).
// A visible cursor performs every action so viewers can see what was clicked or hovered.
export function startTour(api) {
  const { el, host } = api;
  const cursor = el('cursor'), caption = el('caption'), ripple = cursor.querySelector('.ripple');
  let t = 0, i = 0, glide = null, cx = host.clientWidth * .55, cy = host.clientHeight * .7, clickT = -1, endAt = Infinity;
  cursor.hidden = false;

  const box = () => host.getBoundingClientRect();
  const ofEl = elOrId => { const r = (typeof elOrId === 'string' ? el(elOrId) : elOrId).getBoundingClientRect(), b = box(); return [r.left - b.left + r.width / 2, r.top - b.top + r.height / 2]; };
  const ofTab = name => ofEl(document.querySelector(`[data-district="${name}"]`));
  const ofVehicle = id => { const p = api.vehicle(id); return api.worldToScreen(p.x, 1.2, p.z); };
  const go = (target, dur = .9) => { glide = { from: [cx, cy], target, t: 0, dur }; };
  const click = fn => { clickT = 0; fn(); };
  const say = text => { caption.hidden = !text; if (text) caption.textContent = text; };
  const district = name => { document.querySelectorAll('[data-district]').forEach(x => x.classList.toggle('on', x.dataset.district === name)); const [tgt, z] = api.DISTRICTS[name]; api.flyTo(tgt, z, 1.6); };
  const truckToFollow = () => { const ts = api.model.trucks; const t = ts.find(x => x.phase === 'inbound') || ts.find(x => x.phase === 'unloading') || ts.find(x => x.phase === 'outbound'); return t ? t.id : null; };
  const cycleTimes = () => { const run = r => { const d = new api.model.constructor(); d.setReviewers(r); d.advance(480); return Math.round(d.floor.metrics().avgCycle); }; return [run(1), run(2)]; };
  let truck = 'truck-a';

  // Warm start at 12:10. One reviewer has built a backlog by now; a second reviewer is holding it steady when the tour opens.
  api.model.advance(250); api.setReviewers(2); api.setSpeed(6); api.setRunning(true); api.zoomTo(.58);
  const view = (x, z, zoom, d = 1.6) => { const v = api.DISTRICTS.all[0].clone(); v.set(x, 0, z); api.flyTo(v, zoom, d); };

  let waitClear = false, waitBlock = false, hero = false;
  // v3: callout tags off for the whole tour (labels stay sparse); three large hero labels name the spill chain.
  el('label-mode').value = 'off';
  const heroTags = ['rack', 'pad', 'road'].map(k => { const d = document.createElement('div'); d.className = 'hero-tag'; d.dataset.k = k; d.hidden = true; host.append(d); return d; });
  const placeHero = () => {
    const m = api.model, q = m.floor.metrics().stations.find(s => s.id === 'review').queued, A = api.AGENTS, P = api.P;
    const held = m.trucks.find(t => t.phase === 'inbound'), anchors = {
      rack: [A.x + A.w / 2 + .6, 1.4, A.z + 2.6, `Rack ${Math.min(q, P.rack)}/${P.rack}`, true, 'right'],
      pad: [A.x - 2.5, 2.4, A.z + A.d / 2 + 1.3, `Pad ${Math.max(0, Math.min(q - P.rack, P.pad))}/${P.pad}`, q > P.rack, 'above'],
      road: held ? [api.vehicle(held.id).x + 3.2, 1.4, api.vehicle(held.id).z + .6, 'Street closed · truck held', m.blocked, 'right'] : [0, 0, 0, '', false] };
    const shift = { right: 'translate(0, -50%)', above: 'translate(-50%, -100%)', below: 'translate(-50%, 0)' };
    for (const d of heroTags) { const [x, y, z, text, show, side] = anchors[d.dataset.k]; d.hidden = !hero || !show; if (d.hidden) continue; const [sx, sy] = api.worldToScreen(x, y, z); d.textContent = text; d.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) ${shift[side]}`; d.classList.toggle('alert', d.dataset.k === 'road'); }
    document.body.classList.toggle('hero-beat', hero);
  };
  const hover = id => api.hover(id, cx, cy);
  const ofWorld = (x, z, y = 2) => () => api.worldToScreen(x, y, z);
  const beats = [
    [0.0, () => { api.orbit(-30, .001); el('title-card').hidden = false; say('Can I make a town you can inspect?'); }],
    [0.05, () => { api.orbit(30, 3.8); api.flyTo(api.DISTRICTS.all[0], .66, 3.6); }],
    [3.6, () => { say('The scene is only the invitation. The questions give it structure.'); go(() => ofTab('farm')); }],
    [4.6, () => click(() => district('farm'))],
    [5.8, () => go(() => ofVehicle('tractor'), .8)],
    [6.6, () => click(() => { api.select('tractor'); say('This tractor follows model rules, not live equipment data.'); })],
    [9.2, () => go(() => ofVehicle('graintruck'), .8)],
    [10.0, () => click(() => { api.select('graintruck'); api.follow(true); say('I can follow a vehicle through the process.'); })],
    [12.2, () => click(() => { api.select(null); district('harbor'); view(28, 56, 1.8, 1.8); say('The harbor is one stop in a larger network of work.'); })],
    [16.3, () => { view(28, 52, 2.2, .9); go(ofWorld(26.5, 50.4, 2.2), .8); }],
    [17.3, () => { api.hover('fishhouse', Math.min(cx + 240, host.clientWidth - 340), Math.max(80, cy - 160)); say('Hover over an object to inspect the model’s current detail.'); }],
    [19.4, () => { hover(null); say('Then follow the road from the harbor to the bike plant.'); go(() => ofTab('plant')); }],
    [20.2, () => click(() => district('plant'))],
    [21.6, () => { truck = truckToFollow(); if (truck) go(() => ofVehicle(truck), .7); }],
    [22.4, () => { if (truck) click(() => api.select(truck)); }],
    [24.2, () => { api.select('plant'); say('A model gets useful when its assumptions can be changed.'); go(() => ofEl(document.querySelector('[data-stations="1:2"]')), .9); }],
    [25.1, () => click(() => { api.setStations(1, 2); say('Add one booth. The modeled constraint moves.'); })],
    [27.0, () => { api.setStations(1, 1); api.select(null); district('all'); api.orbit(12, 4); say('Trace connections. A ring is not an outage prediction.'); go(() => ofEl('svc-power'), 1.1); }],
    [28.2, () => api.setXray('power')],
    [30.0, () => { api.setXray(null); go(() => ofEl('svc-internet'), .5); }],
    [30.6, () => api.setXray('internet')],
    [32.4, () => click(() => { api.setXray(null); api.setService('internet', false); say('One example: remote calls wait when this modeled link is down.'); })],
    [33.8, () => { say('The local work in this model keeps moving.'); district('farm'); }],
    [36.4, () => { say('The rule lives in the model. The animation helps us see it.'); district('agents'); api.select('agents'); }],
    [39.4, () => { district('all'); api.select(null); api.orbit(-12, 3); go(() => ofEl('svc-internet'), 1.1); }],
    [40.8, () => click(() => { api.setService('internet', true); say('Restore the modeled link and buffered reports resume.'); })],
    [43.0, () => { view(64, 17, 3.0); say('These office agents are simulated. Coding agents helped build the town.'); go(ofWorld(56.5, 23.5, 1), 1.2); }],
    [44.4, () => hover('agents')],
    [47.0, () => { hover(null); go(() => ofEl(document.querySelector('[data-rev="1"]')), .9); }],
    [47.9, () => click(() => { api.setReviewers(1); api.setSpeed(20); view(66.5, 20.5, 2.9); say('Change one input: the number of reviewers.'); })],
    [51.4, () => say('Watch the review queue respond to the rule.')],
    [53.0, () => say('Then compare the same modeled shift with another choice.')],
    [59.6, () => { const [x, y] = cycleTimes(); el('stage-compare').textContent = `one shift · 1 reviewer ${x} min · 2 reviewers ${y} min per task`; go(() => ofEl(document.querySelector('[data-rev="3"]')), .9); }],
    [60.4, () => click(() => { api.setReviewers(3); api.setSpeed(20); say('The picture follows a change to modeled capacity.'); })],
    [65.4, () => { api.setReviewers(2); api.setStations(1, 1); api.setSpeed(6); district('plant'); api.select('plant'); say('I can change a station input and inspect what moves next.'); go(() => ofEl(document.querySelector('[data-stations="1:2"]')), .9); }],
    [67.0, () => click(() => { api.setStations(1, 2); say('The model updates when I change this input.'); })],
    [68.4, () => { api.select(null); view(-30, 16, 3.0); say('This clinic models one admin desk. The rest is outside its boundary.'); go(ofWorld(-29, 16, 3), 1.2); }],
    [69.8, () => hover('clinic')],
    [71.6, () => { hover(null); district('utilities'); api.select('waterTower'); say('Storage has its own rule, and its inputs are illustrative.'); go(ofWorld(api.S.waterTower.x, api.S.waterTower.z, 6), 1.1); }],
    [73.2, () => click(() => { api.select('waterTower'); say('Inspectable, yes. A validated infrastructure plan, no.'); })],
    [76.8, () => { district('utilities'); api.select('waterTower'); }],
    [80.0, () => { api.select(null); district('all'); api.orbit(40, 7); say('Motion makes the scene legible. It is not measured work.'); }],
    [82.6, () => go(ofWorld(11, 14.5, 4), .8)],
    [83.4, () => hover('plant')],
    [84.8, () => go(ofWorld(9, -20, 8), .8)],
    [85.6, () => hover('coop')],
    [87.0, () => { hover(null); say('What process would you want to make inspectable?'); api.orbit(40, 7); }],
    [91.4, () => { el('endcard').hidden = false; el('endcard').style.opacity = '0'; endAt = t; caption.hidden = true; }],
  ];
  return {
    duration: 96,
    update(dt) {
      t += dt;
      while (i < beats.length && beats[i][0] <= t) beats[i++][1]();
      placeHero();
      if (waitBlock && api.model.blocked) { waitBlock = false; say('Review backlog holds the supply trucks.'); }
      if (waitClear && !api.model.blocked) { waitClear = false; say('...and the street clears.'); }
      if (glide) { glide.t += dt; const k = Math.min(1, glide.t / glide.dur), e = 1 - (1 - k) ** 3; const [tx, ty] = glide.target(); cx = glide.from[0] + (tx - glide.from[0]) * e; cy = glide.from[1] + (ty - glide.from[1]) * e; if (k >= 1) glide = null; }
      cursor.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      if (clickT >= 0) { clickT += dt; const k = clickT / .45; ripple.style.opacity = String(Math.max(0, 1 - k)); ripple.style.transform = `scale(${.4 + k * 1.2})`; if (k >= 1) clickT = -1; }
      const tc = el('title-card'); if (!tc.hidden) { const o = t < 2.6 ? 1 : Math.max(0, 1 - (t - 2.6) / .6); tc.style.opacity = String(o); if (o <= 0) tc.hidden = true; }
      if (t > endAt) { const k = Math.min(1, (t - endAt) / 1.2); el('endcard').style.opacity = String(k); cursor.style.opacity = String(1 - k); }
    },
  };
}
