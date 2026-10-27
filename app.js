import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Factory, STAGES, analyze } from './model.mjs';

const $ = id => document.getElementById(id);
const world = $('world');
const palette = { white: 0xf9fbf8, wall: 0xe9eee8, edge: 0x8a988e, dark: 0x485c4e, green: 0x136d59, amber: 0xa35824, queue: 0xe6c5a7, floor: 0xf2f5f0 };
const positions = [[-14, -7], [10, -7], [10, 10], [-14, 10]];
const descriptions = [
  'Each frame takes 45 minutes. Parallel benches can work on separate frames at the same time.',
  'Every frame needs 60 minutes in a booth. A second booth works on a second frame at the same time.',
  'Each wheel-building station handles one bicycle’s wheel set in 30 minutes.',
  'Each assembly station finishes one bicycle in 40 minutes. This becomes the next constraint after adding paint capacity.',
];
const resourceNames = ['Welding benches', 'Paint booths', 'Wheel stations', 'Assembly stations'];
let machines = [2, 1, 2, 1], release = 2, selected = 1;
let factory = new Factory(machines, release).advance(240), running = false, cutaway = true;
let renderer, scene, camera, controls;
const roofs = [], machineGroups = [], queueGroups = [], floors = [], pickables = [], slotMeshes = [], progressMeshes = [];
const edgeMaterial = new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: .68 });
const fills = new Map();
function material(color) {
  if (!fills.has(color)) fills.set(color, new THREE.MeshLambertMaterial({ color }));
  return fills.get(color);
}
function box(parent, x, y, z, w, h, d, color = palette.white, edges = true) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material(color)); mesh.position.set(x, y + h / 2, z);
  if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  parent.add(mesh); return mesh;
}
function line(parent, points, color = palette.edge, opacity = .75, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
  const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .5, gapSize: .4, transparent: true, opacity }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const mesh = new THREE.Line(geometry, mat); if (dashed) mesh.computeLineDistances(); parent.add(mesh); return mesh;
}
function cylinder(parent, x, y, z, r, h, color = palette.white, sides = 12) {
  const geo = new THREE.CylinderGeometry(r, r, h, sides);
  const mesh = new THREE.Mesh(geo, material(color)); mesh.position.set(x, y + h / 2, z);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMaterial)); parent.add(mesh); return mesh;
}
function ring(parent, x, y, z, radius, color = palette.edge, vertical = false) {
  const pts = [];
  for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(vertical ? [x + Math.cos(a) * radius, y + Math.sin(a) * radius, z] : [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius]); }
  return line(parent, pts, color);
}
function bike(parent, x, y, z, color = palette.dark, scale = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale); parent.add(g);
  ring(g, -.7, .55, 0, .53, color, true); ring(g, .8, .55, 0, .53, color, true);
  line(g, [[-.7,.55,0],[-.1,.65,0],[-.4,1.2,0],[-.7,.55,0],[.38,1.2,0],[.8,.55,0],[-.1,.65,0],[.38,1.2,0],[.48,1.4,0],[.72,1.4,0]], color);
  line(g, [[-.56,1.25,0],[-.2,1.25,0]], color); return g;
}
function tree(x, z, size = 1) {
  const g = new THREE.Group(); scene.add(g); cylinder(g, x, 0, z, .07, 1.8 * size, palette.dark, 5);
  const geo = new THREE.IcosahedronGeometry(1.05 * size, 0);
  const crown = new THREE.Mesh(geo, material(0xeff3ec)); crown.position.set(x, 2.2 * size, z);
  crown.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial)); g.add(crown);
}
function disposeGroup(group) {
  while (group.children.length) {
    const child = group.children[0]; group.remove(child);
    child.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== edgeMaterial && ![...fills.values()].includes(o.material)) o.material.dispose(); });
  }
}
function buildSite() {
  box(scene, -1, -.7, 1, 64, .65, 43, 0xe9eee7);
  box(scene, -1, -.04, -17.5, 63, .05, 5, 0xe3e9e2, false);
  line(scene, [[-32,.025,-17.5],[30,.025,-17.5]], 0xffffff, 1, true);
  for (let x = -30; x <= 30; x += 3) line(scene, [[x,0,-14.5],[x,0,21.5]], 0xcdd6cd, .25);
  for (let z = -14; z <= 21; z += 3) line(scene, [[-32,0,z],[30,0,z]], 0xcdd6cd, .25);
  // A single directed route snakes through the four work areas.
  const path = [[-26,.12,-7],[-14,.12,-7],[10,.12,-7],[10,.12,10],[-14,.12,10],[-27,.12,10]];
  line(scene, path, palette.green, .45, true);
  [[-2,-7,0],[10,2,Math.PI/2],[-2,10,Math.PI]].forEach(([x,z,a]) => {
    const arrow = new THREE.Group(); arrow.position.set(x,.14,z); arrow.rotation.y = -a;
    line(arrow, [[-1,0,-.55],[0,0,0],[-1,0,.55]], palette.green, .65); scene.add(arrow);
  });
  for (let x = -30; x <= 30; x += 3) {
    box(scene,x,0,22,.045,1.4,.045,palette.edge,false);
    if (x < 30) line(scene,[[x,1.25,22],[x+3,1.25,22]],palette.edge,.5);
  }
  for (let z = -13; z <= 20; z += 3) {
    box(scene,31,0,z,.045,1.4,.045,palette.edge,false);
    line(scene,[[31,1.25,z],[31,1.25,z+3]],palette.edge,.5);
  }
  // Loading dock, pallets, office and utilities remain neutral site context.
  box(scene, -27, 0, 9, 5, .35, 9, 0xe1e8df);
  for (let i = 0; i < 5; i++) box(scene,-28 + i%2*1.5,.35,6+Math.floor(i/2)*2,1.1,.65,1.4,0xf2f4e9);
  box(scene, 26, 0, 9, 6, 4.8, 9);
  for (let z = 6; z <= 12; z += 2) box(scene,22.97,1.7,z,.06,1.8,1.2,0xdce6df);
  box(scene, 26, 4.8, 9, 6.5,.22,9.5);
  for (let i=0;i<3;i++) { cylinder(scene,24+i*2.4,0,-2,1,3.5); ring(scene,24+i*2.4,2.7,-2,1.01); }
  box(scene, 3, 0, -17.4, 6, 1.7, 2.3); box(scene,-.6,0,-17.4,1.4,1.45,2.3,0xdfe8e0);
  [[-1,-18.6],[-1,-16.2],[4.9,-18.6],[4.9,-16.2]].forEach(([x,z])=>{ const w = cylinder(scene,x,.05,z,.35,.18,palette.dark,12); w.rotation.x = Math.PI/2; });
  for (let i = 0; i < 5; i++) {
    box(scene,-26+i*3.5,0,-12,1.8,.65,3, i%2?0xdde6df:0xf7faf6);
    box(scene,-26+i*3.5,.65,-12,1.5,.4,1.3);
    line(scene,[[-27.3+i*3.5,.05,-14],[-27.3+i*3.5,.05,-10]],palette.edge,.5);
  }
  [[-29,-5],[-29,0],[-25,19],[-20,20],[-8,20],[0,20],[7,20],[16,20],[25,19],[28,-10],[27,-13]].forEach(([x,z],i)=>tree(x,z,.7+(i%3)*.17));
  // Fine contour lines echo the reference's landscape without hiding the process.
  for (let r=1;r<6;r++) {
    const pts=[]; for(let k=0;k<=48;k++){const a=k/48*Math.PI*2;pts.push([21+Math.cos(a)*(r*.9), .02, -26+Math.sin(a)*(r*.45)]);} line(scene,pts,0xaebbaf,.38);
  }
}
function buildBuildings() {
  positions.forEach(([x,z],i)=>{
    const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
    const floor=box(g,0,.02,0,18,.13,11.5,0xe5ede6); floor.material=material(0xe5ede6).clone(); floors.push(floor);
    const hit=box(g,0,.2,0,16,4.2,9);hit.visible=false;hit.userData.stage=i;pickables.push(hit);
    const rear=box(g,0,.15,-4.5,16,3.8,.2); rear.userData.stage=i;pickables.push(rear);
    box(g,-8,.15,0,.2,2.7,9);box(g,8,.15,-1,.2,2.7,7);
    for(let n=0;n<9;n++)line(g,[[-7+n*1.75,.2,-4.63],[-7+n*1.75,3.8,-4.63]],palette.edge,.45);
    for(let n=0;n<5;n++)box(g,-5.8+n*2.9,2.3,-4.36,2.1,.95,.06,0xdfe8e1);
    for(let n=0;n<4;n++) {box(g,-7+n*4.65,.15,4.4,.16,3.1,.16);line(g,[[-7+n*4.65,3.25,4.4],[-7+n*4.65,3.25,-4.4]],palette.edge,.5);}
    const roof=new THREE.Group();g.add(roof);roof.visible=!cutaway;roofs.push(roof);
    box(roof,0,4.05,0,16.6,.22,9.6);
    for(let n=0;n<3;n++) {box(roof,-5.2+n*5.2,4.27,0,2.4,.38,7.7,0xe1e9e0);for(let m=0;m<6;m++)line(roof,[[-6.4+n*5.2,4.67,-3.5+m*1.4],[-4+n*5.2,4.67,-3.5+m*1.4]],palette.edge,.35);}
    if(i===1){cylinder(roof,5,4.27,2,.65,2);cylinder(roof,5,6.27,2,.9,.2);}
    const mg=new THREE.Group();g.add(mg);machineGroups.push(mg);
    const qg=new THREE.Group();g.add(qg);queueGroups.push(qg);
    const tag=document.createElement('button');tag.className='area-tag';tag.dataset.stage=i;
    tag.setAttribute('aria-label',`Inspect ${STAGES[i].name}`);tag.addEventListener('click',()=>selectStage(i));
    $('tags').append(tag);
  });
}
function rebuildMachines() {
  slotMeshes.length=0;progressMeshes.length=0;
  machineGroups.forEach((g,i)=>{
    disposeGroup(g);const slots=[],progress=[];
    for(let n=0;n<machines[i];n++){
      const x=-5.7+(n%2)*8.4,z=-1.9+Math.floor(n/2)*4.1;
      if(i===1){
        box(g,x,.2,z,3.8,2.6,.16);box(g,x-1.85,.2,z+1.1,.15,2.6,2.3);box(g,x+1.85,.2,z+1.1,.15,2.6,2.3);
        box(g,x,2.8,z+1.1,3.9,.15,2.4);box(g,x,.2,z+1.2,3.7,.12,2.2,0xd8e5da);
        for(let q=0;q<5;q++)line(g,[[x-1.3+q*.65,.5,z+.12],[x-1.3+q*.65,2.5,z+.12]],palette.edge,.25);
      } else {
        box(g,x,.3,z+1,3.6,.12,2.1,0xdce7dd);
        [[-1.4,-.75],[1.4,-.75],[-1.4,.75],[1.4,.75]].forEach(([dx,dz])=>box(g,x+dx,0,z+1+dz,.1,.35,.1));
        if(i===0) {box(g,x-1.4,.45,z+.2,.6,.6,.6);line(g,[[x-1.4,1,z+.2],[x-1.4,2,z+.2],[x,2,z+.2]],palette.dark);}
        if(i===2) {ring(g,x-1,.95,z+1,.52,palette.edge,true);ring(g,x+1,.95,z+1,.52,palette.edge,true);}
      }
      const work=bike(g,x,.4,z+1.3,palette.green,1.15);slots.push(work);
      box(g,x,.19,z+2.7,3.6,.07,.16,0xd1dcd2,false);
      const bar=box(g,x,.2,z+2.7,3.6,.08,.18,palette.green,false);bar.userData.origin=x;progress.push(bar);
      const worker=new THREE.Group();g.add(worker);cylinder(worker,x+2.25,.1,z+1,.19,.7,0xc0cdc1,8);const head=new THREE.Mesh(new THREE.SphereGeometry(.19,8,6),material(0xe7ede5));head.position.set(x+2.25,1,z+1);worker.add(head);
    }
    slotMeshes.push(slots);
    progressMeshes.push(progress);
  });
}
let queueSignature='';
function updateWork() {
  const signature=factory.queues.map(q=>q.length).join(',');
  if(signature!==queueSignature){
    queueSignature=signature;
    queueGroups.forEach((g,i)=>{disposeGroup(g);for(let n=0;n<Math.min(24,factory.queues[i].length);n++){
      const x=-7+(n%8)*1.8,z=6.2+Math.floor(n/8)*1.2;
      box(g,x,.17,z,1.25,.65,.82,palette.queue);
      line(g,[[x-.4,.84,z-.42],[x-.4,.84,z+.42]],palette.amber,.4);
    }});
  }
  slotMeshes.forEach((slots,i)=>slots.forEach((m,j)=>{const job=factory.busy[i][j];m.visible=!!job;}));
  updateProgress();
}
function updateProgress(){progressMeshes.forEach((bars,i)=>bars.forEach((bar,j)=>{const job=factory.busy[i][j];bar.visible=!!job;if(job){const fraction=(factory.time-job.start)/STAGES[i].minutes;bar.scale.x=Math.max(.001,fraction);bar.position.x=bar.userData.origin-1.8+1.8*fraction;}}));}
function selectStage(i) {selected=i;updateUI();render();}
function updateUI() {
  const a=analyze(machines,release),m=factory.metrics();
  $('stage-title').textContent=STAGES[selected].name;$('stage-description').textContent=descriptions[selected];
  $('stage-capacity').textContent=a.capacities[selected].toFixed(2);
  $('stage-equation').textContent=`${machines[selected]} station${machines[selected]===1?'':'s'} × 60 ÷ ${STAGES[selected].minutes} minutes`;
  $('resource-label').textContent=resourceNames[selected];$('resources').value=machines[selected];$('resource-value').value=machines[selected];
  $('constraint').textContent=a.bottlenecks.includes(selected)?'Capacity constraint':'Spare capacity';
  $('constraint').style.visibility=a.bottlenecks.includes(selected)?'visible':'hidden';
  $('capacity').textContent=`${a.capacity.toFixed(2)} / hr`;$('output').textContent=`${a.output.toFixed(2)} / hr`;
  $('release').value=release;
  $('finished').textContent=m.completed;$('wip').textContent=m.wip;$('waiting').textContent=m.queues.reduce((s,v)=>s+v,0);
  $('clock').textContent=`${String(Math.floor(m.time/60)).padStart(2,'0')}:${String(Math.floor(m.time%60)).padStart(2,'0')}`;
  $('play').textContent=running?'Pause':m.time>=480?'Replay shift':'Run shift';
  $('step').disabled=m.time>=480;
  $('bars').innerHTML=STAGES.map((s,i)=>`<div class="bar-row" data-constraint="${a.bottlenecks.includes(i)}"><span>${s.short}</span><div class="bar-track"><i style="width:${a.capacities[i]/8*100}%"></i></div><span>${a.capacities[i].toFixed(1)}</span></div>`).join('');
  const bottleneck=a.bottlenecks.map(i=>STAGES[i].name.toLowerCase()).join(' and ');
  $('observation').textContent=a.excess>1e-8?`Release exceeds the line’s ${a.capacity.toFixed(2)}/hr capacity. Work accumulates upstream of ${bottleneck}. Adding capacity at that constraint can move it elsewhere.`:
    release<a.capacity-1e-8?`Release is below capacity. This line can sustain ${release.toFixed(2)}/hr; releasing less work prevents queues in this deterministic example.`:
    `Release matches capacity. ${STAGES[a.bottlenecks[0]].name} sets the pace. With no randomness or downtime in this model, work can flow without a growing queue.`;
  document.querySelectorAll('.area-tag').forEach((tag,i)=>{
    tag.innerHTML=`<strong>${i+1} · ${STAGES[i].short}</strong><span>${a.capacities[i].toFixed(2)}/hr · ${m.queues[i]} waiting</span>`;
    tag.setAttribute('aria-pressed',String(i===selected));tag.dataset.constraint=a.bottlenecks.includes(i);
    floors[i].material.color.setHex(i===selected?0xd0e5d8:a.bottlenecks.includes(i)?0xf0dfca:0xe5ede6);
  });
  updateWork();
}
function resetComparison(preset) {
  running=false;factory=new Factory(machines,release).advance(240);queueSignature='';rebuildMachines();
  document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.preset)===preset)));
  updateUI();render();
}
function projectTags() {
  if(!camera)return;
  const rect=world.getBoundingClientRect();
  document.querySelectorAll('.area-tag').forEach((tag,i)=>{
    const v=new THREE.Vector3(positions[i][0],5.5,positions[i][1]-1).project(camera);
    tag.style.left=`${(v.x+1)*rect.width/2}px`;tag.style.top=`${(-v.y+1)*rect.height/2}px`;
    tag.style.visibility=v.z>1||v.z< -1?'hidden':'visible';
  });
}
function render(){if(!renderer)return;renderer.render(scene,camera);projectTags();}
function resize(){
  const w=world.clientWidth,h=world.clientHeight,aspect=w/h,half=Math.max(24,40/aspect);
  camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();renderer.setSize(w,h,false);render();
}
function homeView(){controls.target.set(-1,0,1);camera.position.set(43,43,51);camera.zoom=1;camera.updateProjectionMatrix();controls.update();render();}
function rotate(angle){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);camera.position.copy(controls.target.clone().add(offset));controls.update();render();}
function setup(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf8faf8);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','Three-dimensional bicycle factory. Use the four building buttons to inspect stations.');renderer.domElement.setAttribute('role','img');world.prepend(renderer.domElement);
  scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-40,40,24,-24,.1,500);
  scene.add(new THREE.AmbientLight(0xffffff,2.65));const sun=new THREE.DirectionalLight(0xffffff,.6);sun.position.set(-25,55,25);scene.add(sun);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minZoom=.6;controls.maxZoom=3.2;controls.minPolarAngle=.03;controls.maxPolarAngle=Math.PI*.44;
  controls.addEventListener('change',render);homeView();
  buildSite();buildBuildings();rebuildMachines();updateUI();resize();
  new ResizeObserver(resize).observe(world);$('loading').hidden=true;
  const ray=new THREE.Raycaster();let start=null;
  renderer.domElement.addEventListener('pointerdown',e=>{start=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)return;
    const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
    const hits=ray.intersectObjects(pickables);if(hits.length)selectStage(hits[0].object.userData.stage);
  });
}
try{setup();}catch(error){$('loading').textContent='The 3D view needs WebGL enabled in your browser. Try opening this file in Edge or Chrome.';console.error(error);}

document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
  const p=Number(b.dataset.preset);machines=[[2,1,2,1],[2,2,2,1],[2,2,2,2]][p].slice();release=2;selected=p===1?3:1;resetComparison(p);
}));
$('resources').addEventListener('input',()=>{machines[selected]=Number($('resources').value);resetComparison(-1);});
function setRelease(){let v=Number($('release').value);if(!Number.isFinite(v))v=2;release=Math.max(.5,Math.min(4,Math.round(v*2)/2));resetComparison(-1);}
$('release').addEventListener('input',()=>{if($('release').value!==''&&$('release').checkValidity())setRelease();});
$('release').addEventListener('change',setRelease);
$('play').addEventListener('click',()=>{if(factory.time>=480){factory=new Factory(machines,release);queueSignature='';}running=!running;updateUI();render();});
$('step').addEventListener('click',()=>{running=false;factory.advance(Math.min(480,factory.time+60));updateUI();render();});
$('reset').addEventListener('click',()=>{running=false;factory=new Factory(machines,release);queueSignature='';updateUI();render();});
$('cutaway').addEventListener('click',()=>{cutaway=!cutaway;roofs.forEach(r=>r.visible=!cutaway);$('cutaway').setAttribute('aria-pressed',String(cutaway));render();});
$('homeview').addEventListener('click',homeView);
$('topview').addEventListener('click',()=>{camera.position.set(-1,85,1.1);controls.target.set(-1,0,1);camera.zoom=1;camera.updateProjectionMatrix();controls.update();render();});
$('rotate-left').addEventListener('click',()=>rotate(-Math.PI/8));$('rotate-right').addEventListener('click',()=>rotate(Math.PI/8));
$('zoom-in').addEventListener('click',()=>{camera.zoom=Math.min(3.2,camera.zoom*1.2);camera.updateProjectionMatrix();render();});
$('zoom-out').addEventListener('click',()=>{camera.zoom=Math.max(.6,camera.zoom/1.2);camera.updateProjectionMatrix();render();});
document.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>{
  $('answer').textContent=Number(b.dataset.answer)===1.5?'Yes. Paint rises to 2/hr, but final assembly is still 1.5/hr. The constraint moves. The whole line gains 50%, not 100%.':
    Number(b.dataset.answer)===2?'Painting reaches 2/hr, but every bicycle must still pass final assembly at 1.5/hr. Look downstream: that stage now sets the ceiling.':'Adding paint capacity does help. The new ceiling is 1.5/hr because final assembly becomes the constraint.';
}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){running=false;updateUI();}});
let last=performance.now(),uiElapsed=0;
function tick(now){
  const delta=Math.min((now-last)/1000,.2);last=now;
  if(running){factory.advance(Math.min(480,factory.time+delta*Number($('speed').value)));if(factory.time>=480)running=false;uiElapsed+=delta;if(uiElapsed>.1||!running){updateUI();uiElapsed=0;}updateProgress();render();}
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
