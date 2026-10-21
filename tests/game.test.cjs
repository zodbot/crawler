const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the actual game simulation in a deterministic, headless DOM shim.
// Instrumentation is inserted into this test VM only, never the shipped game.
function game(race='human',job='brawler',ImageClass) {
  const nodes=new Map(),storage=new Map(),listeners={};
  const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',style:{},dataset:{},className:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},addEventListener(){},getContext:()=>ctx});return nodes.get(id);};
  const document={getElementById:node,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners[k]=f,hidden:false,createElement:()=>({click(){}})};
  const window={addEventListener:(k,f)=>listeners[k]=f};
  const context=vm.createContext({document,window,Image:ImageClass,HTMLButtonElement:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},requestAnimationFrame(){},setTimeout(){},Blob,URL,console,Math});
  const hooks=`window.testAPI={get state(){return s},get player(){return p},get cat(){return cat},get enemies(){return enemies},get props(){return props},get bombs(){return bombs},get hostile(){return hostile},get mode(){return mode},get coop(){return coop},get aim(){return aim},get guild(){return guild},get practiceTrace(){return practiceTrace},get decoy(){return decoy},planDonut,setDonutGoal,donutPlannerTick,royalDecoy,barefootBreaker,stompDamage,chargeSpecials,enemyAim,keys,pressed,tick,render,physics,solidDozer,barrelTick,barrelDamage,gainPractice,skillGoal,claimReward,queueReward,showReward,suggestedReward,punchDamage,magicDamage,bombDamage,gainXP,applyUpgrade,enterGuild,leaveGuild,setLesson,nextLesson,drinkPotion,dropPotion,dozerTick,dozerWeak,startChallenge,carlFrame,donutFrame,carlThrowFrame,bombLaunch,bombMotion,CARL_HEIGHT,DOOR_OPENING,actorDefinitions,actorImages,loadActorImages,use,punch,explode,damage,award,cast,mark,retry,hurt,loadRoom,pause,resume,finish,setup,inventory,dropBombs,broadcastClear,placeSnare,snareTick,spawnEnemy,llamaTick,hostileTick,practice,begin(r,j){race=r;job=j;s=fresh();mode='play';loadRoom(0);hide();}};`;
  let source=fs.readFileSync(path.join(__dirname,'../dist/game.js'),'utf8').replace('setup();loadActorImages();requestAnimationFrame(frame);',hooks+'setup();loadActorImages();requestAnimationFrame(frame);');
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
 const {g,at,step}=game();at(320);g.punch();assert.equal(g.props.find(p=>p.type==='crate').active,false);
 g.loadRoom(1);const e=g.enemies[0],x=e.x;g.enemies[1].x=e.x+350;at(e.x-50);g.punch();assert.equal(e.hp,4);assert.ok(e.x>x);assert.ok(e.vx>0);
});
test('Goblin ambush is on foot; stash requires defeating both guards and collecting supplies',()=>{
 const {g,at,step}=game();g.loadRoom(1);at(1550);g.use();assert.equal(g.state.room,1);
 at(1370);g.use();assert.equal(g.state.bombs,0);assert.equal(g.enemies.length,2);assert.equal(g.props.some(p=>p.type==='truck'),false);
 g.enemies.forEach((e,i)=>{e.x=800+i*100;g.damage(e,100,'punch');});at(1550);g.use();assert.equal(g.state.room,1);
 at(1370);g.use();assert.equal(g.state.bombs,0);assert.equal(g.state.traps,2);assert.ok(g.props.some(p=>p.type==='pickup'&&p.source==='cargo'));
 at(1550);g.use();assert.equal(g.state.room,1);at(1370);step(.5);assert.equal(g.state.bombs,2);
 g.use();step(.5);assert.equal(g.state.bombs,2);at(1550);g.use();assert.equal(g.state.room,2);assert.equal(g.state.bombs,2);
});
test('Supply choice changes future resources and loot cannot be collected through the wall',()=>{
 const a=game();a.g.state.bombs=2;a.g.loadRoom(2);a.at(1000);a.g.use();assert.equal(a.g.state.str,5);
 a.at(520);a.g.use();a.at(1510);a.g.use();assert.equal(a.g.state.room,2);a.g.damage(a.g.enemies[0],100,'donut');a.g.use();assert.equal(a.g.state.room,3);assert.equal(a.g.state.bombs,2);assert.ok(a.g.state.log.some(t=>t.includes('Kept bombs')));
 const b=game();b.g.state.bombs=2;b.g.loadRoom(2);b.g.damage(b.g.enemies[0],100,'donut');b.g.state.hp=3;
 b.at(680);b.g.keys.add('KeyK');b.step(.3);b.g.keys.clear();b.step(.02);assert.equal(b.g.state.bombs,1);assert.equal(b.g.bombs.length,1);
 b.step(2);assert.equal(b.g.state.flags.wallOpen,true);b.at(1000);b.g.use();assert.equal(b.g.state.str,5);assert.equal(b.g.state.pendingRewards.length,1);assert.equal(b.g.mode,'reward');b.g.claimReward('2:supply','carl');assert.equal(b.g.state.str,6);assert.equal(b.g.state.hp,5);assert.equal(b.g.state.bombs,1);
});
test('The broadcast arena starts at its threshold, can be skipped, and locks the boss door until cleared',()=>{
 const a=game();a.g.loadRoom(3);assert.equal(a.g.props.some(o=>o.type==='lever'),false);a.at(345);a.g.use();assert.equal(a.g.state.room,4);assert.equal(a.g.state.flags.skippedChallenge,true);
 const b=game();b.g.loadRoom(3);b.at(610);b.step(.02);assert.equal(b.g.enemies.length,3);assert.equal(b.g.state.flags.challengeStarted,true);b.at(345);b.g.use();assert.equal(b.g.state.room,3);
 b.g.enemies.forEach(e=>b.g.damage(e,100,'explosion'));b.step(.02);assert.equal(b.g.state.flags.challengeCleared,true);b.at(1210);b.g.use();b.g.claimReward('3:challenge','donut');b.step(.5);assert.equal(b.g.state.bombs,2);b.at(345);b.g.use();assert.equal(b.g.state.room,4);
});
test('Saboteurs can rewire traps; Brawlers cannot; smart bonuses cannot be farmed',()=>{
 const {g,at,step}=game('goblin','saboteur');g.loadRoom(3);g.state.flags.challengeStarted=true;at(860);g.use();const trap=g.props.find(p=>p.type==='trap');assert.equal(trap.rewired,true);
 const fame=g.state.fame;g.use();assert.equal(g.state.fame,fame);step(1);assert.equal(g.state.hp,6);
 const b=game();b.g.loadRoom(3);b.g.state.flags.challengeStarted=true;b.at(860);b.g.use();assert.ok(!b.g.props.find(p=>p.type==='trap').rewired);
});
test('The Murder Dozer warns before charging, stalls on a support, and exposes its boiler',()=>{
 const {g,at,step}=game();g.loadRoom(4);at(600);const boss=g.enemies[0];for(const o of g.props)if(o.type==='barrel')o.active=false;g.damage(boss,10,'punch');assert.equal(boss.hp,51);assert.equal(boss.phase,'intro');step(3.9);assert.equal(boss.phase,'windup');assert.ok(boss.timer>0);
 step(1.7);assert.equal(boss.phase,'charge');const x=boss.x;step(.5);assert.ok(boss.x<x);step(1);assert.equal(boss.phase,'stunned');assert.ok(g.props.some(o=>o.type==='support'&&o.broken));
 const hp=boss.hp;g.damage(boss,10,'punch');assert.equal(boss.hp,hp-20);g.render();
});
test('Below half health the dozer adds a telegraphed slam with jumpable shockwaves',()=>{
 const {g,at,step}=game();g.loadRoom(4);const boss=g.enemies[0];boss.hp=25;boss.phase='walk';boss.cool=0;boss.cycles=1;at(600);step(.02);assert.equal(boss.rage,true);assert.equal(boss.phase,'slamWindup');step(1.2);assert.equal(boss.phase,'slam');assert.ok(g.hostile.some(b=>b.type==='shockwave'));step(.4);assert.equal(boss.phase,'stunned');
});
test('Floor completion requires boss victory AND reward chest, then clears the saved run',()=>{
 const {g,at,storage}=game();g.loadRoom(4);at(1580);g.use();assert.equal(g.mode,'play');
 const boss=g.enemies[0];boss.phase='stunned';g.damage(boss,1000,'explosion');assert.equal(g.state.flags.bossDead,true);
 at(1580);g.use();assert.equal(g.mode,'play');at(g.props.find(o=>o.kind==='boss').x);g.use();assert.equal(g.mode,'reward');g.claimReward('4:boss','planning');assert.equal(g.state.flags.bossLoot,true);
 at(1580);g.use();assert.equal(g.mode,'win');assert.equal(storage.has('dungeon-broadcast-v1'),false);
});
test('Room checkpoint restores resources and stats but removes old queued sponsor gifts',()=>{
 const {g}=game();g.state.bombs=2;g.state.flags.giftPending=true;g.loadRoom(2);g.state.bombs=0;g.state.str=99;g.state.hp=0;g.retry();
 assert.equal(g.state.bombs,2);assert.equal(g.state.str,5);assert.equal(g.state.hp,6);assert.equal(g.props.some(p=>p.type==='gift'),false);assert.equal(g.state.flags.giftPending,undefined);assert.equal(g.mode,'play');
});
test('AI Donut obeys marked targets; P2 takes over, and leaving restores AI',()=>{
 const {g,at,nodes,step}=game();g.loadRoom(1);g.enemies[0].x=800;at(750);g.cat.x=700;g.mark();const hp=g.enemies[0].hp;g.cast();step(.2);assert.ok(g.enemies[0].hp<hp);
 nodes.get('coop').onclick();assert.equal(g.coop,true);g.keys.add('ArrowRight');const catX=g.cat.x,carlX=g.player.x;step(.2);g.keys.clear();assert.ok(g.cat.x>catX);assert.equal(g.player.x,carlX);
 nodes.get('coop').onclick();assert.equal(g.coop,false);
});
test('Own explosions do no player damage, and death offers a valid retry',()=>{
 const {g}=game();g.explode(g.player.x,400);assert.equal(g.state.hp,6);
 for(let i=0;i<6;i++){g.player.inv=0;g.hurt();}assert.equal(g.mode,'dead');g.retry();assert.equal(g.state.hp,6);assert.equal(g.mode,'play');
});

test('Inventory pauses world state, shows bomb count, and resumes without consuming items',()=>{
 const {g,nodes,step}=game();g.state.bombs=3;g.inventory();assert.equal(g.mode,'inventory');
 assert.match(nodes.get('overlay').innerHTML,/× 3/);const x=g.player.x;g.keys.add('KeyD');step(2);assert.equal(g.player.x,x);assert.equal(g.state.bombs,3);
 nodes.get('close-inventory').onclick();assert.equal(g.mode,'play');assert.equal(g.state.bombs,3);
});
test('Crate pickups are unlit, collected once, carried across rooms, and spent one per throw',()=>{
 const {g,at,step}=game();at(320);g.punch();const item=g.props.find(p=>p.type==='pickup');assert.ok(item);assert.equal(g.state.bombs,0);
 at(item.x);step(.5);assert.equal(g.state.bombs,1);assert.equal(item.active,false);step(2);assert.equal(g.state.bombs,1);
 g.loadRoom(1);assert.equal(g.state.bombs,1);g.keys.add('KeyK');step(.3);g.keys.clear();step(.05);assert.equal(g.state.bombs,0);assert.equal(g.bombs.length,1);
 step(2);assert.equal(g.state.hp,6);
});
test('Ambush enemies pause with the inventory and retry restores enemies and loot stock',()=>{
 const {g,at,step}=game();g.loadRoom(1);at(400);step(.3);const e=g.enemies[0],x=e.x;
 g.inventory();step(5);assert.equal(e.x,x);g.resume();step(.5);assert.notEqual(e.x,x);
 g.damage(e,100,'donut');at(e.x);step(.5);assert.equal(g.state.bombs,1);g.retry();assert.equal(g.enemies.length,2);assert.ok(g.enemies.every(e=>e.hp===e.max));assert.equal(g.state.bombs,0);assert.equal(g.props.some(o=>o.type==='pickup'),false);assert.equal(g.enemies[0].loot,'bomb');
});
test('Goblin loot survives explosions until collected and cannot be duplicated',()=>{
 const {g,at,step}=game();g.loadRoom(1);const e=g.enemies.find(e=>e.loot==='bomb');e.x=1000;
 g.damage(e,100,'explosion');const drops=g.props.filter(o=>o.type==='pickup'&&o.item==='bomb'&&o.source==='goblin');assert.equal(drops.length,1);
 g.damage(e,100,'explosion');assert.equal(g.props.filter(o=>o.type==='pickup'&&o.item==='bomb'&&o.source==='goblin').length,1);
 g.explode(1000,400);assert.equal(drops[0].active,true);at(1000);step(.5);assert.equal(g.state.bombs,1);
});

test('T places one trap, waits to arm, and E recovers it without duplication',()=>{
 const {g,press,step,at}=game();g.state.traps=2;press('KeyT');const snare=g.props.find(o=>o.type==='snare');assert.ok(snare);assert.equal(g.state.traps,1);assert.ok(snare.arm>0);
 press('KeyT');assert.equal(g.state.traps,1);assert.equal(g.props.filter(o=>o.type==='snare'&&o.active).length,1);
 step(1.1);assert.equal(snare.arm,0);assert.equal(g.state.hp,6);at(snare.x);g.use();assert.equal(snare.active,false);assert.equal(g.state.traps,2);g.use();assert.equal(g.state.traps,2);
});
test('Traps reject airborne placement and empty inventories without consuming a kit',()=>{
 const {g}=game();g.placeSnare();assert.equal(g.props.filter(o=>o.type==='snare').length,0);g.state.traps=2;g.player.onGround=false;g.placeSnare();assert.equal(g.state.traps,2);assert.equal(g.props.filter(o=>o.type==='snare').length,0);
});
test('A snare holds the first monster, is safe for companions, and is consumed after triggering',()=>{
 const {g,step,at}=game();g.state.traps=2;at(480);g.placeSnare();step(1.1);const snare=g.props.find(o=>o.type==='snare');const e=g.spawnEnemy(480);g.enemies.push(e);g.cat.x=480;at(480);g.snareTick(snare,.016);
 assert.equal(snare.spent,true);assert.ok(e.snared>2);assert.equal(g.state.hp,6);const x=e.x;step(.4);assert.equal(e.x,x);assert.equal(g.state.hp,6);g.use();assert.equal(g.state.traps,1);
 g.damage(e,5,'explosion');assert.ok(g.state.seen.includes('snare-combo0'));const fame=g.state.fame;g.damage(e,5,'explosion');assert.equal(g.state.fame,fame);g.render();
});
test('Intelligence improves creature snares, but a snare cannot immobilize a bulldozer',()=>{
 const durations=[];for(const build of [['human','brawler'],['goblin','saboteur']]){const {g,step}=game(...build);g.state.traps=1;g.placeSnare();step(1.1);const e=g.spawnEnemy(100);g.enemies.push(e);g.snareTick(g.props.find(o=>o.type==='snare'),.016);durations.push(e.snared);}assert.ok(durations[1]>durations[0]);
 const {g,at,step}=game();g.loadRoom(4);g.state.traps=1;at(700);g.placeSnare();step(1.1);const boss=g.enemies[0];boss.x=700;g.snareTick(g.props.find(o=>o.type==='snare'),.016);assert.ok(!boss.snared);assert.equal(g.props.find(o=>o.type==='snare').spent,false);
});
test('Unused traps pack on room exit; a retry restores entry stock and removes placed traps',()=>{
 const {g,at}=game();g.state.traps=2;g.loadRoom(0);g.placeSnare();assert.equal(g.state.traps,1);at(1510);g.use();assert.equal(g.state.room,1);assert.equal(g.state.traps,2);g.placeSnare();g.retry();assert.equal(g.state.traps,2);assert.equal(g.props.some(o=>o.type==='snare'),false);
});
test('Bad Llama has a visible windup, shoots at range, and spit is stopped by cover',()=>{
 const {g,at,step}=game();g.loadRoom(2);const llama=g.enemies[0];assert.equal(llama.type,'llama');llama.x=700;at(380);step(1.1);assert.equal(llama.phase,'windup');step(.95);assert.ok(g.hostile.some(b=>b.type==='spit'));
 g.hostile.length=0;g.hostile.push({type:'spit',x:1065,y:400,vx:200,vy:0,life:3});g.hostileTick(.04);assert.equal(g.hostile.length,0);g.render();
});
test('Enemy projectiles can damage Carl, while jumping clear of their path avoids damage',()=>{
 const {g,at}=game();at(500);g.hostile.push({type:'spit',x:490,y:390,vx:200,vy:0,life:2});g.hostileTick(.05);assert.equal(g.state.hp,5);
 g.player.inv=0;at(500,300);g.hostile.push({type:'spit',x:490,y:390,vx:200,vy:0,life:2});g.hostileTick(.05);assert.equal(g.state.hp,5);
});
test('New practice entries provide bombs and traps; older checkpoints migrate trap stock',()=>{
 const {g,nodes}=game();nodes.get('try-traps').onclick();assert.equal(g.state.room,2);assert.equal(g.state.traps,2);assert.equal(g.state.bombs,3);nodes.get('try-boss').onclick();assert.equal(g.state.room,4);assert.equal(g.enemies[0].type,'boss');delete g.state.traps;g.loadRoom(2);assert.equal(g.state.traps,2);
});


test('Actor images load independently and a failed asset retains a playable fallback',()=>{
 const requests=[];class FakeImage {set src(value){this.url=value;requests.push(this);}}
 const {g,nodes}=game('human','brawler',FakeImage);
 assert.equal(nodes.get('game').dataset.characterArt,'loading');assert.equal(requests.length,12);
 requests[0].onload();assert.equal(g.actorImages.carl,requests[0]);g.render();
 requests[1].onload();assert.equal(nodes.get('game').dataset.characterArt,'loading');requests[2].onload();requests[3].onload();requests[4].onload();requests[5].onload();requests[6].onload();assert.equal(nodes.get('game').dataset.characterArt,'ready');g.render();
 const failures=[];class FailedImage {set src(value){failures.push(this);}}
 const fallback=game('human','brawler',FailedImage);failures[0].onerror();failures[1].onload();failures[2].onload();failures[3].onload();failures[4].onload();failures[5].onload();failures[6].onload();
 assert.equal(fallback.nodes.get('game').dataset.characterArt,'fallback');fallback.g.render();
});
test('All atlas crops stay inside their PNGs and animation states select valid frames',()=>{
 const {g}=game();
 for(const [name,def] of Object.entries(g.actorDefinitions)){
  const png=fs.readFileSync(path.join(__dirname,'../dist',def.src));const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  for(const f of def.frames){assert.ok(f.sx>=0&&f.sy>=0&&f.sw>0&&f.sh>0);assert.ok(f.sx+f.sw<=width&&f.sy+f.sh<=height);assert.ok(f.anchorX>=0&&f.anchorX<=f.sw&&f.anchorY>=0&&f.anchorY<=f.sh);}
 }
 const idle={attack:0,cool:0,onGround:true,vx:0};assert.equal(g.carlFrame(idle,0),0);assert.equal(g.donutFrame(idle,0),0);
 assert.equal(g.carlFrame({...idle,onGround:false},0),5);assert.equal(g.carlFrame({...idle,attack:.2},0),6);assert.equal(g.carlFrame({...idle,attack:.1},0),7);
 assert.equal(g.donutFrame({...idle,onGround:false},0),4);assert.equal(g.donutFrame({...idle,cool:1.5},0),5);
 assert.equal(new Set([0,.12,.24,.36].map(t=>g.carlFrame({...idle,vx:100},t))).size,4);
 g.actorImages.carl={};g.actorImages.donut={};
 for(const face of [-1,1])for(const attack of [0,.2,.1])for(const onGround of [true,false]){Object.assign(g.player,{face,attack,onGround});Object.assign(g.cat,{face,onGround,cool:1.5});g.render();}
});


test('Bomb aiming, release and follow-through animate once per bomb, and pause freezes them',()=>{
 const {g,step}=game();g.state.bombs=2;g.actorImages.carl={};g.actorImages.carlThrow={};
 g.keys.add('KeyK');step(.2);assert.equal(g.carlThrowFrame(),0);assert.equal(g.state.bombs,2);assert.equal(g.bombs.length,0);g.punch();assert.equal(g.player.attack,0);g.render();
 g.keys.clear();step(1/60);assert.equal(g.carlThrowFrame(),1);assert.equal(g.state.bombs,1);assert.equal(g.bombs.length,1);assert.ok(g.bombs[0].y<g.player.y-110);g.render();
 const t=g.player.throwTime;g.pause();step(1);assert.equal(g.player.throwTime,t);g.resume();step(.21);assert.equal(g.carlThrowFrame(),2);g.render();step(.3);assert.equal(g.carlThrowFrame(),-1);assert.equal(g.state.bombs,1);
 g.state.bombs=0;g.keys.add('KeyK');step(.2);assert.equal(g.carlThrowFrame(),-1);g.keys.clear();step(.02);assert.equal(g.state.bombs,0);assert.equal(g.player.throwTime,0);
});
test('Bomb preview launch and flight match released bombs in both directions and at room edges',()=>{
 for(const face of [-1,1]){
  const {g,step,at}=game();at(face<0?70:1400);g.player.face=face;g.state.bombs=1;g.keys.add('KeyK');step(.5);
  const expected=g.bombLaunch(g.aim);g.keys.clear();step(1/60);g.bombMotion(expected,1/60);const actual=g.bombs[0];
  assert.ok(Math.abs(actual.x-expected.x)<.01);assert.ok(Math.abs(actual.y-expected.y)<.01);
  for(let i=0;i<30;i++){g.bombMotion(expected,1/60);step(1/60);}
  assert.ok(Math.abs(actual.x-expected.x)<.01);assert.ok(Math.abs(actual.y-expected.y)<.01);
 }
});
test('The floor scale gives Carl door clearance, a smaller companion, and full-height projectile hits',()=>{
 const {g,at}=game();assert.ok(g.DOOR_OPENING>g.CARL_HEIGHT+20);assert.equal(g.actorDefinitions.donut.scale,.15);
 assert.ok(g.spawnEnemy(600,'boss').h>g.CARL_HEIGHT);assert.ok(g.spawnEnemy(600).h<g.CARL_HEIGHT);
 at(500);g.hostile.push({type:'spit',x:500,y:330,vx:0,vy:0,life:2});g.hostileTick(.01);assert.equal(g.state.hp,5);
 g.player.inv=0;g.hostile.push({type:'spit',x:500,y:290,vx:0,vy:0,life:2});g.hostileTick(.01);assert.equal(g.state.hp,5);
});


test('Mordecai is reached through the first hallway door and practice preserves the live room',()=>{
 const {g,at,step}=game();const door=g.props.find(o=>o.type==='guildDoor');assert.ok(door&&door.x<370);g.state.bombs=2;g.state.traps=1;g.state.hp=4;g.props.find(o=>o.type==='crate').active=false;
 at(door.x);g.use();assert.ok(g.guild);assert.equal(g.state.bombs,9);assert.equal(g.state.potions,9);g.hurt();assert.equal(g.state.hp,6);g.render();
 g.setLesson(3);g.keys.add('KeyK');step(.3);g.keys.clear();step(2);assert.equal(g.state.bombs,9);assert.equal(g.state.fame,0);
 g.leaveGuild();assert.equal(g.state.bombs,2);assert.equal(g.state.traps,1);assert.equal(g.state.hp,4);assert.equal(g.state.potions,2);assert.equal(g.props.find(o=>o.type==='crate').active,false);assert.equal(g.player.x,door.x);
 g.enterGuild();g.leaveGuild();assert.equal(g.state.potions,2);g.retry();g.enterGuild();g.leaveGuild();assert.equal(g.state.potions,2);
});
test('Every guild lesson requires its action, can repeat, and records structured input and success',()=>{
 const {g,at,step,press}=game();g.enterGuild();assert.equal(g.guild.done,false);g.keys.add('KeyD');step(1.4);g.keys.clear();assert.equal(g.guild.done,true);
 g.setLesson(1);at(680);press('Space');step(.9);assert.equal(g.guild.done,true);
 g.setLesson(2);at(630);g.punch();assert.equal(g.guild.done,true);g.setLesson(2);assert.equal(g.guild.done,false);
 g.setLesson(3);g.keys.add('KeyK');step(.3);g.keys.clear();step(1.7);assert.equal(g.guild.done,true);
 g.setLesson(4);g.placeSnare();step(4.4);assert.equal(g.guild.done,true);
 g.setLesson(5);assert.equal(g.state.hp,3);press('KeyH');step(.65);assert.equal(g.state.hp,6);assert.equal(g.guild.done,true);
 g.setLesson(6);press('KeyQ');step(.8);assert.equal(g.guild.done,true);assert.ok(g.practiceTrace.events.some(e=>e.kind==='input'));assert.ok(g.practiceTrace.events.some(e=>e.kind==='success'));g.nextLesson();assert.equal(g.guild.lesson,7);
 g.setLesson(7);step(1);assert.equal(g.guild.done,false);press('KeyV');step(2);assert.equal(g.guild.done,true);
 g.nextLesson();assert.equal(g.guild.lesson,8);g.punch();assert.equal(g.guild.done,false);press('KeyF');step(.7);assert.equal(g.guild.done,true);
 g.nextLesson();assert.equal(g.guild.lesson,9);press('KeyT');step(1.1);assert.equal(g.guild.done,false);press('KeyG');step(4);assert.equal(g.state.donutGoal,'setup');assert.equal(g.guild.done,true);g.nextLesson();assert.equal(g.guild,null);
});
test('Guild skips and exits are available without completing a lesson; pause does not consume practice time',()=>{
 const {g,step,nodes}=game();g.enterGuild();g.nextLesson();assert.equal(g.guild.lesson,1);assert.equal(g.guild.completed.length,0);g.keys.add('KeyD');g.pause();const x=g.player.x;step(1);assert.equal(g.player.x,x);g.resume();nodes.get('lesson-exit').onclick();assert.equal(g.guild,null);assert.equal(g.state.potions,2);
});
test('Potions heal three hearts, respect capacity/full health, pause, interruption and checkpoints',()=>{
 const {g,step,at}=game();g.state.potions=2;g.drinkPotion();step(.8);assert.equal(g.state.potions,2);g.state.hp=2;g.drinkPotion();step(.2);g.pause();step(1);assert.equal(g.state.hp,2);g.resume();step(.5);assert.equal(g.state.hp,5);assert.equal(g.state.potions,1);
 g.drinkPotion();step(.1);g.player.inv=0;g.hurt();step(.7);assert.equal(g.state.potions,1);assert.equal(g.state.hp,4);
 g.state.potions=3;g.dropPotion(400,'test');at(400);step(.5);assert.equal(g.state.potions,3);assert.ok(g.props.find(o=>o.item==='potion').active);g.state.hp=1;g.drinkPotion();step(.7);assert.equal(g.state.potions,3);assert.equal(g.props.find(o=>o.item==='potion').active,false);
 g.loadRoom(4);g.state.potions=0;g.retry();assert.equal(g.state.potions,3);
});


test('The dozer can be defeated with punches and timed jumps, without consumables, by every starting build',()=>{
 for(const [race,job] of [['human','brawler'],['human','saboteur'],['goblin','brawler'],['goblin','saboteur']]){
  const {g,at}=game(race,job);g.loadRoom(4);at(600);g.state.bombs=0;g.state.potions=0;const boss=g.enemies[0];
  for(let i=0;i<5400&&boss.hp>0&&g.mode==='play';i++){
   g.keys.clear();const gap=boss.x-g.player.x;
   if(boss.phase==='stunned'){if(Math.abs(gap)>240)g.keys.add(gap>0?'KeyD':'KeyA');else{g.player.face=Math.sign(gap)||1;g.keys.add('KeyJ');}}
   const blade=boss.x+boss.face*180,approach=(g.player.x-blade)*boss.face;
   if(g.player.onGround&&((boss.phase==='charge'&&approach>0&&approach<115)||(boss.phase==='slamWindup'&&boss.timer<.22)))g.pressed.add('Space');
   if(g.player.onGround&&g.hostile.some(b=>b.type==='shockwave'&&Math.abs(b.x-g.player.x)<90))g.pressed.add('Space');
   g.tick(1/60);
  }
  assert.ok(boss.hp<=0,race+'/'+job+' must have a consumable-free route');assert.ok(g.state.hp>0);
 }
});


test('Every ordinary monster drops one supply, including Bad Llama trap kits, without coins',()=>{
 const {g,at,step}=game();g.loadRoom(3);at(610);step(.02);const before={bomb:g.state.bombs,potion:g.state.potions,trap:g.state.traps};
 const expected=['bomb','potion','trap'];g.enemies.forEach((e,i)=>{e.x=750+i*170;g.damage(e,100,'donut');});
 const loot=g.props.filter(o=>o.type==='pickup');assert.deepEqual(Array.from(loot,o=>o.item).sort(),expected.sort());
 for(const item of loot){at(item.x);step(.5);assert.equal(item.active,false);}assert.equal(g.state.bombs,before.bomb+1);assert.equal(g.state.potions,before.potion+1);assert.equal(g.state.traps,before.trap+1);
 g.loadRoom(2);const llama=g.enemies[0];assert.equal(llama.type,'llama');assert.ok(llama.x<880);g.damage(llama,100,'donut');const kit=g.props.find(o=>o.item==='trap');assert.ok(kit);at(kit.x);step(.5);assert.equal(g.state.traps,2);
 g.loadRoom(3);assert.equal(g.state.traps,2);assert.equal(g.state.potions,1);assert.equal(g.state.bombs,1);
});
test('Boss creates one treasure chest only after death, pays once, and retry resets it',()=>{
 const {g,at}=game();g.loadRoom(4);assert.equal(g.props.some(o=>o.kind==='boss'),false);const boss=g.enemies[0];boss.x=800;boss.phase='stunned';g.damage(boss,1000,'donut');g.damage(boss,1000,'donut');
 const chests=g.props.filter(o=>o.kind==='boss');assert.equal(chests.length,1);assert.equal(chests[0].x,800);at(800);g.use();g.claimReward('4:boss','carl');assert.equal(g.state.flags.bossLoot,true);const stock=g.state.bombs;g.use();assert.equal(g.state.bombs,stock);g.retry();assert.equal(g.props.some(o=>o.kind==='boss'),false);assert.equal(g.enemies[0].hp,60);
});
test('Both inventory buttons expose all supplies; drinking from the bag resumes and consumes once',()=>{
 const {g,nodes,step}=game();g.state.bombs=4;g.state.traps=2;g.state.potions=3;g.state.hp=2;nodes.get('hud-inventory').onclick();assert.equal(g.mode,'inventory');const html=nodes.get('overlay').innerHTML;assert.match(html,/Bombs <b>× 4/);assert.match(html,/Potions <b>× 3/);assert.match(html,/Trap kits <b>× 2/);
 nodes.get('bag-heal').onclick();assert.equal(g.mode,'play');step(.7);assert.equal(g.state.hp,5);assert.equal(g.state.potions,2);nodes.get('inventory-button').onclick();assert.equal(g.mode,'inventory');g.render();
});

test('H from the bag begins drinking only when a potion is useful',()=>{
 const {g,listeners,step}=game();g.state.potions=1;g.inventory();const pressH=()=>listeners.keydown({code:'KeyH',repeat:false,target:{},preventDefault(){}});pressH();assert.equal(g.mode,'inventory');assert.equal(g.state.potions,1);g.state.hp=2;pressH();assert.equal(g.mode,'play');step(.7);assert.equal(g.state.hp,5);assert.equal(g.state.potions,0);
});

test('Removed signs, exit switch and automatic sponsor deliveries stay removed',()=>{
 const {g,step,nodes}=game();g.loadRoom(1);assert.equal(g.props.some(o=>o.type==='sign'),false);g.loadRoom(2);assert.equal(g.props.some(o=>o.type==='sign'||o.type==='switch'),false);
 g.award('a-big-show',200,'TEST',true);step(.1);assert.equal(g.props.some(o=>o.type==='gift'),false);assert.equal(g.state.flags.giftPending,undefined);assert.doesNotMatch(nodes.get('fame').textContent,/GIFT/);
});
test('Bad Llama survives a punch and a direct bomb for every starting build',()=>{
 for(const build of [['human','brawler'],['human','saboteur'],['goblin','brawler'],['goblin','saboteur']]){
  const {g,at}=game(...build);g.loadRoom(2);const llama=g.enemies[0];at(llama.x-40);g.player.face=1;g.punch();assert.ok(llama.hp>0);g.explode(llama.x,llama.y-25);assert.ok(llama.hp>=10);assert.equal(g.props.some(o=>o.type==='pickup'),false);
 }
});
test('Moving dozer hits Carl across the blade and tracks, pushes him clear, and respects invulnerability',()=>{
 for(const face of [-1,1])for(const offset of [-170,0,170]){
  const {g,at,step}=game();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:900,face,phase:'charge',vx:face*345,destination:face<0?300:1400});at(900+offset);g.dozerTick(boss,1/60);assert.equal(g.state.hp,5);assert.ok(Math.abs(g.player.x-boss.x)>boss.w/2);assert.ok(g.player.knockTime>0);assert.ok(g.player.vy<0);
  at(boss.x);g.dozerTick(boss,1/60);assert.equal(g.state.hp,5);g.pause();const x=g.player.x;step(.2);assert.equal(g.player.x,x);g.resume();
 }
});
test('A jump above the tracks avoids run-over damage; a low jump does not',()=>{
 for(const [height,expected] of [[100,6],[30,5]]){const {g,at}=game();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:900,face:-1,phase:'charge',vx:-345,destination:300});at(740,420-height);g.dozerTick(boss,1/60);assert.equal(g.state.hp,expected);}
});

test('A goblin takes five starting punches, and earned Strength adds one damage per point',()=>{
 const {g,at,nodes}=game();nodes.get('coop').onclick();g.loadRoom(1);const e=g.enemies[0];g.enemies[1].x=1500;assert.equal(g.punchDamage(),1);assert.equal(e.hp,5);
 for(let i=0;i<5;i++){g.player.cool=0;e.vx=0;at(e.x-55);g.player.face=1;g.punch();assert.equal(e.hp,4-i);}assert.equal(g.state.xp,3);g.state.str++;assert.equal(g.punchDamage(),2);
});
test('Donut starts at one damage; crawler XP tracks level without granting unearned combat skills',()=>{
 const {g,step,at,nodes}=game();g.loadRoom(1);nodes.get('coop').onclick();const e=g.enemies[0];e.x=800;at(700);g.cat.x=720;g.cast();step(.2);assert.equal(e.hp,4);assert.equal(g.magicDamage(),1);
 g.gainXP(12);assert.equal(g.state.level,2);assert.equal(g.punchDamage(),1);assert.equal(g.magicDamage(),1);g.gainXP(0);assert.equal(g.state.level,2);g.gainXP(12);assert.equal(g.state.level,3);assert.equal(g.magicDamage(),1);
 g.loadRoom(0);g.enterGuild();const xp=g.state.xp;g.gainXP(100);assert.equal(g.state.xp,xp);g.leaveGuild();assert.equal(g.state.xp,xp);
});
test('Power crystals upgrade the chosen hero only and cannot be spent twice or in practice',()=>{
 const {g,nodes}=game();g.state.upgrades=1;g.inventory('skills');nodes.get('upgrade-donut').onclick();assert.equal(g.magicDamage(),2);assert.equal(g.punchDamage(),1);assert.equal(g.state.upgrades,0);nodes.get('upgrade-carl').onclick();assert.equal(g.punchDamage(),1);
 g.resume();g.state.upgrades=1;g.inventory('skills');nodes.get('upgrade-carl').onclick();assert.equal(g.punchDamage(),2);assert.equal(g.magicDamage(),2);g.resume();g.state.upgrades=1;g.enterGuild();g.inventory();g.applyUpgrade('carl');assert.equal(g.state.upgrades,1);g.resume();g.leaveGuild();assert.equal(g.punchDamage(),2);assert.equal(g.state.upgrades,1);
});
test('Progression and assigned upgrades persist between rooms and retry restores entry state',()=>{
 const {g}=game();g.gainXP(12);g.state.upgrades=1;g.inventory();g.applyUpgrade('donut');g.resume();g.loadRoom(2);assert.equal(g.magicDamage(),2);g.gainXP(12);g.state.upgrades=4;g.retry();assert.equal(g.state.level,2);assert.equal(g.state.xp,12);assert.equal(g.magicDamage(),2);assert.equal(g.state.upgrades,0);
 delete g.state.baseStr;delete g.state.level;delete g.state.xp;delete g.state.donutMagic;delete g.state.upgrades;g.loadRoom(0);assert.ok(Number.isFinite(g.punchDamage()));assert.equal(g.magicDamage(),1);
});
test('The parked dozer blocks walking through either side, in every phase',()=>{
 for(const phase of ['intro','windup','stunned'])for(const side of [-1,1]){
  const {g,at}=game();g.loadRoom(4);const boss=g.enemies[0];boss.x=900;boss.phase=phase;at(boss.x+side*300);g.player.vx=-side*245;
  for(let i=0;i<150;i++)g.physics(g.player,1/60);
  assert.ok((g.player.x-boss.x)*side>=boss.w/2+18);assert.equal(g.state.hp,6);
 }
});
test('Carl can land on the chassis and is carried with it, while the cabin remains solid',()=>{
 const {g,at}=game();g.loadRoom(4);const e=g.enemies[0];e.x=900;at(740,325);g.player.vy=150;g.player.vx=0;g.physics(g.player,.1);assert.equal(g.player.y,332);assert.equal(g.player.onDozer,e.id);
 Object.assign(e,{phase:'charge',face:1,vx:345,destination:1300});const x=g.player.x;g.dozerTick(e,.02);assert.ok(g.player.x>x);assert.equal(g.state.hp,6);
 at(820,332);g.player.vx=245;g.player.vy=0;for(let i=0;i<30;i++)g.physics(g.player,1/60);assert.ok(g.player.x<e.x);assert.equal(g.player.y,332);
});

test('The blade slam damages riders on the chassis, while a jump avoids the slam',()=>{
 for(const riding of [true,false]){
  const {g,at}=game();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:900,phase:'slamWindup',timer:0});at(740,riding?332:240);g.player.onDozer=riding?boss.id:null;g.dozerTick(boss,1/60);assert.equal(g.state.hp,riding?5:6);
 }
});

test('A punched barrel detonates on either side of the parked dozer instead of passing through',()=>{
 for(const side of [-1,1]){
  const {g,at,nodes}=game();nodes.get('coop').onclick();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:1000,previousX:1000,phase:'stunned',timer:5});
  const barrel=g.props.find(o=>o.type==='barrel');barrel.x=boss.x+side*330;at(barrel.x+side*55);g.player.face=-side;g.punch();const hp=boss.hp;
  for(let i=0;i<60&&barrel.active;i++)g.barrelTick(barrel,1/60);
  assert.equal(barrel.active,false);assert.equal(barrel.vx,0);assert.equal(barrel.x,1000+side*273);assert.equal(boss.hp,hp-Math.round(g.barrelDamage()*1.5));
 }
});
test('A charging dozer detonates an unlit barrel without carrying it, including a swept crossing',()=>{
 for(const side of [-1,1]){
  const {g}=game();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:1000-side*400,previousX:1000+side*400,phase:'charge'});
  const barrel=g.props.find(o=>o.type==='barrel');barrel.x=1000;const hp=boss.hp;g.barrelTick(barrel,1/60);
  assert.equal(barrel.active,false);assert.equal(barrel.vx,0);assert.ok(boss.hp<hp);
 }
});
test('Arena barrels start outside the dozer and their fuse still works away from it',()=>{
 const {g}=game();g.loadRoom(4);const boss=g.enemies[0];for(const barrel of g.props.filter(o=>o.type==='barrel'))assert.ok(Math.abs(barrel.x-boss.x)>273);
 const barrel=g.props.find(o=>o.type==='barrel');barrel.x=400;barrel.fuse=.1;const hp=boss.hp;g.barrelTick(barrel,.2);assert.equal(barrel.active,false);assert.equal(boss.hp,hp);
});
test('Blast damage reaches the dozer surface without double counting its overlapping body boxes',()=>{
 const {g}=game();g.loadRoom(4);const boss=g.enemies[0];boss.phase='stunned';const hp=boss.hp;
 g.explode(boss.x-273,395);assert.equal(boss.hp,hp-6);g.explode(boss.x,360);assert.equal(boss.hp,hp-12);
 g.explode(boss.x-400,395);assert.equal(boss.hp,hp-12);
});

test('Every starting build uses the planned damage table against monsters, armor and exposed boiler',()=>{
 for(const [race,job] of [['human','brawler'],['human','saboteur'],['goblin','brawler'],['goblin','saboteur']]){
  for(const [source,base,ordinary,armored,weak] of [['punch',1,1,1,2],['donut',1,1,1,2],['explosion',4,4,3,6],['barrel',10,10,10,15]]){
   for(const [type,phase,expected] of [['llama','walk',ordinary],['boss','windup',armored],['boss','stunned',weak]]){
    const {g}=game(race,job);const e=g.spawnEnemy(900,type);e.phase=phase;const hp=e.hp;g.damage(e,base,source);assert.equal(hp-e.hp,expected,race+'/'+job+' '+source+' '+phase);
   }
  }
  const {g}=game(race,job);assert.equal(g.bombDamage(),4);assert.equal(g.barrelDamage(),10);
 }
});
test('Pushing a box stops the charging boss, deals ten damage and earns bounded planning credit',()=>{
 const {g,at,nodes}=game();nodes.get('coop').onclick();g.loadRoom(4);const boss=g.enemies[0];Object.assign(boss,{x:1100,previousX:1100,phase:'charge',vx:-345});
 const box=g.props.find(o=>o.type==='barrel');box.x=810;at(755);g.player.face=1;g.punch();g.barrelTick(box,.1);
 assert.equal(box.active,false);assert.equal(boss.hp,50);assert.equal(boss.phase,'stunned');assert.equal(boss.vx,0);assert.ok(boss.timer>=2);assert.equal(g.state.skills.intelligence.xp,3);assert.equal(g.state.fame,20);assert.equal(g.state.skills.strength.xp,0);
 const hp=boss.hp;g.barrelTick(box,1);assert.equal(boss.hp,hp);assert.equal(g.state.fame,20);
 g.explode(boss.x-273,395,142,{source:'barrel',planned:true});assert.equal(boss.hp,35);assert.equal(g.state.skills.intelligence.xp,3);assert.equal(g.state.fame,20);
});
test('Actual punches and spells train only their skill, with per-monster limits and increasing thresholds',()=>{
 for(const [source,name,other] of [['punch','strength','magic'],['donut','magic','strength']]){
  const {g}=game();const e=g.spawnEnemy(900);e.hp=100;
  for(let i=0;i<20;i++)g.damage(e,1,source);assert.equal(g.state.skills[name].xp,3);assert.equal(g.state.skills[other].xp,0);
  const second=g.spawnEnemy(1200);second.hp=100;for(let i=0;i<3;i++)g.damage(second,1,source);
  assert.equal(g.state.skills[name].rank,1);assert.equal(g.state.skills[name].xp,0);assert.equal(g.skillGoal(name),10);assert.equal(source==='punch'?g.punchDamage():g.magicDamage(),2);
  g.gainPractice(name,10);assert.equal(g.skillGoal(name),14);assert.equal(source==='punch'?g.punchDamage():g.magicDamage(),3);
  second.hp=0;g.damage(second,1,source);assert.equal(g.state.skills[name].xp,0);
 }
});
test('Missed punches, tutorial crates and Mordecai practice give no permanent skill or reward growth',()=>{
 const {g,at}=game();at(50);g.punch();g.player.cool=0;at(320);g.punch();assert.equal(g.state.skills.strength.xp,0);
 g.enterGuild();g.setLesson(2);at(630);g.punch();g.gainPractice('strength',100);g.gainPractice('intelligence',100);g.queueReward('boss');
 assert.equal(g.punchDamage(),1);assert.equal(g.state.pendingRewards.length,0);assert.equal(g.state.skills.strength.xp,0);g.leaveGuild();assert.equal(g.punchDamage(),1);
});
test('Distinct clever plays train intelligence with a room cap, while repeats do not farm stats or fame',()=>{
 const {g}=game();const int=g.state.int;
 g.award('barrel-test',20,'Setup',true);assert.equal(g.state.skills.intelligence.xp,3);g.award('barrel-test',20,'Setup',true);assert.equal(g.state.fame,20);
 g.award('pillar-test',15,'Support',true);g.award('snare-test',15,'Trap',true);assert.equal(g.state.int,int+1);assert.equal(g.state.skills.intelligence.rank,1);assert.equal(g.state.skills.intelligence.xp,0);
 g.award('other',5,'Other',true);assert.equal(g.state.skills.intelligence.xp,0);assert.equal(g.bombDamage(),4);assert.equal(g.barrelDamage(),10);
 g.state.int++;assert.equal(g.bombDamage(),5);assert.equal(g.barrelDamage(),12);
});
test('Major treasure offers all three choices, quality follows encounter, and each can be claimed once',()=>{
 for(const [kind,tier] of [['supply',1],['challenge',1],['boss',2]])for(const choice of ['carl','planning','donut']){
  const {g,nodes}=game();g.state.style.carl=5;g.queueReward(kind);const reward=g.state.pendingRewards[0];assert.equal(reward.tier,tier);assert.equal(g.mode,'reward');assert.equal(g.suggestedReward(),'carl');
  for(const key of ['carl','planning','donut'])assert.ok(nodes.get('reward-'+key).onclick);
  const str=g.state.str,int=g.state.int,magic=g.magicDamage();nodes.get('reward-'+choice).onclick();assert.equal(g.mode,'play');assert.equal(g.state.pendingRewards.length,0);assert.equal(g.state.items.length,1);
  assert.equal(g.state.str,str+(choice==='carl'?tier:0));assert.equal(g.state.int,int+(choice==='planning'?tier*2:0));assert.equal(g.magicDamage(),magic+(choice==='donut'?tier:0));
  g.claimReward(reward.id,choice);g.queueReward(kind);assert.equal(g.state.items.length,1);assert.equal(g.state.pendingRewards.length,0);
 }
});
test('Reward choices pause combat, can be deferred to inventory, and persist with room checkpoints',()=>{
 const {g,step,nodes}=game();g.queueReward('supply');const x=g.player.x;g.keys.add('KeyD');step(3);assert.equal(g.player.x,x);
 nodes.get('reward-later').onclick();assert.equal(g.mode,'play');g.loadRoom(1);g.inventory();nodes.get('bag-skills').onclick();nodes.get('pending-reward-0').onclick();assert.equal(g.mode,'reward');nodes.get('reward-planning').onclick();assert.equal(g.bombDamage(),5);
 g.retry();assert.equal(g.bombDamage(),4);assert.equal(g.state.pendingRewards.length,1);assert.equal(g.state.items.length,0);
 g.showReward('0:supply');g.claimReward('0:supply','donut');g.loadRoom(2);g.retry();assert.equal(g.magicDamage(),2);assert.equal(g.state.pendingRewards.length,0);assert.equal(g.state.items.length,1);
});
test('Enemy levels and health stay fixed when Carl grows; old saves acquire the new skill fields',()=>{
 const {g}=game();g.state.str+=100;g.state.int+=100;g.state.level=99;
 for(const [type,level,hp] of [['goblin',1,5],['llama',2,16],['boss',3,60]]){const e=g.spawnEnemy(1000,type);assert.equal(e.level,level);assert.equal(e.hp,hp);}
 const str=g.state.str;delete g.state.skills;delete g.state.pendingRewards;delete g.state.rewardClaims;delete g.state.style;delete g.state.items;delete g.state.baseInt;g.loadRoom(1);assert.equal(g.state.str,str);assert.equal(g.state.skills.strength.xp,0);assert.equal(g.state.pendingRewards.length,0);assert.ok(Number.isFinite(g.barrelDamage()));
});
test('Skill practice and enemy credit both reset on retry without erasing entry progress',()=>{
 const {g}=game();g.gainPractice('strength',4);g.loadRoom(1);g.damage(g.enemies[0],1,'punch');g.damage(g.enemies[0],1,'punch');assert.equal(g.punchDamage(),2);g.retry();assert.equal(g.punchDamage(),1);assert.equal(g.state.skills.strength.xp,4);assert.equal(g.enemies[0].practice,undefined);
});
test('A chain-triggered box keeps box damage, and damage is counted once for each explosion',()=>{
 const {g,step,nodes}=game();nodes.get('coop').onclick();g.loadRoom(4);const boss=g.enemies[0];const box=g.props.find(o=>o.type==='barrel');box.x=boss.x-275;
 g.explode(box.x,395);assert.equal(boss.hp,57);assert.equal(box.active,false);assert.equal(g.bombs[0].blast.source,'barrel');step(.15);assert.equal(boss.hp,47);assert.equal(boss.phase,'stunned');
});

test('Planner defaults to auto, obeys goal overrides and exposes its short plan',()=>{
 const {g,step}=game();g.loadRoom(1);g.player.x=600;g.cat.x=550;
 assert.equal(g.state.donutGoal,'auto');assert.ok(g.planDonut().steps.length>=2);
 g.setDonutGoal('stay');step(2);assert.equal(g.cat.plan.kind,'follow');assert.ok(g.enemies.every(e=>e.hp===e.max));
 g.setDonutGoal('attack');step(.02);assert.equal(g.cat.plan.kind,'attack');assert.equal(g.cat.plan.targetId,g.enemies[0].id);
 g.mark();g.mark();step(.02);assert.equal(g.cat.plan.targetId,g.enemies[1].id);
 g.enemies[1].hp=0;step(.02);assert.equal(g.cat.plan.targetId,g.enemies[0].id);
});
test('Auto plans around a prepared box then attacks an exposed boiler',()=>{
 const {g}=game();g.practice(4);const boss=g.enemies[0];
 assert.equal(g.planDonut().kind,'wait');boss.phase='stunned';boss.timer=4;
 assert.equal(g.planDonut().kind,'attack');assert.match(g.planDonut().reason,/Boiler/);
 g.setDonutGoal('stay');assert.equal(g.planDonut().kind,'follow');
});
test('Planner overrides attack orders to evade an imminent attack',()=>{
 const {g}=game();g.loadRoom(1);g.player.x=700;g.cat.x=730;g.setDonutGoal('attack');g.enemies[0].phase='windup';
 assert.equal(g.planDonut().kind,'evade');g.donutPlannerTick(.02);assert.ok(g.cat.vy<0);
 assert.equal(g.state.donutGoal,'attack');
});
test('Donut lures an actual goblin into a placed trap before firing',()=>{
 const {g,step}=game();g.loadRoom(1);g.enemies[1].hp=0;g.props.forEach(o=>o.active=false);g.player.x=540;g.cat.x=510;g.state.traps=1;g.placeSnare();
 const trap=g.props.find(o=>o.type==='snare');trap.arm=0;g.enemies[0].x=710;g.enemies[0].cool=3;
 assert.equal(g.planDonut().kind,'lure');step(4);assert.equal(trap.spent,true);assert.ok(g.state.seen.includes('snare1'));assert.ok(g.enemies[0].hp<5);assert.equal(g.state.specials.decoy,100);
});
test('A Bad Llama follows Donut through the snare instead of keeping ranged distance',()=>{
 const {g,step}=game();g.practice(2);g.player.x=440;g.cat.x=400;g.placeSnare();const trap=g.props.find(o=>o.type==='snare');trap.arm=0;g.enemies[0].cool=4;
 step(5);assert.equal(trap.spent,true);assert.ok(g.enemies[0].hp<16);
});
test('Player 2 takes over without losing Carl’s selected companion goal',()=>{
 const {g,nodes,step}=game();g.setDonutGoal('setup');nodes.get('coop').onclick();g.setDonutGoal('attack');step(.1);
 assert.equal(g.state.donutGoal,'setup');assert.equal(g.cat.plan,null);assert.equal(nodes.get('donut-goal').disabled,true);
 nodes.get('coop').onclick();step(.1);assert.ok(g.cat.plan);assert.equal(nodes.get('donut-goal').disabled,false);
});
test('Decoy retargets a winding-up truck, but cannot turn a charging truck',()=>{
 const {g}=game();g.practice(4);const e=g.enemies[0];e.phase='windup';e.timer=1;e.face=1;e.destination=1370;
 assert.equal(g.royalDecoy(),true);assert.equal(g.state.specials.decoy,0);g.dozerTick(e,.02);assert.equal(e.face,-1);assert.ok(e.destination<e.x);
 e.timer=0;g.dozerTick(e,.02);assert.equal(e.phase,'charge');const face=e.face,destination=e.destination;g.player.x=1600;g.state.specials.decoy=100;
 assert.equal(g.royalDecoy(),false);g.dozerTick(e,.02);assert.equal(e.face,face);assert.equal(e.destination,destination);assert.equal(g.state.specials.decoy,100);g.render();
});
test('Invalid specials keep their charge; a decoy lasts four play seconds and pause freezes it',()=>{
 const {g,step}=game();assert.equal(g.royalDecoy(),false);assert.equal(g.barefootBreaker(),false);assert.equal(g.state.specials.stomp,100);
 g.practice(2);g.setDonutGoal('stay');assert.equal(g.royalDecoy(),true);const life=g.decoy.life;g.pause();step(5);assert.equal(g.decoy.life,life);g.resume();step(4.2);assert.equal(g.decoy,null);
});
test('Stomp animates a leap, hits once on landing, and cannot recharge itself',()=>{
 const {g,step}=game();g.practice(4);g.props.forEach(o=>o.active=false);g.setDonutGoal('stay');const e=g.enemies[0];g.player.x=e.x-270;e.phase='intro';e.timer=10;
 assert.equal(g.barefootBreaker(),true);assert.equal(g.barefootBreaker(),false);assert.equal(g.state.specials.stomp,0);assert.equal(e.hp,60);step(.2);assert.ok(g.player.y<420);assert.equal(e.hp,60);
 g.pause();const y=g.player.y;step(1);assert.equal(g.player.y,y);g.resume();step(.4);assert.equal(e.hp,54);assert.equal(e.phase,'stunned');assert.equal(g.state.specials.stomp,0);assert.equal(g.player.stompActive,false);g.render();
 step(.2);assert.equal(e.hp,54);
});
test('Stomp damage scales with earned Strength but box damage remains larger at the start',()=>{
 const {g}=game();assert.equal(g.stompDamage(),6);assert.ok(g.barrelDamage()>g.stompDamage());g.state.str+=2;assert.equal(g.stompDamage(),10);
 g.practice(4);const e=g.enemies[0];e.phase='stunned';e.timer=4;g.damage(e,g.stompDamage(),'stomp');assert.equal(e.hp,51);
});
test('Charge uses actual damage, caps at 100, and ignores idle time, dead targets and guild practice',()=>{
 const {g,step}=game();g.state.specials={stomp:0,decoy:0};step(3);assert.equal(g.state.specials.decoy,0);
 g.loadRoom(1);g.damage(g.enemies[0],1000,'punch');assert.equal(g.state.specials.stomp,10);g.damage(g.enemies[0],1000,'punch');assert.equal(g.state.specials.stomp,10);
 g.chargeSpecials(999);assert.equal(g.state.specials.stomp,100);g.state.specials.stomp=0;g.enterGuild();g.state.specials.stomp=0;g.chargeSpecials(50);assert.equal(g.state.specials.stomp,0);assert.equal(g.barefootBreaker(),false);g.leaveGuild();assert.equal(g.state.specials.stomp,0);
});
test('Room retries restore charges and goal preferences, and clear active illusions',()=>{
 const {g}=game();g.setDonutGoal('setup');g.state.specials.stomp=40;g.loadRoom(2);g.player.x=400;g.cat.x=350;assert.equal(g.royalDecoy(),true);g.state.specials.stomp=0;g.setDonutGoal('attack');g.retry();
 assert.equal(g.state.specials.stomp,40);assert.equal(g.state.specials.decoy,100);assert.equal(g.state.donutGoal,'setup');assert.equal(g.decoy,null);
});

test('Special lessons refill practice charge, freeze on pause, and reset cleanly',()=>{
 const {g,step,press,nodes}=game();g.enterGuild();g.setLesson(7);
 assert.equal(nodes.get('decoy-button').disabled,false);assert.equal(nodes.get('stomp-button').disabled,true);
 press('KeyV');assert.ok(g.decoy);assert.equal(g.state.specials.decoy,0);g.pause();const life=g.decoy.life;step(2);assert.equal(g.decoy.life,life);g.resume();step(3);assert.equal(g.guild.done,true);assert.equal(g.state.specials.decoy,100);
 g.setLesson(7);assert.equal(g.guild.done,false);assert.equal(g.decoy,null);assert.equal(g.state.specials.decoy,100);
 g.setLesson(8);press('KeyF');step(.1);assert.equal(g.guild.done,false);assert.ok(g.player.stompActive);g.pause();const y=g.player.y;step(2);assert.equal(g.player.y,y);g.resume();step(1);assert.equal(g.guild.done,true);assert.equal(g.state.specials.stomp,100);
 press('KeyF');g.setLesson(9);assert.equal(g.player.stompActive,false);assert.equal(g.player.y,420);assert.equal(g.cat.plan,null);
});
test('Trap teamwork requires assigning the help goal and an actual lure, not just placing a trap',()=>{
 const {g,step,press,nodes}=game();g.enterGuild();g.setLesson(9);
 assert.equal(nodes.get('donut-goal').disabled,false);press('KeyT');step(5);assert.equal(g.guild.done,false);assert.equal(g.props.find(o=>o.type==='snare').spent,false);
 nodes.get('donut-goal').value='setup';nodes.get('donut-goal').onchange();step(4);assert.equal(g.guild.done,true);assert.equal(g.props.find(o=>o.type==='snare').spent,true);
 assert.ok(g.practiceTrace.events.some(e=>e.kind==='goal'&&e.goal==='setup'));
 g.setLesson(9);g.setDonutGoal('setup');step(4);assert.equal(g.guild.done,false);
});
test('Training restores real special charges, Donut goal, P2 control and progression on exit',()=>{
 const {g,step,press,nodes}=game();g.state.specials={stomp:17,decoy:31};g.setDonutGoal('stay');nodes.get('coop').onclick();const skills=JSON.stringify(g.state.skills);const str=g.state.str,int=g.state.int,xp=g.state.xp;
 g.enterGuild();assert.equal(g.coop,false);assert.equal(nodes.get('coop').disabled,true);nodes.get('coop').onclick();assert.equal(g.coop,false);
 g.setLesson(7);press('KeyV');step(2);g.setLesson(8);press('KeyF');step(1);g.setLesson(9);press('KeyT');press('KeyG');step(5);g.leaveGuild();
 assert.equal(g.coop,true);assert.equal(nodes.get('coop').disabled,false);assert.equal(g.state.specials.stomp,17);assert.equal(g.state.specials.decoy,31);assert.equal(g.state.donutGoal,'stay');assert.equal(g.decoy,null);
 assert.equal(JSON.stringify(g.state.skills),skills);assert.equal(g.state.str,str);assert.equal(g.state.int,int);assert.equal(g.state.xp,xp);assert.ok([7,8,9].every(n=>g.state.flags.lessons.includes(n)));
});
