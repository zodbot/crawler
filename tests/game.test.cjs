const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the actual game simulation in a deterministic, headless DOM shim.
// Instrumentation is inserted into this test VM only, never the shipped game.
function game(race='human',job='brawler') {
  const nodes=new Map(),storage=new Map(),listeners={};
  const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',style:{},dataset:{},className:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},addEventListener(){},getContext:()=>ctx});return nodes.get(id);};
  const document={getElementById:node,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners[k]=f,hidden:false,createElement:()=>({click(){}})};
  const window={addEventListener:(k,f)=>listeners[k]=f};
  const context=vm.createContext({document,window,HTMLButtonElement:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},requestAnimationFrame(){},setTimeout(){},Blob,URL,console,Math});
  const hooks=`window.testAPI={get state(){return s},get player(){return p},get cat(){return cat},get enemies(){return enemies},get props(){return props},get bombs(){return bombs},get mode(){return mode},get coop(){return coop},keys,pressed,tick,render,use,punch,explode,damage,award,cast,mark,retry,hurt,loadRoom,pause,resume,finish,setup,begin(r,j){race=r;job=j;s=fresh();mode='play';loadRoom(0);hide();}};`;
  let source=fs.readFileSync(path.join(__dirname,'../dist/game.js'),'utf8').replace('setup();requestAnimationFrame(frame);',hooks+'setup();requestAnimationFrame(frame);');
  vm.runInContext(source,context);const g=window.testAPI;g.begin(race,job);
  return {g,nodes,storage,listeners,step:(seconds)=>{for(let n=0;n<Math.round(seconds*60);n++)g.tick(1/60);},at:(x,y=420)=>{g.player.x=x;g.player.y=y;},press:(k)=>{g.pressed.add(k);g.keys.add(k);g.tick(1/60);g.keys.delete(k);}};
}

test('All four builds receive their designed starting stats and render every room',()=>{
 for(const [r,j,str,int] of [['human','brawler',5,3],['human','saboteur',3,5],['goblin','brawler',4,4],['goblin','saboteur',2,6]]){
  const {g}=game(r,j);assert.equal(g.state.str,str);assert.equal(g.state.int,int);
  for(let i=0;i<5;i++){g.loadRoom(i);g.render();}
 }
});
test('Movement, jumping, platform landing and pause respect player control',()=>{
 const {g,step,press}=game();g.keys.add('KeyD');step(1);g.keys.clear();assert.ok(g.player.x>340);
 press('Space');assert.ok(g.player.y<420);step(1);assert.equal(g.player.y,420);
 g.pause();const x=g.player.x;g.keys.add('KeyD');step(2);assert.equal(g.player.x,x);g.resume();assert.equal(g.mode,'play');
});
test('Punching knocks enemies back, damages them and breaks tutorial crates',()=>{
 const {g,at}=game();at(320);g.punch();assert.equal(g.props.find(p=>p.type==='crate').active,false);
 g.loadRoom(1);at(750);const e=g.enemies[0],x=e.x;g.punch();assert.equal(e.hp,14);assert.ok(e.x>x);assert.ok(e.vx>0);
});
test('First broadcast gates progression until the fight AND chest are complete',()=>{
 const {g,at}=game();g.loadRoom(1);at(1510);g.use();assert.equal(g.state.room,1);
 at(1310);g.use();assert.equal(g.state.bombs,0);
 g.enemies.forEach(e=>g.damage(e,100,'punch'));at(1510);g.use();assert.equal(g.state.room,1);
 at(1310);g.use();assert.equal(g.state.bombs,2);g.use();assert.equal(g.state.bombs,2);
 at(1510);g.use();assert.equal(g.state.room,2);
});
test('Supply choice changes future resources and loot cannot be collected through the wall',()=>{
 const a=game();a.g.state.bombs=2;a.g.loadRoom(2);a.at(1000);a.g.use();assert.equal(a.g.state.str,5);
 a.at(520);a.g.use();a.at(1510);a.g.use();assert.equal(a.g.state.room,3);assert.equal(a.g.state.bombs,2);assert.ok(a.g.state.log.some(t=>t.includes('Kept bombs')));
 const b=game();b.g.state.bombs=2;b.g.loadRoom(2);b.g.state.hp=3;
 b.at(680);b.g.keys.add('KeyK');b.step(.3);b.g.keys.clear();b.step(.02);assert.equal(b.g.state.bombs,1);assert.equal(b.g.bombs.length,1);
 b.step(2);assert.equal(b.g.state.flags.wallOpen,true);b.at(1000);b.g.use();assert.equal(b.g.state.str,6);assert.equal(b.g.state.hp,5);assert.equal(b.g.state.bombs,1);
});
test('Challenge can be skipped, but accepting locks the exit until all monsters fall',()=>{
 const {g,at}=game();g.loadRoom(3);at(1510);g.use();assert.equal(g.state.room,4);assert.equal(g.state.flags.skippedChallenge,true);
 const b=game();b.g.loadRoom(3);b.at(330);b.g.use();assert.equal(b.g.enemies.length,3);b.at(1510);b.g.use();assert.equal(b.g.state.room,3);
 b.g.enemies.forEach(e=>b.g.damage(e,100,'explosion'));b.step(.02);assert.equal(b.g.state.flags.challengeCleared,true);
 b.at(1210);b.g.use();assert.equal(b.g.state.bombs,2);b.at(1510);b.g.use();assert.equal(b.g.state.room,4);
});
test('Saboteurs can rewire traps; Brawlers cannot; smart bonuses cannot be farmed',()=>{
 const {g,at,step}=game('goblin','saboteur');g.loadRoom(4);at(920);g.use();const trap=g.props.find(p=>p.type==='trap');assert.equal(trap.rewired,true);
 const fame=g.state.fame;g.use();assert.equal(g.state.fame,fame);step(1);assert.equal(g.state.hp,6);
 const b=game();b.g.loadRoom(4);b.at(920);b.g.use();assert.ok(!b.g.props.find(p=>p.type==='trap').rewired);
});
test('Boss telegraphs, charges, hits the wall, and takes more damage when stunned',()=>{
 const {g,at,step}=game();g.loadRoom(4);at(450);const boss=g.enemies[0];g.damage(boss,10,'punch');assert.equal(boss.hp,98);
 step(1.1);assert.equal(boss.phase,'windup');step(1.3);assert.equal(boss.phase,'charge');
 // Stand outside the charge line while waiting for the wall impact.
 at(50);step(2.5);assert.equal(boss.phase,'stunned');const hp=boss.hp;g.damage(boss,10,'punch');assert.equal(boss.hp,hp-10);
});
test('Floor completion requires boss victory AND reward chest, then clears the saved run',()=>{
 const {g,at,storage}=game();g.loadRoom(4);at(1580);g.use();assert.equal(g.mode,'play');
 const boss=g.enemies[0];boss.phase='stunned';g.damage(boss,1000,'explosion');assert.equal(g.state.flags.bossDead,true);
 at(1580);g.use();assert.equal(g.mode,'play');at(1440);g.use();assert.equal(g.state.flags.bossLoot,true);
 at(1580);g.use();assert.equal(g.mode,'win');assert.equal(storage.has('dungeon-broadcast-v1'),false);
});
test('Room checkpoint restores resources, stats and queued sponsor gifts on retry',()=>{
 const {g}=game();g.state.bombs=2;g.state.flags.giftPending=true;g.loadRoom(2);g.state.bombs=0;g.state.str=99;g.state.hp=0;g.retry();
 assert.equal(g.state.bombs,2);assert.equal(g.state.str,5);assert.equal(g.state.hp,6);assert.ok(g.props.some(p=>p.type==='gift'));assert.equal(g.mode,'play');
});
test('AI Donut obeys marked targets; P2 takes over, and leaving restores AI',()=>{
 const {g,at,nodes,step}=game();g.loadRoom(1);at(750);g.cat.x=700;g.mark();const hp=g.enemies[0].hp;g.cast();step(.2);assert.ok(g.enemies[0].hp<hp);
 nodes.get('coop').onclick();assert.equal(g.coop,true);g.keys.add('ArrowRight');const catX=g.cat.x,carlX=g.player.x;step(.2);g.keys.clear();assert.ok(g.cat.x>catX);assert.equal(g.player.x,carlX);
 nodes.get('coop').onclick();assert.equal(g.coop,false);
});
test('Own explosions do no player damage, and death offers a valid retry',()=>{
 const {g}=game();g.explode(g.player.x,400);assert.equal(g.state.hp,6);
 for(let i=0;i<6;i++){g.player.inv=0;g.hurt();}assert.equal(g.mode,'dead');g.retry();assert.equal(g.state.hp,6);assert.equal(g.mode,'play');
});
