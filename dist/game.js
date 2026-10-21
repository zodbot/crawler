/* Dungeon Broadcast. Fixed-step simulation, separate from canvas rendering.
   No accounts, remote inference, or runtime dependencies. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const canvas=$('game'), ctx=canvas.getContext('2d');
const W=1100,H=500,FLOOR=420,DT=1/60,SAVE='dungeon-broadcast-v1';
canvas.width=W*2;canvas.height=H*2;ctx.scale(2,2);
const CARL_HEIGHT=118, DOOR_HEIGHT=166, DOOR_OPENING=145;
const propScale={crate:1.3,barrel:1.5,chest:.88,gift:1.3,switch:1.3,wall:1.4,sign:1.25,junkheap:1.2};
const enemyScale={goblin:1.5,llama:1.15,boss:1.35};
const roomNames=['First hallway','Goblin ambush','Bad Llama den','Broadcast junction','the Murder Dozer'];
const keys=new Set(), pressed=new Set();
let s, p, cat, enemies=[], props=[], platforms=[], bombs=[], shots=[], hostile=[], particles=[], floats=[];
let mode='setup',camera=0,time=0,shake=0,toastTime=0,banterTime=0,checkpoint='',coop=false,sound=false,audio;
let race='human',job='brawler',aim=0,target=null,last=0,acc=0,enemyID=0,interactable=null,roomWidth=1650,lootIndex=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.abs(a.x-b.x);
const clone=o=>JSON.parse(JSON.stringify(o));
const alive=()=>enemies.filter(e=>e.hp>0);
const near=(o,d=85)=>dist(p,o)<d&&Math.abs(p.y-(o.y??FLOOR))<95;
function fresh(){return {race,job,str:(race==='human'?3:2)+(job==='brawler'?2:0),int:(race==='human'?3:4)+(job==='saboteur'?2:0),hp:6,maxHp:6,bombs:0,traps:0,potions:0,fame:0,room:0,seen:[],log:[],sponsor:false,cleared:[],flags:{},kills:0,smart:0,baseStr:(race==='human'?3:2)+(job==='brawler'?2:0),xp:0,level:1,donutMagic:1,upgrades:0};}
function startingStrength(state=s){return (state.race==='human'?3:2)+(state.job==='brawler'?2:0);}
function startingIntelligence(state=s){return (state.race==='human'?3:4)+(state.job==='saboteur'?2:0);}
function normalizeProgression(){
 s.baseStr??=startingStrength();s.baseInt??=startingIntelligence();s.xp??=0;s.level??=1;s.donutMagic??=1;s.upgrades??=0;
 s.skills??={};for(const name of ['strength','intelligence','magic'])s.skills[name]??={xp:0,rank:0};
 s.tacticRooms??={};s.style??={carl:0,planning:0,donut:0};s.pendingRewards??=[];s.rewardClaims??=[];s.items??=[];s.specials??={stomp:100,decoy:100};s.donutGoal??="auto";
}
// A small ground-truth planner: score feasible short action sequences, then
// execute the first action and reconsider every quarter second. No trained policy.
const DONUT_GOALS=['auto','attack','setup','stay'];
let decoy=null;
function setDonutGoal(goal){
 if(!DONUT_GOALS.includes(goal)||coop||(guild&&guild.lesson!==9)||mode!=='play')return;
 s.donutGoal=goal;if(guild){guild.commanded=goal==='setup';recordPractice('goal',{goal});}cat.plan=null;cat.planTime=0;syncTactics();canvas.focus({preventScroll:true});
}
function chargeSpecials(amount){if(guild||amount<=0)return;for(const name of ['stomp','decoy'])s.specials[name]=clamp(s.specials[name]+amount,0,100);}
function syncTactics(){
 if(!s?.specials)return;
 $('donut-goal').value=s.donutGoal;$('donut-goal').disabled=coop||!!(guild&&guild.lesson!==9)||mode!=='play';
 const intent=guild&&guild.lesson!==9?'Training with Mordecai':coop?'Player 2 is in control':cat?.plan?.reason||'Staying with Carl';
 if($('donut-intent').textContent!==intent)$('donut-intent').textContent=intent;
 for(const [name,label,key] of [['stomp','Barefoot Breaker','F'],['decoy','Royal Decoy','V']]){
  const button=$(name+'-button'),charge=Math.floor(s.specials[name]);
  button.textContent=key+' · '+label+' · '+(charge>=100?'READY':charge+'%');
  button.disabled=mode!=='play'||!!(guild&&guild.lesson!==(name==='decoy'?7:8))||charge<100;
 }
}
function selectedEnemy(){const choices=alive().filter(e=>dist(e,p)<850);return choices.find(e=>e.id===target)||choices.sort((a,b)=>dist(a,p)-dist(b,p))[0];}
function lureSpot(e){
 if(!e||e.type==='boss'||e.snared>0)return null;
 const trap=props.find(o=>o.type==='snare'&&o.active&&!o.spent&&o.arm<=0&&dist(o,e)<460);
 if(!trap)return null;const x=trap.x+(Math.sign(trap.x-e.x)||-1)*110;
 if(x<35||x>roomWidth-40||Math.abs(x-p.x)>390)return null;
 return {x,trapX:trap.x};
}
function setupBox(e){return e?.type==='boss'&&props.find(o=>o.type==='barrel'&&o.active&&o.x>Math.min(p.x,e.x)&&o.x<Math.max(p.x,e.x));}
function planDonut(){
 const e=selectedEnemy(),goal=s.donutGoal,follow=clamp(p.x-p.face*70,35,roomWidth-40);
 const plans=[{kind:'follow',x:follow,score:5,steps:['follow Carl','hold position'],reason:goal==='stay'?'Staying close · holding fire':'Staying with Carl'}];
 const add=(kind,x,score,steps,reason)=>plans.push({kind,x:clamp(x,Math.max(35,p.x-390),Math.min(roomWidth-40,p.x+390)),score:score-Math.abs(cat.x-x)*.008,targetId:e?.id,steps,reason});
 if(e&&goal!=='stay'){
  const weak=e.type==='boss'&&dozerWeak(e),trap=lureSpot(e),box=setupBox(e);
  const attackX=e.x+(Math.sign(p.x-e.x)||-1)*(e.type==='boss'?300:200);
  if(goal!=='setup'||weak||e.snared>0)add('attack',attackX,goal==='attack'?80:40,['approach target','cast','reassess'],e.snared>0?'Trap caught it · casting now':weak?'Boiler exposed · attacking!':target===e.id?'Attacking your marked target':'Target in sight · casting');
  if(trap&&goal!=='attack')add('lure',trap.x,90,['move beyond snare','lure monster across','attack once caught'],'Luring it across your snare');
  if(box&&!weak&&goal!=='attack')add('wait',follow,75,['wait for Carl to push box','attack exposed boiler'],'Push the box · I’ll attack when it stalls');
  if(goal==='setup'&&!trap&&!box&&!weak&&!(e.snared>0))add('wait',follow,50,['follow Carl','wait for a setup'],'Ready to help · place a snare or push a box');
 }
 const threat=alive().find(v=>dist(v,cat)<(v.type==='boss'?340:90)&&['charge','windup','slamWindup'].includes(v.phase));
 if(threat)add('evade',cat.x+(Math.sign(cat.x-threat.x)||-1)*160,180,['leave attack path','resume assigned goal'],'Dodging · then back to the plan');
 if(hostile.some(b=>dist(b,cat)<85&&Math.abs(b.y-(cat.y-30))<65))add('evade',follow,190,['jump over projectile','resume assigned goal'],'Dodging a projectile');
 return plans.sort((a,b)=>b.score-a.score)[0];
}
function donutPlannerTick(dt){
 cat.planTime=(cat.planTime||0)-dt;
 if(!cat.plan||cat.planTime<=0||cat.plan.targetId&&!alive().some(e=>e.id===cat.plan.targetId)){cat.plan=planDonut();cat.planTime=.25;}
 const plan=cat.plan,e=alive().find(e=>e.id===plan.targetId),delta=plan.x-cat.x;
 cat.vx=clamp(delta*4,-270,270);if(Math.abs(cat.vx)>10)cat.face=Math.sign(cat.vx);
 if(cat.onGround&&(p.y<cat.y-45||plan.kind==='evade'))cat.vy=-530;
 if(plan.kind==='attack'&&e&&dist(cat,e)<580)cast(e);
}
function enemyAim(e){
 if(decoy&&!decoy.used&&decoy.targetId===e.id)return decoy;
 if(!coop&&cat.plan?.kind==='lure'&&cat.plan.targetId===e.id&&lureSpot(e)&&Math.abs(cat.x-cat.plan.x)<45)return cat;
 return p;
}
function consumeDecoy(e){if(decoy?.targetId===e.id){decoy.used=true;decoy.life=Math.min(decoy.life,.6);}}
function royalDecoy(){
 if(mode!=='play'||(guild&&guild.lesson!==7)||s.specials.decoy<100||decoy)return false;
 const e=selectedEnemy();if(!e||dist(e,cat)>700){toast('ROYAL DECOY · BRING A MONSTER INTO RANGE');return false;}
 if(e.snared>0){toast('DECOY · WAIT UNTIL THE MONSTER IS FREE');return false;}
 if(e.type==='boss'&&!['walk','windup'].includes(e.phase)){toast('DECOY · USE BEFORE THE DOZER STARTS CHARGING');return false;}
 const trap=lureSpot(e),box=setupBox(e),side=Math.sign(p.x-e.x)||-1;
 const x=clamp(trap?trap.x:box?box.x+side*130:e.x+side*(e.type==='boss'?400:170),35,roomWidth-40);
 decoy={x,y:FLOOR,life:4,targetId:e.id,used:false};if(guild)recordPractice('special',{name:'decoy',targetId:e.id});s.specials.decoy=0;cat.planTime=0;
 bits(x,FLOOR-35,'#d9b7ff',24);beep(850,.22,'sine');say('Yoo-hoo! Over here, you spectacular idiot.');syncTactics();return true;
}
function stompDamage(){return 6+2*Math.max(0,s.str-s.baseStr);}
function barefootBreaker(){
 if(mode!=='play'||(guild&&guild.lesson!==8)||s.specials.stomp<100||p.stompActive)return false;
 if(!p.onGround||p.throwTime>0||p.drinkTime>0||aim){toast('BAREFOOT BREAKER · LAND AND FINISH YOUR ACTION FIRST');return false;}
 if(!alive().some(e=>Math.abs(e.x-p.x)<(e.type==='boss'?390:150))){toast('BAREFOOT BREAKER · GET CLOSER TO A MONSTER');return false;}
 s.specials.stomp=0;if(guild)recordPractice('special',{name:'stomp'});p.stompActive=true;p.vy=-350;p.onGround=false;p.attack=0;beep(200,.15,'triangle');syncTactics();return true;
}
function stompImpact(){
 p.stompActive=false;shake=9;p.cool=.4;p.stompWave=.5;
 bits(p.x,p.y-5,'#e6c291',30);beep(55,.3,'sawtooth');
 for(const e of alive()){
  const reach=e.type==='boss'?390:150;
  if(dist(p,e)>reach||Math.abs(p.y-e.y)>175)continue;
  damage(e,stompDamage(),'stomp',Math.sign(e.x-p.x)||p.face);
  if(e.hp>0){if(e.type==='boss')dozerStall(e,Math.max(dozerWeak(e)?e.timer:0,1));else{e.phase='recover';e.timer=1;e.vx=0;}}
 }
 float('BAREFOOT BREAKER',p.x,p.y-135,'#f1cc98');cat.planTime=0;
}
function specialTick(dt){
 if(decoy){decoy.life-=dt;if(decoy.life<=0||!alive().some(e=>e.id===decoy.targetId))decoy=null;}
 p.stompWave=Math.max(0,(p.stompWave||0)-dt);syncTactics();
}
function drawSpecials(){
 if(decoy){ctx.save();ctx.globalAlpha=Math.min(.65,decoy.life);ctx.shadowColor='#d4a4ff';ctx.shadowBlur=18;
  drawActor('donut',0,{x:decoy.x,y:decoy.y,face:1,onGround:true,vx:0,vy:0,cool:0});ctx.strokeStyle='#d6acff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(decoy.x,decoy.y-3,38,9,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
 if(p.stompWave>0){ctx.save();ctx.globalAlpha=p.stompWave*2;ctx.strokeStyle='#f3cd98';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(p.x,p.y-2,150*(1-p.stompWave/.5)+8,18,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
}

function punchDamage(){return Math.max(1,1+s.str-s.baseStr);}
function magicDamage(){return Math.max(1,s.donutMagic);}
function bombDamage(){return 4+Math.floor(Math.max(0,s.int-s.baseInt)/2);}
function barrelDamage(){return 10+2*Math.floor(Math.max(0,s.int-s.baseInt)/2);}
function skillGoal(name){return 6+4*s.skills[name].rank;}
function gainPractice(name,amount=1){
 if(guild||amount<=0)return;const skill=s.skills[name];skill.xp+=amount;
 while(skill.xp>=skillGoal(name)){
  skill.xp-=skillGoal(name);skill.rank++;
  if(name==='strength')s.str++;else if(name==='intelligence')s.int++;else s.donutMagic++;
  const label=name==='strength'?'STRENGTH':name==='intelligence'?'INTELLIGENCE':'DONUT MAGIC';
  float(label+' +1',p.x,p.y-145,name==='magic'?'#d6b3f3':'#f5cb8f');toast(label+' INCREASED · SUCCESSFUL PRACTICE');event(label+' +1 through successful practice');
 }
 sync();
}
function attackPractice(e,source){
 if(guild||e.training||!['punch','donut'].includes(source))return;
 const name=source==='punch'?'strength':'magic',style=source==='punch'?'carl':'donut';
 e.practice??={};const used=e.practice[name]||0,cap=e.type==='boss'?6:3;
 if(used>=cap)return;e.practice[name]=used+1;s.style[style]++;gainPractice(name);
}
function planningPractice(amount=1){
 if(guild)return;const used=s.tacticRooms[s.room]||0,earned=Math.min(amount,Math.max(0,6-used));
 if(!earned)return;s.tacticRooms[s.room]=used+earned;s.style.planning+=earned;gainPractice('intelligence',earned);
}
function gainXP(amount){
 if(guild)return;s.xp+=amount;float('+'+amount+' XP',p.x,p.y-145,'#b8cda1');
 while(s.xp>=s.level*12){s.level++;event('Crawler level '+s.level);toast('CRAWLER LEVEL '+s.level+' · SKILLS GROW THROUGH USE');}
 sync();
}
function applyUpgrade(who){
 if(mode!=='inventory'||guild||s.upgrades<1||!['carl','donut'].includes(who))return;
 s.upgrades--;if(who==='carl')s.str++;else s.donutMagic++;
 event('Used a power crystal on '+(who==='carl'?'Carl: punch +1':'Donut: magic +1'));sync();mode='play';inventory('skills');
}
function suggestedReward(){
 const entries=Object.entries(s.style).sort((a,b)=>b[1]-a[1]);return entries[0][1]>0&&entries[0][1]!==entries[1][1]?entries[0][0]:null;
}
function queueReward(kind){
 if(guild)return;const id=s.room+':'+kind;
 if(s.rewardClaims.includes(id))return;
 if(!s.pendingRewards.some(r=>r.id===id))s.pendingRewards.push({id,kind,tier:kind==='boss'?2:1});
 showReward(id);
}
function rewardOptions(r){return [
 {key:'carl',title:r.tier===2?'Champion’s training manual':'Brawler’s training manual',detail:'Strength +'+r.tier+' · punch '+punchDamage()+' → '+(punchDamage()+r.tier)},
 {key:'planning',title:r.tier===2?'Master demolition notes':'Demolition notes',detail:'Intelligence +'+(r.tier*2)+' · bomb '+bombDamage()+' → '+(bombDamage()+r.tier)+' · box '+barrelDamage()+' → '+(barrelDamage()+r.tier*2)},
 {key:'donut',title:r.tier===2?'Royal spell treat':'Enchanted spell treat',detail:'Donut magic +'+r.tier+' · spell '+magicDamage()+' → '+(magicDamage()+r.tier)}
 ];}
function showReward(id){
 if(guild||!['play','inventory','reward'].includes(mode))return;const r=s.pendingRewards.find(r=>r.id===id);if(!r)return;
 mode='reward';const recommended=suggestedReward();
 show('<div class="eyebrow">'+(r.tier===2?'BOSS TREASURE · RARE':'ENCOUNTER TREASURE · UNCOMMON')+'</div><h2>Choose one reward.</h2><p>A permanent upgrade. '+(recommended?'Your actions suggest a match; every option is available.':'Choose the ability you want to develop.')+'</p><div class="reward-options">'+rewardOptions(r).map(o=>'<button class="reward-card" id="reward-'+o.key+'"><small>'+({carl:'CARL',planning:'PLANNING',donut:'DONUT'}[o.key])+(recommended===o.key?' · MATCHES YOUR PLAY':'')+'</small><strong>'+o.title+'</strong><span>'+o.detail+'</span></button>').join('')+'</div><button class="quiet" id="reward-later">Choose later · keep in inventory</button>');
 for(const o of rewardOptions(r))$('reward-'+o.key).onclick=()=>claimReward(id,o.key);
 $('reward-later').onclick=resume;
}
function claimReward(id,choice){
 if(guild||mode!=='reward')return;const r=s.pendingRewards.find(r=>r.id===id);if(!r||!['carl','planning','donut'].includes(choice))return;
 const item=rewardOptions(r).find(o=>o.key===choice);s.pendingRewards=s.pendingRewards.filter(r=>r.id!==id);s.rewardClaims.push(id);
 if(choice==='carl')s.str+=r.tier;else if(choice==='planning')s.int+=r.tier*2;else s.donutMagic+=r.tier;
 s.items.push({name:item.title,kind:choice,tier:r.tier});event('Chose '+item.title+' from '+r.kind+' treasure');
 if(r.kind==='boss'){s.flags.bossLoot=true;s.flags.sponsorTitle={carl:'Heavyweight favorite',planning:'Demolition darling',donut:'Royal entourage'}[choice];}
 sync();resume();toast(item.title.toUpperCase()+' · UPGRADE APPLIED');
}

function dozerBoxes(e){return [{x:e.x,left:e.x-240,right:e.x+240,top:FLOOR-88},{x:e.x-e.face*25,left:e.x-e.face*25-57,right:e.x-e.face*25+57,top:FLOOR-154}];}
function solidDozer(a,oldX,oldY,moving=false){
 const radius=a===p?19:17,height=a===p?CARL_HEIGHT:58;
 for(const e of alive().filter(e=>e.type==='boss')){
  for(const b of dozerBoxes(e)){
   if(a.x+radius<=b.left||a.x-radius>=b.right||a.y<=b.top||a.y-height>=FLOOR)continue;
   if(oldY<=b.top+3&&a.vy>=0){a.y=b.top;a.vy=0;a.onGround=true;a.onDozer=e.id;continue;}
   if(oldY-height>=FLOOR-2&&a.vy<0){a.y=FLOOR+height;a.vy=0;continue;}
   const side=oldX<b.x?-1:1;a.x=side<0?b.left-radius:b.right+radius;a.vx=0;
   if(a===p&&moving){const hp=s.hp;hurt();if(s.hp<hp){a.knockTime=.3;a.knockVX=side*320;a.vy=-200;a.onGround=false;float('−1 HEART',a.x,a.y-135,'#ff927d');toast('HIT BY THE DOZER · −1 HEART');}}
   else if(a===cat&&!coop&&a.onGround){a.vy=-530;}
  }
 }
}

function beep(freq=220,dur=.08,type='square',vol=.035){if(!sound)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(40,freq/2),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}catch{}}
function say(text){$('banter').textContent='“'+text+'”';banterTime=5;}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');toastTime=3.3;}
function float(text,x,y,color='#ffbd79'){floats.push({text,x,y,life:1.4,color});}
function visualRandom(){if(!guild)return Math.random();guild.rng=(Math.imul(guild.rng||1,1664525)+1013904223)>>>0;return guild.rng/4294967296;}
function bits(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:(visualRandom()-.5)*230,vy:-visualRandom()*220,life:.4+visualRandom()*.5,color,size:3+visualRandom()*5});}
function event(text){s.log.push(text);}
function show(html){$('overlay').innerHTML='<div class="modal">'+html+'</div>';$('overlay').classList.remove('hidden');keys.clear();pressed.clear();aim=0;}
function hide(){ $('overlay').classList.add('hidden');$('overlay').innerHTML='';canvas.focus({preventScroll:true});keys.clear();pressed.clear();}
function save(){try{localStorage.setItem(SAVE,checkpoint);}catch{}}
function saved(){try{const v=JSON.parse(localStorage.getItem(SAVE));return v&&v.version===1&&v.state&&Number.isInteger(v.state.room)&&v.state.room>=0&&v.state.room<5?v:null;}catch{return null;}}
function sync(){
 syncTactics();
 actorPortrait('carl');$('potion-count').textContent=guild?'∞':(s.potions||0);$('potion-button').disabled=s.hp>=s.maxHp||!s.potions;
 $('upgrade-count').textContent=s.upgrades;$('trap-count').textContent=guild?'∞':s.traps??0;$('inventory-count').textContent=guild?'∞':s.bombs;$('inventory-status').textContent='LV '+s.level+' · XP '+s.xp+'/'+(s.level*12)+' · PUNCH '+punchDamage()+' · DONUT '+magicDamage();
 $('str').textContent=s.str;$('int').textContent=s.int;$('bombs').textContent=guild?'∞':s.bombs;
 $('player-name').textContent=s.race==='goblin'?'CARL · GOBLIN':'CARL';
 $('health').innerHTML=Array.from({length:s.maxHp},(_,i)=>'<span class="heart '+(i<s.hp?'':'empty')+'">♥</span>').join('');$('health').setAttribute('aria-label',s.hp+' of '+s.maxHp+' health');
 $('fame').textContent=s.fame+' POINTS';$('fame-fill').style.width=Math.min(100,s.fame/60*100)+'%';
 $('room-number').textContent=guild?'SAFE ZONE':'0'+(s.room+1)+' / 05';$('room-name').textContent=guild?'MORDECAI’S GUILDHALL':roomNames[s.room].toUpperCase();
 document.querySelectorAll('[data-room]').forEach(el=>{let r=+el.dataset.room;el.className=r===s.room?'active':s.cleared.includes(r)?'done':'';});
}
function award(key,amount,label,smart=false){
 if(guild||s.seen.includes(key))return;s.seen.push(key);s.fame+=amount;if(smart){s.smart++;chargeSpecials(15);planningPractice(key.startsWith('barrel')?3:key.startsWith('pillar')||key.startsWith('snare-combo')?2:1);}
 toast(label+'  ·  +'+amount+' AUDIENCE');beep(480,.16,'triangle');
 sync();
}
function inventory(view='supplies'){
 if(mode==='inventory'){resume();return;}if(mode!=='play')return;mode='inventory';
 if(view!=='skills')view='supplies';
 const count=n=>guild?'∞':n;
 const tabs='<div class="bag-tabs"><button class="quiet '+(view==='supplies'?'selected':'')+'" id="bag-supplies">Supplies</button><button class="quiet '+(view==='skills'?'selected':'')+'" id="bag-skills">Skills & rewards'+(s.pendingRewards.length?' · '+s.pendingRewards.length+' unclaimed':'')+'</button></div>';
 let content='';
 if(view==='supplies')content='<div class="bag-grid"><div class="inventory-item"><span class="bomb-symbol" aria-hidden="true"></span><strong>Bombs <b>× '+count(s.bombs)+'</b></strong><p>'+bombDamage()+' damage.<br>Hold K, release to throw.</p><kbd>K</kbd></div><div class="inventory-item"><span class="potion-symbol" aria-hidden="true">♥</span><strong>Potions <b>× '+count(s.potions)+'</b></strong><p>Heals 3 hearts.<br>Carry up to 3.</p><kbd>H</kbd></div><div class="inventory-item"><span class="trap-symbol" aria-hidden="true">⌁</span><strong>Trap kits <b>× '+count(s.traps)+'</b></strong><p>T places a snare.<br>E recovers unused traps.</p><kbd>T</kbd></div></div><p><b>Explosive box:</b> punch it toward a monster. '+barrelDamage()+' damage to the armored truck; '+Math.round(barrelDamage()*1.5)+' to its exposed boiler. A hit stalls it for at least 2 seconds.</p><p>Successful hits build skills. Open <b>Skills & rewards</b> to see progress and claim treasure.</p>';
 else{
  content='<div class="skill-list">'+[['strength','Carl · Strength',s.str],['intelligence','Carl · Intelligence',s.int],['magic','Donut · Magic',s.donutMagic]].map(([name,label,value])=>'<div class="skill-row"><strong>'+label+' '+value+'</strong><span>'+s.skills[name].xp+' / '+skillGoal(name)+' practice</span><progress max="'+skillGoal(name)+'" value="'+s.skills[name].xp+'"></progress></div>').join('')+'</div><p>Punches train Strength; spells train Magic; distinct clever plays train Intelligence. First increase: 6 practice, then 10, then 14. Each monster has a limit. Mordecai’s room gives no permanent growth.</p>';
  if(s.pendingRewards.length)content+='<div class="pending-rewards">'+s.pendingRewards.map((r,i)=>'<button class="quiet" id="pending-reward-'+i+'">Open '+(r.kind==='boss'?'rare boss':r.kind==='supply'?'supply cache':'arena')+' reward →</button>').join('')+'</div>';
  content+='<div class="upgrade-panel"><strong>Power crystals × '+s.upgrades+'</strong><div class="modal-actions"><button class="quiet" id="upgrade-carl" '+(!s.upgrades||guild?'disabled':'')+'>Carl · punch '+punchDamage()+' → '+(punchDamage()+1)+'</button><button class="quiet" id="upgrade-donut" '+(!s.upgrades||guild?'disabled':'')+'>Donut · magic '+magicDamage()+' → '+(magicDamage()+1)+'</button></div></div>';
  if(s.items.length)content+='<p class="claimed-items">Applied upgrades: '+s.items.map(i=>i.name).join(' · ')+'</p>';
 }
 show('<div class="eyebrow">CARL’S INVENTORY · GAME PAUSED</div><h2>What’s in the bag?</h2>'+tabs+'<p>Crawler level '+s.level+' · XP '+s.xp+' / '+(s.level*12)+' · Punch '+punchDamage()+' · Donut magic '+magicDamage()+'</p><div class="bag-stats">♥ '+s.hp+' / '+s.maxHp+' health <span>STR '+s.str+' · INT '+s.int+'</span></div>'+content+'<div class="modal-actions"><button class="primary" id="close-inventory">Back to the dungeon →</button><button class="quiet" id="bag-heal" '+(s.hp>=s.maxHp||!s.potions?'disabled':'')+'>Drink a potion · H</button></div>');
 $('bag-supplies').onclick=()=>{mode='play';inventory('supplies');};$('bag-skills').onclick=()=>{mode='play';inventory('skills');};
 if(view==='skills'){
  $('upgrade-carl').onclick=()=>applyUpgrade('carl');$('upgrade-donut').onclick=()=>applyUpgrade('donut');
  s.pendingRewards.forEach((r,i)=>$('pending-reward-'+i).onclick=()=>showReward(r.id));
 }
 $('close-inventory').onclick=resume;$('bag-heal').onclick=()=>{resume();drinkPotion();};
}

function dropItem(x,item,source){props.push({type:'pickup',item,x:clamp(x,35,roomWidth-45),y:FLOOR,active:true,delay:.35,pop:.55,source});}
function dropBombs(x,count,source){for(let i=0;i<count;i++)dropItem(x+(i-(count-1)/2)*45,'bomb',source);}
function dropMonsterLoot(e){if(e.type==='boss'){props.push({type:'chest',kind:'boss',x:clamp(e.x,100,roomWidth-230),y:FLOOR,active:true,pop:.65});bits(e.x,FLOOR-45,'#ffd17e',24);event('The boss dropped a treasure chest');}else{dropItem(e.x,e.loot||'bomb',e.type);event('Monster dropped '+(e.loot==='trap'?'a trap kit':e.loot==='potion'?'a health potion':'a bomb'));}}
function broadcastClear(){return s.room===1&&!alive().length;}
function drawBombIcon(x,y){rect(x-9,y-7,18,15,'#343947');rect(x-6,y-11,12,4,'#676b74');rect(x-5,y-5,5,5,'#9ca4ab');rect(x+1,y-16,5,6,'#c5a778');rect(x+4,y-18,6,3,'#f3cb87');}
function spawnEnemy(x,type='goblin'){const boss=type==='boss',llama=type==='llama';return {id:++enemyID,type,level:boss?3:llama?2:1,loot:boss?null:llama?'trap':['bomb','potion','trap'][lootIndex++%3],x,y:FLOOR,vx:0,vy:0,hp:boss?60:llama?16:5,max:boss?60:llama?16:5,face:-1,cool:1,phase:boss?'intro':'walk',timer:boss?3:0,hit:0,w:boss?480:llama?84:54,h:boss?168:llama?116:91,attacked:false};}
function loadRoom(index,{persist=true}={}){
 normalizeProgression();s.potions??=0;s.traps??=(index>=2?2:0);s.room=index;p={x:100,y:FLOOR,vx:0,vy:0,face:1,onGround:true,cool:0,attack:0,throwTime:0,drinkTime:0,knockTime:0,knockVX:0,inv:0};cat={x:55,y:FLOOR,vx:0,vy:0,cool:0,onGround:true,face:1};
 decoy=null;enemies=[];props=[];platforms=[];bombs=[];shots=[];hostile=[];particles=[];floats=[];camera=0;target=null;aim=0;roomWidth=1650;lootIndex=0;
 const prop=(type,x,extra={})=>props.push({type,x,y:FLOOR,active:true,...extra});
 if(index===0){prop('guildDoor',250);prop('crate',370,{loot:1});prop('crate',870);platforms=[{x:570,y:365,w:150},{x:1090,y:330,w:160}];prop('door',1510,{label:'FIRST BROADCAST'});say('That warm door says Guildmaster. Someone in there might know what you are doing.');}
 if(index===1){enemies=[spawnEnemy(770),spawnEnemy(1090)];prop('barrel',640);prop('chest',1370,{kind:'bombs'});prop('door',1550,{label:'BAD LLAMA DEN'});platforms=[{x:780,y:310,w:145}];say('Goblins on foot. Defeat them, Carl. I want to see what falls out.');}
 if(index===2){enemies=[spawnEnemy(680,'llama')];prop('crate',1080);prop('wall',880);prop('chest',1000,{kind:'supply'});prop('door',1510,{label:'BROADCAST JUNCTION'});platforms=[{x:720,y:325,w:135}];say('A Bad Llama. Set a trap, Carl. I refuse to be spat on for ratings.');}
 if(index===3){prop('guildDoor',170);prop('door',345,{label:'BOSS ARENA'});prop('arenaGate',570);prop('trap',860);prop('barrel',690);prop('chest',1210,{kind:'challenge'});platforms=[{x:940,y:305,w:130}];if(s.flags.challengeStarted&&!s.flags.challengeCleared){enemies=[spawnEnemy(780),spawnEnemy(1080),spawnEnemy(1290)];}say('Boss entrance on the left. Optional fame on the right. I know which looks better on camera.');}
 if(index===4){p.x=380;cat.x=315;camera=315;roomWidth=1750;enemies=[spawnEnemy(1130,'boss')];prop('barrel',710);prop('barrel',1470);prop('support',455);prop('support',1370);prop('stairs',1610);dropPotion(320,'arena');say('The Murder Dozer. Watch its headlights, Carl. Then make it regret having a boiler.');}
 // Discard old sponsor deliveries when migrating existing checkpoints.
 s.sponsor=false;delete s.flags.giftPending;
 if(persist){checkpoint=JSON.stringify({version:1,state:clone(s)});save();}
 sync();
}
function setup(){mode='setup';s=fresh();loadRoom(0,{persist:false});const hasSave=!!saved();show('<div class="eyebrow">YOU HAVE BEEN SELECTED</div><h2>Make an entrance.</h2><p>Be Carl. Break things. Let Donut take the credit. Choose your starting style—every combination can finish the floor.</p><div class="selections"><div><span class="select-label">01 / RACE</span><div class="options"><button class="option selected" data-race="human"><strong>Human</strong><small>STR 3 · INT 3</small></button><button class="option" data-race="goblin"><strong>Goblin</strong><small>STR 2 · INT 4</small></button></div></div><div><span class="select-label">02 / CLASS</span><div class="options"><button class="option selected" data-job="brawler"><strong>Brawler</strong><small>+2 STR · stronger knockback</small></button><button class="option" data-job="saboteur"><strong>Saboteur</strong><small>+2 INT · rewire traps</small></button></div></div></div><div class="loadout"><span id="loadout">STRENGTH 5 · INTELLIGENCE 3</span><span>♥ 6 health · Donut on your team</span></div><div class="modal-actions"><button class="primary" id="start">Enter the dungeon →</button>'+(hasSave?'<button class="quiet" id="continue">Continue saved floor →</button>':'<small>No timer. Room checkpoints.<br>Your own bombs won’t hurt you.</small>')+'</div><button class="quick-encounter quiet" id="try-encounter">Skip the tutorial · try the goblin ambush →</button><button class="quick-encounter quiet" id="try-traps">Practice traps · face the Bad Llama →</button><button class="quick-encounter quiet" id="try-boss">Try the Murder Dozer boss →</button>');
 document.querySelectorAll('[data-race]').forEach(b=>b.onclick=()=>{race=b.dataset.race;updateChoice();});document.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>{job=b.dataset.job;updateChoice();});
 $('start').onclick=()=>{s=fresh();mode='play';loadRoom(0);hide();toast('A / D TO MOVE · FIND MORDECAI’S WARM DOOR');};
 $('try-encounter').onclick=()=>{s=fresh();s.bombs=1;s.cleared=[0];mode='play';loadRoom(1);p.x=420;cat.x=360;hide();toast('GOBLIN ENCOUNTER · ONE BOMB IN YOUR INVENTORY');};
 $('try-traps').onclick=()=>practice(2);$('try-boss').onclick=()=>practice(4);
 if(hasSave)$('continue').onclick=()=>{s=saved().state;race=s.race;job=s.job;mode='play';loadRoom(s.room);hide();toast('Room checkpoint restored');};updateChoice();
}
function updateChoice(){document.querySelectorAll('[data-race]').forEach(b=>b.classList.toggle('selected',b.dataset.race===race));document.querySelectorAll('[data-job]').forEach(b=>b.classList.toggle('selected',b.dataset.job===job));const st=fresh();$('loadout').textContent='STRENGTH '+st.str+' · INTELLIGENCE '+st.int;}
function pause(help=false){if(mode!=='play')return;mode='pause';show('<div class="eyebrow">BROADCAST PAUSED</div><h2>'+ (help?'A little field guide.':'Take a breath.')+'</h2><p>No timer. Think through your next move. Your own explosions never hurt you.</p><div class="help-grid"><span><kbd>A D</kbd> Move Carl</span><span><kbd>SPACE</kbd> Jump / dodge projectiles</span><span><kbd>J</kbd> Punch · push barrels</span><span><kbd>T</kbd> Place a snare · E recovers it</span><span><kbd>K</kbd> Hold to aim, release to throw</span><span><kbd>E</kbd> Open / use / enter a door</span><span><kbd>Q</kbd> Mark a target for Donut</span><span><kbd>I</kbd> Open inventory · pauses the game</span><span><kbd>H</kbd> Drink a health potion</span><span><kbd>P / ESC</kbd> Pause / resume</span><span><kbd>E</kbd> Rewire nearby traps as a Saboteur</span></div><p>Donut plans automatically. G changes her goal; Q marks a target. F uses Barefoot Breaker; V creates a Royal Decoy before a charge. Both start ready. Damage restores 2% charge per point; unique clever plays restore 15%. Mordecai has dedicated lessons for both specials and Donut’s trap goal; practice charges refill. In two-player mode: Carl uses A/D and Space; Donut uses ←/→, ↑ to jump, and / to cast. Stay within the same screen.</p><div class="modal-actions"><button class="primary" id="resume">Back to the show →</button><button class="quiet" id="retry">Restart this room</button></div>');$('resume').onclick=resume;$('retry').onclick=retry;}
function resume(){if(mode==='pause'||mode==='inventory'||mode==='reward'){mode='play';hide();}}
function retry(){if(guild){mode='play';hide();setLesson(guild.lesson);return;}if(!checkpoint)return;s=JSON.parse(checkpoint).state;mode='play';loadRoom(s.room);hide();toast('Room restarted · entry supplies restored');}
function hurt(){if(guild||p.inv>0||mode!=='play')return;if(p.drinkTime>0){p.drinkTime=0;toast('DRINK INTERRUPTED · POTION SAVED');}s.hp--;p.inv=1.5;shake=5;bits(p.x,p.y-30,'#e98770',8);beep(100,.17,'sawtooth');sync();if(s.hp<=0){mode='dead';show('<div class="eyebrow">A TEMPORARY INTERRUPTION</div><h2>You’re not cancelled. Yet.</h2><p>Restart this room with the health, upgrades, and supplies you had when you entered. Try a jump, a trap, or a different plan.</p><button class="primary" id="retry">Try the room again →</button><button class="quiet" id="retry-training">Practice with Mordecai</button>');$('retry').onclick=retry;$('retry-training').onclick=()=>{retry();enterGuild();};say('A rehearsal. Obviously. Nobody broadcast that.');}}
function damage(e,amount,source='punch',direction=p.face){if(e.hp<=0)return;
 if(guild&&e.training){e.hit=.2;bits(e.x,e.y-60,'#dec591',8);const match=guild.lesson===2&&source==='punch'||guild.lesson===3&&source==='explosion'||guild.lesson===6&&source==='donut'&&target===e.id||guild.lesson===8&&source==='stomp';if(match)lessonSuccess();return;}

 if(e.type==='boss'&&source!=='environment'){
  if(dozerWeak(e))amount=Math.round(amount*(source==='punch'||source==='donut'?2:1.5));
  else if(!['barrel','stomp'].includes(source))amount=Math.max(1,amount-1);
 }
 amount=Math.max(1,Math.round(amount));
 float('−'+amount+(e.type==='boss'&&!dozerWeak(e)&&!['barrel','stomp','environment'].includes(source)?' · ARMOR':''),e.x,e.y-e.h-8,source==='donut'?'#d4acf7':'#ffd19c');
 attackPractice(e,source);if(source!=='stomp')chargeSpecials(2*Math.min(e.hp,amount));
 e.hp-=amount;e.hit=.14;if(e.type!=='boss'&&!(e.snared>0)){e.vx=direction*(s.job==='brawler'?290:200);e.x=clamp(e.x+direction*12,30,roomWidth-35);}bits(e.x,e.y-e.h/2,source==='donut'?'#bfa0f5':'#d9a479',5);
 if(source==='punch'){e.punched=time;if(e.type!=='boss')for(const other of enemies){if(other!==e&&other.hp>0&&Math.abs(other.x-e.x)<70){damage(other,1,'collision',direction);award('collision'+s.room,15,'MONSTER DOMINOES',true);}}}
 if((source==='explosion'||source==='barrel')&&e.snared>0)award('snare-combo'+s.room,20,'PLANNED TO PERFECTION',true);
 if(source==='donut'&&e.punched&&time-e.punched<3)award('team'+s.room,12,'TEAMWORK MAKES GOOD TELEVISION',true);
 if(e.hp<=0){e.hp=0;s.kills++;gainXP(e.type==='boss'?12:e.type==='llama'?6:3);if(e.type==='llama'){dropItem(e.x+52,'upgrade','llama');event('Defeated the Bad Llama');say('Appalling manners. Excellent target practice.');}dropMonsterLoot(e);bits(e.x,e.y-e.h/2,e.type==='boss'?'#ffb36d':'#a4bf8a',22);beep(170,.18);if(source==='explosion'||source==='barrel'||source==='trap')award(source+s.room,20,source==='trap'?'MIND YOUR STEP!':'EXPLOSIVE ENTRANCE',true);if(e.type==='boss'){s.flags.bossDead=true;s.hp=s.maxHp;award('boss',25,'BOSS DOWN · TREASURE EARNED');event('Defeated the Murder Dozer');say('I did the difficult part. You may carry the chest.');}sync();}
}
function punch(){if(p.stompActive||p.cool>0||p.throwTime>0||p.drinkTime>0||aim>0)return;p.cool=.34;p.attack=.18;beep(140,.05,'triangle');
 const close=alive().filter(e=>dist(p,e)<88&&Math.abs(p.y-e.y)<70).sort((a,b)=>dist(p,a)-dist(p,b))[0];if(close)p.face=Math.sign(close.x-p.x)||p.face;
 for(const e of alive())if(dist(p,e)<(e.type==='boss'?270:92)&&Math.abs(p.y-e.y)<(e.type==='boss'?175:70)&&(e.x-p.x)*p.face>-20)damage(e,punchDamage(),'punch',p.face);
 for(const o of props){if(!o.active||!near(o,90)||(o.x-p.x)*p.face<-22)continue;if(o.type==='crate'){o.active=false;bits(o.x,o.y-20,'#a17a50',14);award('crate',5,'CAMERA TEST COMPLETE');if(o.loot)dropBombs(o.x,o.loot,'crate');}if(o.type==='barrel'){o.pushed=true;o.vx=p.face*(s.job==='brawler'?390:290);o.fuse=o.fuse??1.5;toast('BARREL LIT · MOVE IT INTO POSITION');}}
}
// A shared launch/flight model keeps the dotted preview and released bomb aligned.
function bombLaunch(power,actor=p){return {x:actor.x+actor.face*35,y:actor.y-121,vx:actor.face*(190+power*140),vy:-170-power*70,fuse:1.45};}
function bombMotion(b,dt){b.vy+=750*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.y>FLOOR-10){b.y=FLOOR-10;b.vy*=-.35;b.vx*=.65;}if(b.x<15||b.x>roomWidth-15){b.vx*=-.5;b.x=clamp(b.x,15,roomWidth-15);}}
function throwBomb(){if(p.stompActive){aim=0;return;}if(!aim)return;if(s.bombs>0&&p.throwTime<=0){s.bombs--;p.throwTime=.44;p.attack=0;p.cool=.44;bombs.push(bombLaunch(clamp(aim,0,1)));beep(270,.08,'triangle');sync();}else if(!s.bombs)toast('No bombs · collect monster loot or open a chest');aim=0;}
function explode(x,y,r=142,{source='explosion',planned=true}={}){shake=8;bits(x,y,'#ffb267',40);particles.push({x,y,vx:0,vy:0,life:.3,color:'#ffe0a0',radius:r});beep(70,.3,'sawtooth',.08);let hits=0;const power=source==='barrel'?barrelDamage():bombDamage();
 for(const e of alive())if(e.type==='boss'?dozerBoxes(e).some(b=>Math.hypot(x-clamp(x,b.left,b.right),y-clamp(y,b.top,FLOOR))<r):Math.hypot(e.x-x,e.y-25-y)<r){const charging=e.type==='boss'&&e.phase==='charge';damage(e,power,source,Math.sign(e.x-x)||1);hits++;
  if(source==='barrel'&&e.type==='boss'){
   if(e.hp>0){e.cycles=(e.cycles||0)+(charging?1:0);dozerStall(e,Math.max(dozerWeak(e)?e.timer:0,2));}
   if(planned)award('barrel-boss'+s.room,20,charging?'CHARGE STOPPED · EXPLOSIVE AMBUSH':'EXPLOSIVE SETUP · BOILER EXPOSED',true);
  }
 }
 if(source==='barrel'&&hits&&planned&&s.room!==4)award('barrel-hit'+s.room,15,'EXPLOSIVE SETUP',true);
 if(hits>1){award('multi'+s.room,25,'MULTI-HIT MAYHEM',true);say('An actual plan! I shall revise my expectations.');}
 for(const o of props){if(!o.active||Math.abs(o.x-x)>r)continue;if(o.type==='barrel'){o.active=false;setExplosion(o.x,o.y-25,{source:'barrel',planned});award('chain'+s.room,15,'CHAIN REACTION',true);}if(o.type==='wall'){o.active=false;s.flags.wallOpen=true;event('Spent an explosive to open the supply cache');bits(o.x,o.y-70,'#748087',35);award('wall',12,'A NEW OPENING',true);say('Subtle. I believe the wall has accepted your argument.');}if(o.type==='crate'){o.active=false;bits(o.x,o.y-20,'#a17a50',12);if(o.loot)dropBombs(o.x,o.loot,'crate');}}
}
// Sweep relative motion so either the barrel or the dozer can cause impact.
function barrelTick(o,dt){
 if(!o.active)return;
 const oldX=o.x,radius=22*propScale.barrel;
 if(o.vx){o.x=clamp(o.x+o.vx*dt,35,roomWidth-35);o.vx*=.987;}
 for(const e of alive().filter(e=>e.type==='boss')){
  const before=oldX-(e.previousX??e.x),after=o.x-e.x,edge=e.w/2+radius;
  if(Math.min(before,after)>edge||Math.max(before,after)<-edge)continue;
  const side=before<0?-1:1;o.x=e.x+side*edge;o.vx=0;o.active=false;
  explode(o.x,o.y-25,142,{source:'barrel',planned:!!o.pushed||e.phase==='charge'});return;
 }
 if(o.fuse!=null){o.fuse-=dt;if(o.fuse<=0){o.active=false;o.vx=0;explode(o.x,o.y-25,142,{source:'barrel',planned:!!o.pushed});}}
}
function setExplosion(x,y,blast={source:'barrel',planned:true}){bombs.push({x,y,vx:0,vy:0,fuse:.12,fixed:true,blast});}
function cast(preferred=null){if(cat.cool>0)return;const choices=alive().filter(e=>dist(cat,e)<600);const e=choices.find(e=>e.id===preferred?.id)||choices.find(e=>e.id===target)||choices.sort((a,b)=>dist(cat,a)-dist(cat,b))[0];if(!e){if(coop)toast('Donut needs a monster in range');return;}cat.cool=1.5;cat.face=Math.sign(e.x-cat.x)||1;const dx=e.x-cat.x,dy=e.y-e.h/2-(cat.y-23),len=Math.hypot(dx,dy)||1;shots.push({damage:magicDamage(),x:cat.x,y:cat.y-23,vx:dx/len*420,vy:dy/len*420,life:1.7});beep(660,.12,'sine',.025);}
function mark(){const list=alive().filter(e=>dist(e,p)<650).sort((a,b)=>a.x-b.x);if(!list.length){toast('No monsters nearby to target');return;}const i=list.findIndex(e=>e.id===target);target=list[(i+1)%list.length].id;cat.planTime=0;toast('TARGET MARKED · DONUT WILL PRIORITIZE IT');}
function interaction(){
 let list=props.filter(o=>o.active&&near(o,o.type==='stairs'?100:82));
 if(s.room===3&&!s.flags.challengeStarted&&!s.flags.challengeCleared)list=list.filter(o=>o.type!=='trap');
 list=list.filter(o=>o.type!=='snare'||!o.spent);
 const order={guildExit:-3,mentor:-2,planningDesk:-2,guildDoor:-1,snare:-1,chest:1,trap:3,door:4,stairs:4,wall:5};list=list.filter(o=>order[o.type]!==undefined).sort((a,b)=>(order[a.type]-order[b.type])||dist(p,a)-dist(p,b));return list[0]||null;
}
function promptFor(o){if(!o)return '';if(o.type==='guildDoor')return 'E · Enter Mordecai’s guildhall';if(o.type==='guildExit')return 'E · Return to the hallway';if(o.type==='mentor')return 'E · Ask Mordecai / choose a lesson';if(o.type==='planningDesk')return 'E · Plan for the boss / save practice record';if(o.type==='snare')return 'E · Recover unused trap'+(o.arm>0?' · arming…':' · armed');if(o.type==='door'){if(s.room===1&&!broadcastClear())return 'Defeat the goblin guards';if(s.room===1&&!s.flags.bombsChest)return 'E at the stash chest · collect your loot';if(s.room===1&&props.some(v=>v.active&&v.type==='pickup'&&v.source==='cargo'))return 'Walk over the dropped stash bombs to collect them';if(s.room===2&&alive().some(e=>e.type==='llama'))return 'Defeat the Bad Llama to clear the den';if(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared)return 'Finish the challenge to open the door';return 'E · '+(s.room===3&&!s.flags.challengeStarted?'Skip challenge → boss arena':'Enter '+o.label.toLowerCase());}
 if(o.type==='chest'){if(o.open)return s.pendingRewards.some(r=>r.id===s.room+':'+o.kind)?'I · Choose your saved treasure reward':'';if(o.kind==='bombs'&&!broadcastClear())return 'Stash locked · defeat the goblin guards';if(o.kind==='supply'&&!s.flags.wallOpen)return 'Cracked wall · hold K to aim a bomb, release to throw';if(o.kind==='challenge'&&!s.flags.challengeCleared)return 'Win the optional fight to unlock';if(o.kind==='boss'&&!s.flags.bossDead)return 'Boss reward · defeat the Murder Dozer';return 'E · Open '+(o.kind==='supply'?'supply cache':'loot chest');}
 if(o.type==='trap')return s.job==='saboteur'?(o.rewired?'Trap rewired · monsters only':'E · Rewire trap · make it safe for Carl'):'Floor trap · lure monsters here, then jump';if(o.type==='wall')return 'Cracked wall · a bomb could reveal supplies';if(o.type==='stairs')return s.flags.bossLoot?'E · Descend the stairs':s.flags.bossDead?'Open the boss chest before descending':'Stairs sealed · defeat the boss';return '';}
function use(){if(mode!=='play')return;const o=interaction();if(!o)return;if(o.type==='guildDoor'){enterGuild();return;}if(o.type==='snare'&&!o.spent){o.active=false;s.traps++;sync();toast('UNUSED TRAP RECOVERED');return;}if(o.type==='door'){
 if((s.room===1&&(!s.flags.bombsChest||!broadcastClear()||props.some(v=>v.active&&v.type==='pickup'&&v.source==='cargo')))||(s.room===2&&alive().some(e=>e.type==='llama'))||(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared)){toast(promptFor(o));return;}
 if(s.room===2&&!s.flags.wallOpen)event('Kept bombs instead of opening the supply cache');if(s.room===3&&!s.flags.challengeStarted){s.flags.skippedChallenge=true;event('Skipped the optional optional fight');}
 packTraps();s.cleared.push(s.room);s.hp=Math.min(s.maxHp,s.hp+1);loadRoom(s.room+1);toast('ROOM CHECKPOINT · +1 HEALTH');return;}
 if(o.type==='chest'&&!o.open){if(o.kind==='bombs'&&!broadcastClear()||o.kind==='supply'&&!s.flags.wallOpen||o.kind==='challenge'&&!s.flags.challengeCleared||o.kind==='boss'&&!s.flags.bossDead){toast(promptFor(o));return;}o.open=true;beep(720,.2,'triangle');bits(o.x,o.y-40,'#ffd17e',16);
 if(o.kind==='bombs'){dropBombs(o.x,2,'cargo');s.traps+=2;s.flags.bombsChest=true;toast('2 TRAP KITS STOWED · COLLECT THE BOMBS');say('Traps! A plan you can put on the floor. Press T to place one.');event('Looted two snare trap kits from the goblin stash');}
 if(o.kind==='supply'){dropPotion(o.x,'supply');s.hp=Math.min(s.maxHp,s.hp+2);s.flags.supplyLoot=true;event('Opened the supply cache');queueReward('supply');}
 if(o.kind==='challenge'){dropPotion(o.x+55,'challenge');dropBombs(o.x,2,'challenge');s.hp=Math.min(s.maxHp,s.hp+1);toast('ARENA STASH · 2 BOMBS TO PICK UP · HEAL +1');event('Collected the optional fight reward');queueReward('challenge');}
 if(o.kind==='boss'){s.bombs+=1;event('Opened the boss treasure');queueReward('boss');}
 sync();return;}
 if(o.type==='trap'&&s.job==='saboteur'&&!o.rewired){o.rewired=true;award('rewire'+s.room,12,'TRAP REWIRED',true);event('Rewired a floor trap');}
 if(o.type==='stairs'&&s.flags.bossLoot)finish();
}
function finish(){packTraps();s.cleared.push(4);mode='win';try{localStorage.removeItem(SAVE);}catch{}sync();show('<div class="eyebrow">FLOOR 01 CLEARED · BROADCAST COMPLETE</div><h2>Going down. Ratings going up.</h2><p>Carl and Donut take the stairs. Your next-floor loadout is ready. This prototype ends here—the next floor is still backstage.</p><div class="result-grid"><div><strong>'+s.str+' / '+s.int+'</strong><small>STRENGTH / INTELLIGENCE</small></div><div><strong>'+s.fame+'</strong><small>AUDIENCE POINTS</small></div><div><strong>'+s.bombs+'</strong><small>BOMBS CARRIED DOWN</small></div></div><p><b>'+s.flags.sponsorTitle+'</b><br>'+(s.flags.wallOpen?'You opened the supply cache.':'You saved your explosives in the supply room.')+' '+(s.flags.challengeCleared?'You won the optional fight.':'You took the safer route to the boss.')+'</p><div class="modal-actions"><button class="primary" id="again">Try another build →</button><button class="quiet" id="export">Save run summary ↓</button></div>');$('again').onclick=setup;$('export').onclick=exportRun;say('I accept your applause. Carl is also here.');}
function exportRun(){const report={game:'Dungeon Broadcast',floor:1,race:s.race,class:s.job,strength:s.str,intelligence:s.int,health:s.hp,bombs:s.bombs,traps:s.traps,potions:s.potions,audience:s.fame,level:s.level,xp:s.xp,punchDamage:punchDamage(),donutMagic:magicDamage(),powerCrystals:s.upgrades,skills:s.skills,items:s.items,pendingRewards:s.pendingRewards,decisions:s.log};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='dungeon-broadcast-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function physics(a,dt){const old=a.y,oldX=a.x;a.onDozer=null;a.vy+=1250*dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.onGround=false;if(a.y>=FLOOR){a.y=FLOOR;a.vy=0;a.onGround=true;}for(const f of platforms){if(a.x>f.x-10&&a.x<f.x+f.w+10&&old<=f.y+2&&a.y>=f.y&&a.vy>=0){a.y=f.y;a.vy=0;a.onGround=true;}}solidDozer(a,oldX,old);a.x=clamp(a.x,30,roomWidth-40);}
function tick(dt){if(mode==='play'||mode==='setup')time+=dt;if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').classList.remove('show');}if(mode!=='play'){syncTactics();pressed.clear();return;}if(guild){tickGuild(dt);return;}simulationTick++;shake=Math.max(0,shake-30*dt);specialTick(dt);if(pressed.has('KeyG'))setDonutGoal(DONUT_GOALS[(DONUT_GOALS.indexOf(s.donutGoal)+1)%DONUT_GOALS.length]);if(pressed.has('KeyF'))barefootBreaker();if(pressed.has('KeyV'))royalDecoy();banterTime-=dt;potionTick(dt);if(pressed.has('KeyH'))drinkPotion();shake=Math.max(0,shake-30*dt);p.cool=Math.max(0,p.cool-dt);p.attack=Math.max(0,p.attack-dt);p.throwTime=Math.max(0,(p.throwTime||0)-dt);p.inv=Math.max(0,p.inv-dt);cat.cool=Math.max(0,cat.cool-dt);
 let move=(keys.has('KeyD')||!coop&&keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||!coop&&keys.has('ArrowLeft')?1:0);p.knockTime=Math.max(0,(p.knockTime||0)-dt);p.vx=p.knockTime>0?p.knockVX:move*(p.stompActive?70:p.drinkTime>0?75:keys.has('KeyK')?120:245);if(move&&p.throwTime<=0)p.face=move;
 if((pressed.has('Space')||!coop&&pressed.has('ArrowUp')||pressed.has('KeyW'))&&p.onGround&&!p.stompActive){p.vy=-540;beep(260,.09,'triangle');}
 physics(p,dt);if(p.stompActive&&p.onGround)stompImpact();if(keys.has('KeyJ'))punch();if(keys.has('KeyK')&&!p.stompActive&&p.throwTime<=0&&!p.drinkTime)aim=clamp(aim+dt,.02,1);else if(aim)throwBomb();if(pressed.has('KeyQ'))mark();if(pressed.has('KeyT'))placeSnare();if(pressed.has('KeyE')){use();if(mode!=='play'){syncTactics();pressed.clear();return;}}
 if(coop){const cm=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);cat.vx=cm*265;if(cm)cat.face=cm;if(pressed.has('ArrowUp')&&cat.onGround)cat.vy=-520;if(keys.has('Slash'))cast();}
 else donutPlannerTick(dt);
 physics(cat,dt);cat.x=clamp(cat.x,Math.max(25,p.x-430),Math.min(roomWidth-25,p.x+430));
 for(const e of alive()){e.hit=Math.max(0,e.hit-dt);e.cool-=dt;e.timer-=dt;e.previousX=e.x;
 if(e.snared>0){e.snared=Math.max(0,e.snared-dt);e.vx=0;if(e.snared===0){e.phase='walk';e.cool=1;}continue;}
 if(e.type==='llama'){llamaTick(e,dt);continue;}
 if(e.type==='boss'){dozerTick(e,dt);continue;}
 if(e.phase==='arriving'){physics(e,dt);if(e.onGround){e.phase='walk';e.vx=0;}continue;}
 const victim=enemyAim(e);
 if(e.phase==='windup'){e.vx=0;if(e.timer<=0){consumeDecoy(e);if(dist(e,p)<77&&Math.abs(p.y-e.y)<65)hurt();e.phase='recover';e.timer=.6;}}
 else if(e.phase==='recover'){if(e.timer<=0)e.phase='walk';e.vx*=.85;}
 else if(Math.abs(e.vx)>130){e.vx*=.9;}
 else if(dist(e,victim)<600){e.face=Math.sign(victim.x-e.x)||1;if(dist(e,victim)<61&&Math.abs(victim.y-e.y)<65){e.phase='windup';e.timer=.65;e.vx=0;}else e.vx=e.face*58;}
 else e.vx=0;
 e.x=clamp(e.x+e.vx*dt,40,roomWidth-70);
 }
 for(const o of props){if(!o.active)continue;
 if(o.pop>0)o.pop=Math.max(0,o.pop-dt);if(o.type==='snare')snareTick(o,dt);
 if(o.type==='pickup'){o.delay-=dt;if(o.delay<=0&&near(o,34)&&(o.item!=='potion'||s.potions<3)){o.active=false;const kind=o.item==='potion'?'POTION':o.item==='trap'?'TRAP KIT':o.item==='upgrade'?'POWER CRYSTAL':'BOMB';if(o.item==='potion')s.potions++;else if(o.item==='trap')s.traps++;else if(o.item==='upgrade')s.upgrades++;else s.bombs++;float('+1 '+kind,p.x,p.y-130,o.item==='potion'?'#e8b0bd':o.item==='trap'?'#c1d6a0':'#f5cf8f');toast(o.item==='upgrade'?'POWER CRYSTAL · I TO CHOOSE CARL OR DONUT':kind+' COLLECTED');beep(780,.12,'triangle');sync();$('inventory-button').classList.add('collected');}}

 if(o.type==='barrel')barrelTick(o,dt);
 if(o.type==='trap'){const active=Math.sin(time*2.3)>-.1;o.firing=active;if(active){if(near(o,43)&&p.y>FLOOR-35&&!o.rewired)hurt();for(const e of alive())if(dist(e,o)<50&&!e.trapCooldown){damage(e,3,'trap',Math.sign(e.x-o.x)||1);e.trapCooldown=1.2;}}}
 }
 for(const e of enemies)if(e.trapCooldown)e.trapCooldown=Math.max(0,e.trapCooldown-dt);
 for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.fuse-=dt;if(!b.fixed)bombMotion(b,dt);if(b.fuse<=0){bombs.splice(i,1);explode(b.x,b.y,142,b.blast);}}
 hostileTick(dt);
 for(let i=shots.length-1;i>=0;i--){const b=shots[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;const e=alive().find(e=>Math.abs(e.x-b.x)<e.w/2+10&&b.y>e.y-e.h-10&&b.y<e.y+8);if(e){damage(e,b.damage??magicDamage(),'donut',Math.sign(b.vx));b.life=0;}if(b.life<=0)shots.splice(i,1);}
 if(s.room===3&&!s.flags.challengeStarted&&p.x>560)startChallenge();
 if(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared&&!alive().length){s.flags.challengeCleared=true;award('challenge',25,'BROADCAST CHALLENGE COMPLETE');say('Naturally they loved us. Open our tribute.');}
 for(const a of particles){a.life-=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.vy+=400*dt;}particles=particles.filter(a=>a.life>0);for(const f of floats){f.y-=24*dt;f.life-=dt;}floats=floats.filter(f=>f.life>0);
 const bossView=s.room===4?alive().find(e=>e.type==='boss'):null;let cameraGoal=p.x-W*.35;if(bossView)cameraGoal=clamp((p.x+bossView.x+220)/2-W/2,p.x-W+70,p.x-70);camera+=(clamp(cameraGoal,0,roomWidth-W)-camera)*Math.min(1,dt*7);
 interactable=interaction();const text=promptFor(interactable);$('prompt').textContent=text;$('prompt').style.display=text?'block':'none';pressed.clear();
}
function practice(room){s=fresh();s.potions=2;s.bombs=3;s.traps=2;s.cleared=Array.from({length:room},(_,i)=>i);s.flags.bombsChest=true;mode='play';loadRoom(room);p.x=room===2?400:600;cat.x=p.x-60;camera=clamp(p.x-W*.35,0,roomWidth-W);hide();toast('PRACTICE LOADOUT · 3 BOMBS · 2 SNARE TRAPS');}
function placeSnare(){
 if(mode!=='play')return;if(!p.onGround||p.y!==FLOOR){toast('Place traps on the dungeon floor');return;}
 if(props.some(o=>o.type==='snare'&&o.active&&!o.spent)){toast('One active snare · use E to recover it first');return;}
 if(s.traps<=0){toast('No trap kits · loot the goblin stash');return;}
 s.traps--;props.push({type:'snare',x:p.x,y:FLOOR,active:true,arm:1,spent:false});sync();beep(310,.1,'triangle');toast('SNARE ARMING · LURE A MONSTER OVER IT');
}
function packTraps(){for(const o of props)if(o.type==='snare'&&o.active&&!o.spent){s.traps++;o.active=false;}}
function snareTick(o,dt){
 if(o.spent){o.life-=dt;if(o.life<=0)o.active=false;return;}if(o.arm>0){o.arm=Math.max(0,o.arm-dt);return;}
 const e=alive().find(e=>e.type!=='boss'&&Math.abs(e.y-o.y)<28&&(Math.abs(e.x-o.x)<36||Math.min(e.previousX??e.x,e.x)<=o.x&&Math.max(e.previousX??e.x,e.x)>=o.x));
 if(!e)return;consumeDecoy(e);cat.planTime=0;if(guild&&(guild.lesson===4||guild.lesson===9&&guild.commanded&&cat.plan?.kind==='lure'&&cat.plan.targetId===e.id))lessonSuccess();o.spent=true;o.life=2;e.snared=e.type==='boss'?1.5:2+s.int*.15;e.vx=0;e.phase=e.type==='boss'?'stunned':'recover';e.timer=e.snared;
 bits(o.x,o.y-10,'#b8d6a0',12);float('SNARED!',e.x,e.y-e.h-15,'#badbab');award('snare'+s.room,15,'A LITTLE FORWARD PLANNING',true);event('Caught '+(e.type==='boss'?'the Murder Dozer':e.type==='llama'?'a Bad Llama':'a goblin')+' in a placed snare');
}
function llamaTick(e,dt){
 const victim=enemyAim(e);e.face=Math.sign(victim.x-e.x)||1;
 if(victim!==p&&e.phase==='walk'&&dist(e,victim)>60){e.vx=e.face*85;e.x=clamp(e.x+e.vx*dt,40,roomWidth-70);return;}
 if(e.phase==='windup'){e.vx=0;if(e.timer<=0){const x=e.x+e.face*58,y=e.y-96,dx=victim.x-x,dy=victim.y-35-y,len=Math.hypot(dx,dy)||1;hostile.push({type:'spit',x,y,vx:dx/len*310,vy:dy/len*310,life:3});consumeDecoy(e);e.phase='recover';e.timer=.6;e.cool=1.4;beep(170,.08,'sawtooth',.02);}return;}
 if(e.phase==='recover'){if(e.timer<=0)e.phase='walk';return;}
 const d=dist(e,victim);if(d>620){e.vx=0;return;}if(e.cool<=0){e.phase='windup';e.timer=.8;return;}
 e.vx=d<210?-e.face*100:d>370?e.face*70:0;e.x=clamp(e.x+e.vx*dt,200,roomWidth-220);
}
function hostileTick(dt){
 for(let i=hostile.length-1;i>=0;i--){const b=hostile[i];b.life-=dt;b.vy+=(b.gravity||0)*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
 if(b.type==='spit'){const cover=props.find(o=>o.active&&(o.type==='crate'||o.type==='wall')&&Math.abs(o.x-b.x)<27&&b.y>o.y-(o.type==='wall'?168:56)&&b.y<o.y);if(cover){b.life=0;bits(b.x,b.y,'#b5c68b',5);}}
 if(b.life>0&&Math.abs(b.x-p.x)<(b.type==='junk'?30:23)&&b.y>p.y-CARL_HEIGHT+8&&b.y<p.y+5){hurt();b.life=0;bits(b.x,b.y,b.type==='spit'?'#a7bf78':'#a79d80',7);}
 if(b.y>=FLOOR-4){if(b.type==='junk'){bits(b.x,FLOOR-9,'#a69c86',10);if(Math.abs(p.x-b.x)<40&&p.y>FLOOR-35)hurt();}b.life=0;}
 if(b.life<=0||b.x<0||b.x>roomWidth)hostile.splice(i,1);
 }
}
// Canvas art is deliberately drawn on a coarse pixel grid.
function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function text(t,x,y,size=12,color='#d9cebb',align='center'){ctx.fillStyle=color;ctx.font=`${size}px monospace`;ctx.textAlign=align;ctx.fillText(t,Math.round(x),Math.round(y));}
function arch(x,y,w,h){rect(x-12,y+25,w+24,h-25,'#303943');rect(x,y+30,w,h-30,'#101923');rect(x+12,y+13,w-24,18,'#101923');rect(x+28,y,w-56,16,'#101923');rect(x-8,y+29,9,h-29,'#434b50');rect(x+w,y+29,8,h-29,'#242e39');for(let j=0;j<5;j++){rect(x-12,y+55+j*37,13,4,'#17232d');rect(x+w,y+55+j*37,13,4,'#17232d');}}
function torch(x,y){rect(x-3,y,7,33,'#67564a');rect(x-8,y+4,17,8,'#343039');const flick=Math.sin(time*12+x)*3;ctx.fillStyle='#ffa55712';ctx.beginPath();ctx.arc(x,y-9,55+flick,0,Math.PI*2);ctx.fill();rect(x-8,y-21+flick,16,25,'#e77d49');rect(x-4,y-26-flick,9,23,'#ffb86c');rect(x-2,y-12,6,15,'#ffe6a6');}
function banner(x,label,color='#764442'){rect(x,111,73,109,color);rect(x+5,116,63,88,'#00000018');rect(x+8,220,57,6,color);rect(x+17,226,39,6,color);rect(x+26,232,21,6,color);rect(x-7,107,87,6,'#927756');text(label,x+36,162,22,'#e2bd87');}
const floorLooks=[
 {name:'Dungeon entrance',wall:'#282f30',brick:'#373c39',accent:'#b1946a',floor:'#47463b'},
 {name:'Goblin workshop',wall:'#302820',brick:'#443c30',accent:'#c58952',floor:'#4e483d'},
 {name:'Bad Llama stable',wall:'#302d23',brick:'#41402e',accent:'#b9a16c',floor:'#4b4935'},
 {name:'Broadcast chambers',wall:'#262532',brick:'#393346',accent:'#b593b5',floor:'#494050'},
 {name:'Dozer machinery bay',wall:'#252c2e',brick:'#374246',accent:'#d3a96b',floor:'#494d4e'}
];
const backgroundDefinitions=[
 {src:'assets/hallway-entrance.png',ground:.87},
 {src:'assets/hallway-workshop.png',ground:.85},
 {src:'assets/hallway-stable.png',ground:.89},
 {src:'assets/hallway-broadcast.png',ground:.935},
 {src:'assets/hallway-machinery.png',ground:.92}
];
const backgroundImages=[];
function loadBackgroundImages(){
 if(typeof Image==='undefined')return;
 canvas.dataset.hallwayArt='loading';let finished=0,failed=false;
 backgroundDefinitions.forEach((def,i)=>{
  const img=new Image();img.decoding='async';
  img.onload=()=>{backgroundImages[i]=img;if(++finished===backgroundDefinitions.length&&!failed)canvas.dataset.hallwayArt='ready';};
  img.onerror=()=>{failed=true;canvas.dataset.hallwayArt='fallback';};
  img.src=def.src;
 });
}
function paintedBackground(){
 const img=backgroundImages[s.room];if(!img)return false;
 const def=backgroundDefinitions[s.room],theme=floorLooks[s.room];
 const travel=Math.max(0,roomWidth-W),width=W+travel*.35;
 const ground=img.naturalHeight*def.ground;
 ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(img,0,0,img.naturalWidth,ground,-camera*.35,0,width,FLOOR);
 // Keep the painted stone lip aligned exactly with the walkable ground.
 ctx.drawImage(img,0,ground,img.naturalWidth,img.naturalHeight-ground,-camera*.35,FLOOR,width,H-FLOOR);
 const shade=ctx.createLinearGradient(0,0,0,FLOOR);shade.addColorStop(0,'#05081022');shade.addColorStop(.6,'#05081000');shade.addColorStop(1,'#05081033');ctx.fillStyle=shade;ctx.fillRect(0,0,W,FLOOR);
 const depth=ctx.createLinearGradient(0,FLOOR,0,H);depth.addColorStop(0,'#090b1000');depth.addColorStop(1,'#090b10bb');ctx.fillStyle=depth;ctx.fillRect(0,FLOOR,W,H-FLOOR);
 ctx.fillStyle=theme.accent+'77';ctx.fillRect(0,FLOOR,W,1.5);
 for(let i=0;i<18;i++){const x=((i*157.7+Math.sin(time*.2+i)*15-camera*.2)%W+W)%W,y=65+(i*73.1)%330;ctx.fillStyle='#ead8b51c';ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill();}
 ctx.restore();return true;
}
function background(){if(guild){drawGuildBackground();return;}if(paintedBackground())return;const theme=floorLooks[s.room];
 const sky=ctx.createLinearGradient(0,0,0,FLOOR);sky.addColorStop(0,'#101518');sky.addColorStop(1,theme.wall);ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let row=0;row<7;row++)for(let col=-2;col<12;col++){
  const x=col*134+(row%2?67:0)-(camera*.28%134),y=22+row*60;
  ctx.fillStyle=theme.brick;ctx.beginPath();ctx.roundRect(x,y,130,55,4);ctx.fill();
  ctx.strokeStyle='#d3bb8c0c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+6,y+4);ctx.lineTo(x+122,y+4);ctx.stroke();
  ctx.strokeStyle='#080c1233';ctx.beginPath();ctx.moveTo(x+17,y+17);ctx.lineTo(x+27,y+31);ctx.lineTo(x+23,y+42);ctx.stroke();
 }
 for(let i=0;i<6;i++){
  const x=i*330-100-camera*.5;arch(x,120,130,290);rect(x+12,153,106,253,'#0b131acc');
  if(s.room===2){for(let k=0;k<5;k++){rect(x+13+k*24,205,7,210,'#5d4b37');rect(x+15+k*24,207,2,205,'#94755055');}rect(x+7,270,119,11,'#766047');rect(x+7,360,119,11,'#766047');}
  if(s.room===1||s.room===4){rect(x+25,194,78,201,'#1c2326');for(let j=0;j<6;j++)rect(x+30,204+j*27,66,8,'#080f1455');}
 }
 if(s.room===1||s.room===4){
  const metal=ctx.createLinearGradient(0,72,0,91);metal.addColorStop(0,'#7e7b69');metal.addColorStop(.5,'#4b504a');metal.addColorStop(1,'#242d30');ctx.fillStyle=metal;ctx.fillRect(0,72,W,19);
  for(let i=0;i<8;i++){const x=i*190-camera*.65;rect(x,69,9,25,'#736f5d');rect(x+2,71,2,20,'#d7c49655');}
  for(let i=0;i<5;i++){const x=240+i*400-camera*.65;rect(x,77,15,230,'#444d46');ctx.strokeStyle='#a78657';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x+7,239,21,0,Math.PI*2);ctx.moveTo(x-13,239);ctx.lineTo(x+27,239);ctx.moveTo(x+7,219);ctx.lineTo(x+7,259);ctx.stroke();}
 }
 if(s.room===1){for(let i=0;i<6;i++){const x=120+i*340-camera*.8;rect(x,349,105,9,'#796144');rect(x+8,358,7,60,'#484238');rect(x+92,358,7,60,'#484238');for(let j=0;j<4;j++){ctx.save();ctx.translate(x+18+j*21,337);ctx.rotate((j-1)*.3);rect(-5,-13,10,26,'#7d7b67');ctx.restore();}}}
 if(s.room===2){for(let i=0;i<14;i++){const x=i*137-camera*.8;ctx.strokeStyle='#95805166';ctx.lineWidth=2;for(let j=0;j<12;j++){ctx.beginPath();ctx.moveTo(x+j*5,414);ctx.lineTo(x+j*5+12,399+(j%4)*4);ctx.stroke();}}}
 for(let i=0;i<7;i++){
  const x=i*310+150-camera*.75;rect(x,45,22,375,s.room===4?'#4c5350':'#42443b');rect(x+2,47,3,372,'#c2b98d22');
  if(s.room===4){rect(x-12,337,46,65,'#a1884f');for(let k=0;k<4;k++){ctx.save();ctx.beginPath();ctx.rect(x-12,337,46,65);ctx.clip();ctx.translate(x-22+k*22,337);ctx.rotate(.45);ctx.fillStyle='#1e2729';ctx.fillRect(0,-20,11,110);ctx.restore();}}
  torch(x+10,192);
 }
 if(s.room===3){banner(230-camera*.7,'', '#63485f');banner(870-camera*.7,'','#514b6b');}
 const fog=ctx.createLinearGradient(0,260,0,FLOOR);fog.addColorStop(0,'#10162000');fog.addColorStop(1,'#0d171c99');ctx.fillStyle=fog;ctx.fillRect(0,260,W,160);
 rect(0,FLOOR,W,H-FLOOR,theme.floor);rect(0,FLOOR,W,6,theme.accent);rect(0,FLOOR+7,W,9,'#182225');
 for(let i=-1;i<16;i++){const x=i*95-camera%95;rect(x,FLOOR+18,91,34,theme.brick);rect(x+4,FLOOR+20,83,2,'#ffffff0c');}
 for(let i=0;i<30;i++){const x=(i*157.7+Math.sin(time*.2+i)*15-camera*.2)%W,y=75+(i*73.1)%335;ctx.fillStyle='#dbcaa025';ctx.beginPath();ctx.arc(x,y,1,0,Math.PI*2);ctx.fill();}
}

function pixelSprite(rows,palette,x,y,scale=3,flip=false){ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip)ctx.scale(-1,1);const w=rows[0].length;for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){const color=palette[rows[r][c]];if(color)rect((c-w/2)*scale,r*scale,scale,scale,color);}ctx.restore();}
const monsterSprite=['.....rrrrr......','....rrrrrrr.....','g..ggggggggg..g.','.ggggggggggggg..','..ggwggggwggg...','...gggnggggg....','....gkkwggg.....','....hhhhhh......','...hhhbhhhh.....','..gghhbhhhgg....','..gghhbhhhgg....','....bbbbbb......','....bb..bb......','...ggg..ggg.....'];
// Display-only character art. Feet remain anchored to the simulation positions;
// the larger silhouettes do not change reach, collision, or platform movement.
// Generated animation atlases are visual assets only; simulation and collision stay unchanged.
const actorDefinitions = {"carl":{"src":"assets/carl-atlas.png","scale":0.235,"portrait":[136,10,116,118],"frames":[{"sx":22,"sy":12,"sw":274,"sh":505,"anchorX":168,"anchorY":494},{"sx":343,"sy":12,"sw":353,"sh":506,"anchorX":205,"anchorY":496},{"sx":737,"sy":12,"sw":316,"sh":501,"anchorX":192,"anchorY":489},{"sx":1106,"sy":12,"sw":332,"sh":505,"anchorX":191,"anchorY":494},{"sx":18,"sy":559,"sw":347,"sh":491,"anchorX":199,"anchorY":477},{"sx":355,"sy":550,"sw":341,"sh":399,"anchorX":227,"anchorY":385},{"sx":737,"sy":564,"sw":324,"sh":486,"anchorX":198,"anchorY":475},{"sx":1088,"sy":571,"sw":349,"sh":478,"anchorX":226,"anchorY":468}]},"donut":{"src":"assets/donut-atlas.png","scale":0.15,"portrait":[302,77,191,222],"frames":[{"sx":36,"sy":78,"sw":455,"sh":396,"anchorX":264,"anchorY":393},{"sx":527,"sy":87,"sw":463,"sh":386,"anchorX":285,"anchorY":383},{"sx":1031,"sy":81,"sw":481,"sh":391,"anchorX":293,"anchorY":387},{"sx":26,"sy":543,"sw":492,"sh":392,"anchorX":284,"anchorY":388},{"sx":532,"sy":537,"sw":526,"sh":327,"anchorX":280,"anchorY":321},{"sx":1056,"sy":543,"sw":471,"sh":401,"anchorX":278,"anchorY":396}]},"carlThrow":{"src":"assets/carl-throw-atlas.png","scale":0.176,"frames":[{"sx":18,"sy":180,"sw":481,"sh":704,"anchorX":262,"anchorY":688},{"sx":507,"sy":145,"sw":500,"sh":739,"anchorX":271,"anchorY":722},{"sx":1007,"sy":215,"sw":528,"sh":669,"anchorX":313,"anchorY":652}]},"mordecai":{"src":"assets/mordecai-atlas.png","scale":0.113,"frames":[{"sx":40,"sy":0,"sw":680,"sh":1010,"anchorX":450,"anchorY":974},{"sx":730,"sy":0,"sw":780,"sh":1010,"anchorX":440,"anchorY":974}]},"dozer":{"src":"assets/dozer-atlas.png","scale":0.32,"frames":[{"sx":30,"sy":0,"sw":1470,"sh":515,"anchorX":750,"anchorY":486},{"sx":30,"sy":519,"sw":1480,"sh":501,"anchorX":750,"anchorY":475}]},"goblin":{"src":"assets/goblin-atlas.png","scale":0.19,"frames":[{"sx":100,"sy":0,"sw":320,"sh":515,"anchorX":150,"anchorY":505},{"sx":590,"sy":0,"sw":370,"sh":515,"anchorX":180,"anchorY":505},{"sx":1080,"sy":0,"sw":390,"sh":515,"anchorX":195,"anchorY":506},{"sx":40,"sy":530,"sw":430,"sh":474,"anchorX":230,"anchorY":455},{"sx":525,"sy":530,"sw":540,"sh":474,"anchorX":250,"anchorY":455},{"sx":1070,"sy":530,"sw":410,"sh":474,"anchorX":210,"anchorY":455}]},"llama":{"src":"assets/llama-atlas.png","scale":0.235,"frames":[{"sx":170,"sy":0,"sw":480,"sh":512,"anchorX":210,"anchorY":503},{"sx":875,"sy":0,"sw":535,"sh":512,"anchorX":245,"anchorY":498},{"sx":130,"sy":515,"sw":560,"sh":491,"anchorX":235,"anchorY":467},{"sx":800,"sy":530,"sw":690,"sh":474,"anchorX":275,"anchorY":449}]}};
const actorImages = {};
function carlFrame(player, now) {
 if(player.attack > .125) return 6;
 if(player.attack > 0) return 7;
 if(player.cool > .10) return 6;
 if(!player.onGround) return 5;
 return Math.abs(player.vx)>10 ? [1,2,3,4][Math.floor(now*9)%4] : 0;
}
function donutFrame(companion, now) {
 if(companion.cool>1.25) return 5;
 if(!companion.onGround) return 4;
 return Math.abs(companion.vx)>10 ? [1,2,3,2][Math.floor(now*10)%4] : 0;
}
function actorPortrait(name) {
 const image=actorImages[name],el=$(name+'-portrait');if(!image||!actorDefinitions[name].portrait||!el?.getContext)return;
 const c=el.getContext('2d'),[x,y,w,h]=actorDefinitions[name].portrait;
 c.clearRect(0,0,el.width,el.height);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
 c.filter=name==='carl'&&s?.race==='goblin'?'hue-rotate(55deg)':'none';c.drawImage(image,x,y,w,h,0,0,el.width,el.height);c.filter='none';
}
function loadActorImages() {
 if(typeof Image==='undefined')return;
 canvas.dataset.characterArt='loading';let loaded=0,failed=false;
 for(const name of Object.keys(actorDefinitions)){
  const img=new Image();img.decoding='async';
  img.onload=()=>{actorImages[name]=img;actorPortrait(name);loaded++;if(loaded===Object.keys(actorDefinitions).length&&!failed)canvas.dataset.characterArt='ready';};
  img.onerror=()=>{failed=true;canvas.dataset.characterArt='fallback';toast('Character art could not load. The game is still playable.');};
  img.src=actorDefinitions[name].src;
 }
}
function drawActor(name,index,actor) {
 const image=actorImages[name];if(!image)return false;
 const def=actorDefinitions[name],f=def.frames[index],scale=def.scale;
 ctx.save();ctx.translate(actor.x,actor.y);ctx.scale(actor.face,1);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 if(name==='carl'||name==='carlThrow'){
  if(p.inv>0&&Math.floor(time*12)%2)ctx.globalAlpha=.35;
  if(s.race==='goblin')ctx.filter='hue-rotate(55deg)';
 }
 // Idle breath is a tiny height change around the feet, never a positional bob.
 const breathing=index===0?1+Math.sin(time*2.1)*.005:1;
 ctx.drawImage(image,f.sx,f.sy,f.sw,f.sh,-f.anchorX*scale,-f.anchorY*scale*breathing,f.sw*scale,f.sh*scale*breathing);
 ctx.restore();return true;
}
function actorShadow(actor,width){ctx.save();ctx.fillStyle='#0006';ctx.beginPath();ctx.ellipse(actor.x,actor.y-1,width,4,0,0,Math.PI*2);ctx.fill();ctx.restore();}
function carlThrowFrame(player=p,aiming=aim,stock=s.bombs){
 if(player.throwTime>0)return player.throwTime>.25?1:2;
 return aiming>0&&stock>0?0:-1;
}
function drawCarl(){
 if(!actorImages.carl){drawCarlFallback();return;}
 actorShadow(p,24);const throwing=carlThrowFrame();
 if(throwing>=0&&actorImages.carlThrow)drawActor('carlThrow',throwing,p);else drawActor('carl',carlFrame(p,time),p);
 if(throwing===0){drawBombIcon(p.x-p.face*20,p.y-114);}

 if(p.attack>0&&p.attack<=.125){ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.face,1);ctx.strokeStyle='#ffe3b877';ctx.lineWidth=2;ctx.beginPath();ctx.arc(38,-84,17,-.65,.65);ctx.stroke();ctx.restore();}
}
function drawCat(){
 if(!actorImages.donut){drawCatFallback();return;}
 actorShadow(cat,23);drawActor('donut',donutFrame(cat,time),cat);
 if(cat.cool>1.25){ctx.save();ctx.strokeStyle='#c6a2f2aa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cat.x+cat.face*26,cat.y-39,21,0,Math.PI*2);ctx.stroke();for(let i=0;i<4;i++){const a=time*6+i*Math.PI/2;rect(cat.x+cat.face*26+Math.cos(a)*21-2,cat.y-39+Math.sin(a)*21-2,4,4,'#efdcff');}ctx.restore();}
}
// Smooth, shaded cartoon artwork; gameplay still uses the original simulation.
function drawCarlFallback(){
 const moving=p.onGround&&Math.abs(p.vx)>10,walk=moving?Math.sin(time*15):0;
 const bob=moving?Math.abs(walk)*1.5:Math.sin(time*2.2)*.65;
 const green=s.race==='goblin';
 const ink='#422c32',skin=green?'#b2ce91':'#efb58d',highlight=green?'#e0e9b5':'#ffdcaf',shade=green?'#70895f':'#bc775c';
 const grad=(x,y,x2,y2,a,b)=>{const g=ctx.createLinearGradient(x,y,x2,y2);g.addColorStop(0,a);g.addColorStop(1,b);return g;};
 const oval=(x,y,rx,ry,fill,stroke=ink,width=1.3)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}};
 const shape=(commands,fill,stroke=ink,width=1.4)=>{ctx.beginPath();for(const a of commands)ctx[a[0]](...a.slice(1));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}};
 const line=(x,y,x2,y2,color,width=1)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
 const heart=(x,y,size)=>{ctx.save();ctx.translate(x,y);ctx.scale(size,size);shape([['moveTo',0,1],['bezierCurveTo',-5,-3,-3,-6,0,-3],['bezierCurveTo',3,-6,5,-3,0,1]],'#c9637c',null);ctx.restore();};
 ctx.save();if(p.inv>0&&Math.floor(time*12)%2)ctx.globalAlpha=.35;
 oval(p.x,p.y-1,25,4,'#0005',null);ctx.translate(p.x,p.y);ctx.scale(p.face,1);ctx.lineCap='round';ctx.lineJoin='round';
 // Bent legs with broad bare feet. Joint rotation gives a soft running cycle.
 for(const back of [true,false]){ctx.save();ctx.translate(back?-9:8,-24);ctx.rotate((back?-1:1)*walk*.34+(p.onGround?0:back?.32:-.42));
 shape([['moveTo',-6,0],['quadraticCurveTo',-7,9,-4,18],['quadraticCurveTo',1,21,6,17],['lineTo',6,0]],grad(-6,0,7,15,back?skin:highlight,shade));
 oval(3,20,10,4.1,grad(-5,15,10,24,highlight,skin));line(7,18.4,7.5,21.5,shade,.65);line(10,19,10.5,21.7,shade,.65);ctx.restore();}
 ctx.translate(0,-bob);
 // Rear arm, shoulder and bicep.
 ctx.save();ctx.translate(-17,-52);ctx.rotate(walk*.3);
 shape([['moveTo',-4,-4],['quadraticCurveTo',-12,0,-9,15],['quadraticCurveTo',-11,24,-4,27],['quadraticCurveTo',3,28,3,19],['lineTo',5,3]],grad(-10,0,5,0,shade,skin));oval(-3,24,6,6,skin);ctx.restore();
 // Broad chest, a tapered waist, warm rim light and subtle muscle definition.
 shape([['moveTo',-8,-62],['quadraticCurveTo',-18,-62,-21,-52],['quadraticCurveTo',-20,-44,-15,-36],['lineTo',-13,-28],['quadraticCurveTo',0,-23,15,-28],['lineTo',18,-48],['quadraticCurveTo',20,-60,8,-62]],grad(-20,-60,20,-26,highlight,shade));
 shape([['moveTo',-6,-58],['quadraticCurveTo',0,-54,10,-56],['quadraticCurveTo',15,-49,11,-42],['quadraticCurveTo',1,-39,-8,-43],['quadraticCurveTo',-13,-51,-6,-58]],grad(-10,-57,12,-37,highlight,skin),null);
 ctx.globalAlpha*=.55;line(-9,-48,-1,-46,shade,.9);line(3,-46,11,-47,shade,.9);line(1,-44,1,-40,shade,.8);oval(1,-34,1.1,.8,shade,null);ctx.globalAlpha=p.inv>0&&Math.floor(time*12)%2?.35:1;
 // Soft fabric shorts: rounded hems, contrasting piping, folds and hearts.
 shape([['moveTo',-15,-30],['quadraticCurveTo',0,-27,16,-30],['lineTo',17,-16],['quadraticCurveTo',10,-13,2,-16],['lineTo',0,-21],['lineTo',-2,-16],['quadraticCurveTo',-11,-13,-17,-17]],grad(-12,-32,10,-13,'#fff8e9','#bdbac5'));
 shape([['moveTo',-15,-31],['quadraticCurveTo',0,-28,16,-31],['lineTo',16,-27],['quadraticCurveTo',0,-24,-15,-27]],'#f7e4d1',ink,.8);
 line(-14,-17,-5,-17,'#fdf7eb',1.4);line(5,-16,14,-17,'#fdf7eb',1.4);line(0,-25,0,-22,'#888596',.8);
 heart(-9,-21,.8);heart(9,-20,.8);heart(0,-27,.48);
 // Neck and head in three-quarter view, with a strong jaw rather than square pixels.
 oval(0,-61,8,8,grad(-6,-66,8,-56,skin,shade));
 oval(-12,-74,5,7,skin);oval(-12,-74,2.1,3.3,shade,null);
 if(green)shape([['moveTo',-13,-79],['lineTo',-23,-86],['quadraticCurveTo',-23,-73,-12,-70]],skin);
 shape([['moveTo',-12,-87],['bezierCurveTo',-7,-94,11,-94,16,-85],['quadraticCurveTo',20,-77,16,-68],['quadraticCurveTo',14,-60,3,-60],['quadraticCurveTo',-8,-60,-12,-69],['quadraticCurveTo',-16,-80,-12,-87]],grad(-13,-89,16,-61,highlight,shade));
 oval(3,-78,13,14,grad(-5,-90,18,-69,highlight,skin),null);
 // Tousled chestnut hair, swept fringe, sideburn and a soft reflected highlight.
 shape([['moveTo',-14,-76],['quadraticCurveTo',-20,-86,-13,-93],['lineTo',-17,-96],['quadraticCurveTo',-8,-99,-3,-96],['quadraticCurveTo',6,-102,11,-95],['quadraticCurveTo',23,-94,19,-86],['quadraticCurveTo',11,-90,5,-87],['quadraticCurveTo',0,-83,-9,-87],['lineTo',-10,-74]],grad(-12,-98,16,-77,'#81523b','#3b2930'));
 ctx.beginPath();ctx.moveTo(-10,-92);ctx.quadraticCurveTo(0,-98,12,-91);ctx.strokeStyle='#b17a50';ctx.lineWidth=2;ctx.stroke();
 // Brows and eyes. A short blink keeps the face alive at rest.
 const blink=Math.sin(time*.74)>.996;
 if(blink){line(-4,-78,1,-78,ink,1.5);line(7,-78,14,-78,ink,1.5);}
 else {oval(-2,-78,3.2,4,'#fff9eb',ink,.8);oval(10,-78,4,4.5,'#fff9eb',ink,.8);oval(-.6,-77.5,1.6,2.7,'#556c72',null);oval(11.6,-77.4,2,3,'#506b76',null);oval(.1,-77.3,.9,2,'#25313d',null);oval(12.2,-77.2,1.1,2.2,'#25313d',null);oval(11,-79,1,1,'white',null);}
 line(-6,-84,1,-84.8,'#4b3331',2.3);line(6,-84.5,14,-83,'#4b3331',2.5);
 // Nose, subtle stubble and a determined half-smile.
 shape([['moveTo',6,-78],['quadraticCurveTo',10,-72,16,-73],['quadraticCurveTo',18,-68,11,-68],['quadraticCurveTo',7,-68,6,-71]],grad(6,-76,15,-68,highlight,skin),shade,.8);
 shape([['moveTo',-7,-69],['quadraticCurveTo',-2,-65,4,-67],['quadraticCurveTo',12,-65,16,-69],['quadraticCurveTo',14,-59,3,-60],['quadraticCurveTo',-5,-61,-7,-69]],'#936d5d55',null);
 ctx.beginPath();ctx.moveTo(0,-65.5);ctx.quadraticCurveTo(7,-62.5,12,-66);ctx.strokeStyle='#754b47';ctx.lineWidth=1.2;ctx.stroke();
 line(-3,-66,-2.4,-64.5,'#886354',.6);line(-.5,-64.4,0,-63.4,'#886354',.6);line(3,-63.5,3.4,-62.5,'#886354',.6);
 // Front arm rotates through the walk and extends into the existing punch range.
 if(p.attack>0){
 shape([['moveTo',16,-53],['quadraticCurveTo',25,-58,32,-49],['lineTo',45,-48],['lineTo',47,-38],['quadraticCurveTo',31,-34,24,-41],['quadraticCurveTo',15,-42,16,-53]],grad(20,-54,35,-37,highlight,shade));
 oval(49,-45,9,8,grad(43,-52,55,-39,highlight,skin));line(46,-49,53,-49,skin,1);line(48,-45,55,-45,shade,.7);
 ctx.beginPath();ctx.arc(52,-46,16,-.75,.75);ctx.strokeStyle='#ffe0b688';ctx.lineWidth=2.5;ctx.stroke();
 }else{ctx.save();ctx.translate(18,-53);ctx.rotate(-walk*.32);
 shape([['moveTo',-3,-4],['quadraticCurveTo',7,-8,9,3],['quadraticCurveTo',10,11,5,18],['lineTo',5,23],['lineTo',-5,23],['quadraticCurveTo',-9,14,-5,7]],grad(-6,-5,10,18,highlight,shade));oval(1,23,7,6.5,grad(-5,18,8,26,highlight,skin));line(2,24,7,24,shade,.7);ctx.restore();}
 ctx.restore();
}
function drawCatFallback(){
 const moving=cat.onGround&&Math.abs(cat.vx)>10,step=moving?Math.sin(time*18):0;
 const bob=moving?Math.abs(step):Math.sin(time*2.4)*.5,casting=cat.cool>1.25;
 rect(cat.x-29,cat.y-2,58,5,'#0006');ctx.save();ctx.translate(Math.round(cat.x),Math.round(cat.y));ctx.scale(cat.face*1.45,1.45);
 // A full, gently swaying Persian tail behind the cape.
 const swish=Math.round(Math.sin(time*3)*2);
 rect(-18,-17+swish,5,14,'#282431');rect(-22,-23+swish,7,13,'#282431');rect(-24,-22+swish,6,6,'#282431');
 rect(-21,-21+swish,5,12,'#ececf1');rect(-23,-21+swish,4,5,'#ececf1');rect(-18,-13+swish,4,9,'#b8bac7');rect(-17,-8+swish,7,4,'#ececf1');
 // Body silhouette and purple cape with a gold clasp.
 rect(-13,-20,25,17,'#282431');rect(-15,-16,29,10,'#282431');rect(-12,-19,22,14,'#ececf1');rect(-13,-14,26,7,'#ececf1');
 rect(-13,-19,10,12,'#65416f');rect(-14,-12,12,6,'#80598c');rect(-13,-7,12,2,'#c294b9');rect(-10,-18,3,7,'#ab7eab');
 rect(2,-17,10,9,'#f6deb2');rect(0,-9,11,4,'#e9c697');
 // Small walking paws, always attached to the platform surface.
 const paw=cat.onGround?Math.round(step):0;
 rect(-9,-5+paw,7,5,'#282431');rect(6,-5-paw,7,5,'#282431');rect(-8,-4+paw,5,3,'#ececf1');rect(7,-4-paw,5,3,'#ececf1');
 ctx.translate(0,-Math.round(bob));
 // Fluffy head, pointed ears, tortoiseshell patches and cheek tufts.
 rect(-9,-29,7,10,'#282431');rect(8,-29,7,10,'#282431');rect(-7,-28,4,6,'#ececf1');rect(10,-28,3,6,'#ececf1');
 rect(-9,-24,24,14,'#282431');rect(-12,-21,30,8,'#282431');rect(-7,-12,22,3,'#282431');
 rect(-8,-24,22,13,'#ececf1');rect(-10,-20,27,6,'#ececf1');rect(-6,-13,19,3,'#ececf1');
 rect(-7,-24,8,7,'#b8bac7');rect(-9,-21,8,5,'#b8bac7');rect(-7,-16,5,3,'#ececf1');rect(7,-24,7,5,'#ececf1');
 // Wide green eyes and little pink nose; whiskers show at normal game scale.
 rect(-4,-20,6,4,'#414136');rect(7,-20,6,4,'#414136');rect(-3,-20,4,3,'#aad28d');rect(8,-20,4,3,'#badb97');rect(-1,-20,1,3,'#232b31');rect(10,-20,1,3,'#232b31');rect(-3,-20,1,1,'#fff6dc');rect(8,-20,1,1,'#fff6dc');
 rect(0,-15,11,4,'#ececf1');rect(4,-16,3,2,'#bf7d83');rect(5,-14,1,2,'#8a5a60');rect(2,-12,3,1,'#b88978');rect(6,-12,3,1,'#b88978');
 rect(-11,-16,7,1,'#ececf1');rect(-12,-13,8,1,'#ececf1');rect(13,-16,7,1,'#ececf1');rect(13,-13,8,1,'#ececf1');
 // Five-point crown with warm highlights and a purple center jewel.
 rect(-5,-31,17,6,'#6b483c');rect(-6,-35,4,7,'#6b483c');rect(1,-37,4,9,'#6b483c');rect(9,-35,4,7,'#6b483c');
 rect(-5,-34,2,6,'#ffe09a');rect(2,-36,2,8,'#ffe8af');rect(10,-34,2,6,'#ffe09a');rect(-4,-31,15,4,'#dbaa58');rect(-4,-28,15,2,'#ffe6a0');rect(2,-31,4,4,'#925ca8');rect(3,-31,2,2,'#e1b3f4');
 rect(1,-10,8,2,'#ae7b46');rect(4,-9,3,4,'#edc477');rect(5,-8,1,2,'#b79bd5');
 ctx.restore();
 if(casting){ctx.save();ctx.strokeStyle='#c2a0f0aa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cat.x+cat.face*14,cat.y-29,34,0,Math.PI*2);ctx.stroke();for(let i=0;i<4;i++){const a=time*6+i*Math.PI/2;rect(cat.x+cat.face*14+Math.cos(a)*34-2,cat.y-29+Math.sin(a)*34-2,4,4,'#efdcff');}ctx.restore();}
}
function drawEnemy(e){
 if(e.hp<=0)return;if(e.training){drawDummy(e);return;}if(e.type==='boss'){drawDozer(e);return;}
 if(actorImages[e.type]){
  const frame=e.type==='goblin'?(e.hit>0?5:e.phase==='windup'?3:e.phase==='recover'?4:Math.abs(e.vx)>10?1+Math.floor(time*7)%2:0):(e.phase==='windup'?2:e.phase==='recover'&&e.timer>.25?3:Math.abs(e.vx)>10?1:0);
  actorShadow(e,e.type==='llama'?38:23);drawActor(e.type,frame,e);
  const y=e.y-e.h-12;rect(e.x-23,y,46,4,'#1c2428');rect(e.x-23,y,46*e.hp/e.max,4,'#b8c58e');
  if(dist(p,e)<380)text('LV '+e.level+' · '+Math.ceil(e.hp)+' / '+e.max,e.x,y-6,9,'#d7d9bf');
  if(e.phase==='windup')text('!',e.x,y-24,22,'#ffd187');if(target===e.id)text('▼',e.x,y-39,13,'#c5a1f4');
  if(e.snared>0){ctx.strokeStyle='#bfd69b';ctx.strokeRect(e.x-e.w/2,e.y-14,e.w,10);}return;
 }
 const scale=enemyScale[e.type]||1;ctx.save();ctx.translate(e.x,e.y);ctx.scale(scale,scale);ctx.translate(-e.x,-e.y);drawEnemyArt({...e,w:e.w/scale,h:e.h/scale});ctx.restore();
}
function drawEnemyArt(e){ctx.save();if(e.hit>0)ctx.globalAlpha=.6;rect(e.x-e.w/2,e.y-3,e.w,6,'#0006');
 if(e.type==='llama'){
 const x=e.x,y=e.y,f=e.face,bob=Math.sin(time*7)*1.5;
 rect(x-26,y-48+bob,50,29,'#d3bc95');rect(x-28,y-45+bob,7,14,'#f0d8ab');rect(x+f*20-9,y-73+bob,17,45,'#d3bc95');rect(x+f*25-14,y-81+bob,31,19,'#e4cda3');rect(x+f*28-8,y-90+bob,5,13,'#d3bc95');rect(x+f*17-3,y-90+bob,5,13,'#d3bc95');rect(x+f*35-4,y-76+bob,5,4,'#272b32');
 rect(x-20,y-22,9,22,'#aa936e');rect(x+13,y-22,9,22,'#aa936e');rect(x-21,y-5,11,5,'#5e564e');rect(x+12,y-5,11,5,'#5e564e');rect(x-17,y-45,31,17,'#a76057');rect(x-12,y-41,22,5,'#d8a469');text('BAD LLAMA · LV 2',x,y-107,9,'#dbcea6');rect(x-27,y-101,54,4,'#292d32');rect(x-27,y-101,54*e.hp/e.max,4,'#bac894');
 }
 else{pixelSprite(monsterSprite,{h:'#8b6548',g:'#9ec36a',w:'#ffedb2',n:'#709647',k:'#313837',r:'#ba6655',b:'#494847'},e.x,e.y-49,3.5,e.face<0);rect(e.x-19,e.y-58,38,4,'#272c34');rect(e.x-19,e.y-58,38*e.hp/e.max,4,'#a7c58a');}
 if(e.snared>0){ctx.strokeStyle='#bfd69b';ctx.strokeRect(e.x-e.w/2-6,e.y-17,e.w+12,12);text('SNARED',e.x,e.y-e.h-22,10,'#c5dda6');}
 if(e.phase==='windup'){text('!',e.x,e.y-e.h-18,26,'#ffc36c');ctx.strokeStyle='#eab36d77';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(e.x,e.y+1);ctx.lineTo(e.x+e.face*(e.type==='boss'?0:e.type==='llama'?320:75),e.y+1);ctx.stroke();ctx.setLineDash([]);}
 if(target===e.id){text('▼',e.x,e.y-e.h-32,16,'#c5a1f4');}ctx.restore();}
function drawTreasureChest(o){
 const x=o.x,y=o.y,boss=o.kind==='boss';ctx.save();ctx.translate(x,y);if(boss)ctx.scale(1.08,1.08);
 ctx.fillStyle='#0005';ctx.beginPath();ctx.ellipse(0,-1,39,7,0,0,Math.PI*2);ctx.fill();
 if(!o.open){const glow=ctx.createRadialGradient(0,-32,5,0,-32,64);glow.addColorStop(0,boss?'#e7b86644':'#d69d3822');glow.addColorStop(1,'#e7b86600');ctx.fillStyle=glow;ctx.fillRect(-64,-96,128,100);}
 const body=ctx.createLinearGradient(-32,-42,28,0);body.addColorStop(0,'#774527');body.addColorStop(.45,'#4d281d');body.addColorStop(1,'#291c1c');ctx.fillStyle=body;ctx.beginPath();ctx.roundRect(-33,-36,66,33,4);ctx.fill();
 for(let j=0;j<3;j++){ctx.strokeStyle='#a66c3844';ctx.beginPath();ctx.moveTo(-28,-28+j*9);ctx.lineTo(29,-28+j*9);ctx.stroke();}
 ctx.save();if(o.open){ctx.translate(0,-35);ctx.rotate(-.2);ctx.translate(0,10);}
 const lid=ctx.createLinearGradient(0,-57,0,-29);lid.addColorStop(0,'#b07945');lid.addColorStop(.45,'#73462b');lid.addColorStop(1,'#3a231c');ctx.fillStyle=lid;ctx.beginPath();ctx.moveTo(-35,-31);ctx.lineTo(-35,-39);ctx.bezierCurveTo(-35,-64,35,-64,35,-39);ctx.lineTo(35,-31);ctx.closePath();ctx.fill();ctx.strokeStyle='#d9b273';ctx.lineWidth=2;ctx.stroke();
 for(const bx of [-23,18]){ctx.fillStyle='#b58b50';ctx.fillRect(bx,-49,5,18);ctx.fillStyle='#f2d493';ctx.fillRect(bx,-47,1,15);}ctx.restore();
 if(o.open){ctx.fillStyle='#151a20';ctx.beginPath();ctx.ellipse(0,-35,28,8,0,0,Math.PI*2);ctx.fill();}
 for(const bx of [-25,20]){rect(bx,-30,5,25,'#b58b50');for(const by of [-25,-11]){ctx.fillStyle='#f4d59a';ctx.beginPath();ctx.arc(bx+2.5,by,1.4,0,Math.PI*2);ctx.fill();}}
 rect(-32,-6,64,3,'#b58b50');ctx.fillStyle='#dec081';ctx.beginPath();ctx.roundRect(-7,-35,14,17,3);ctx.fill();ctx.fillStyle=boss?'#b064a9':'#4f8994';ctx.beginPath();ctx.moveTo(0,-33);ctx.lineTo(5,-28);ctx.lineTo(0,-22);ctx.lineTo(-5,-28);ctx.closePath();ctx.fill();
 if(!o.open)for(let j=0;j<3;j++){const t=time*1.8+j*2.1;ctx.globalAlpha=.35+.3*Math.sin(t);text('✧',Math.sin(t)*38,-66-Math.cos(t)*7,12,'#f6d994');}ctx.globalAlpha=1;
 ctx.restore();
}
function drawProp(o){if(!o.active)return;const scale=propScale[o.type]||1;ctx.save();if(o.pop>0)ctx.translate(0,-Math.sin(Math.min(1,o.pop/.65)*Math.PI)*38);ctx.translate(o.x,o.y);ctx.scale(scale,scale);ctx.translate(-o.x,-o.y);drawPropArt(o);ctx.restore();}
function drawPropArt(o){const x=o.x,y=o.y;
 if(o.type==='mentor'||o.type==='planningDesk')return;
 if(o.type==='guildDoor'||o.type==='guildExit'){arch(x-45,y-172,90,172);rect(x-34,y-146,68,146,'#694f3d');rect(x-26,y-132,52,105,'#806047');rect(x+20,y-70,6,6,'#edc880');ctx.fillStyle='#f4c77633';ctx.fillRect(x-32,y-143,64,140);text(o.type==='guildExit'?'HALLWAY':'MORDECAI',x,y-188,12,'#ecd09a');text(o.type==='guildExit'?'E · LEAVE':'GUILDMASTER · E',x,y-174,9,'#c8b591');return;}
 if(o.type==='arenaGate'){arch(x-50,y-190,100,190);if(s.flags.challengeStarted&&!s.flags.challengeCleared){for(let k=0;k<5;k++)rect(x-42+k*21,y-163,6,163,'#8d7770');}return;}
 if(o.type==='support'){if(o.broken){for(let j=0;j<5;j++)rect(x-37+j*14,y-12-j%2*12,24,17,'#8d7c68');}else{rect(x-15,y-148,30,148,'#8f806c');rect(x-24,y-156,48,12,'#b49c7b');for(let j=0;j<4;j++)rect(x-8+j%2*8,y-126+j*29,4,24,'#3c3b3d');}return;}

 if(o.type==='snare'){const c=o.spent?'#667368':o.arm>0?'#bba67b':'#c0d998';rect(x-26,y-5,52,5,'#61635a');for(let j=0;j<5;j++){rect(x-25+j*11,y-(o.spent?8:14),5,o.spent?5:9,c);}rect(x-4,y-7,8,6,c);if(near(o,90))text(o.spent?'SPRUNG':o.arm>0?'ARMING…':'READY',x,y-26,9,c);return;}
 if(o.type==='junkheap'){rect(x-60,y-40,120,40,'#4b4a48');for(let j=0;j<7;j++){rect(x-55+j*16,y-25-(j%3)*17,29,23,['#77725c','#6c6071','#8b7153'][j%3]);}return;}
 if(o.type==='pickup'){const bob=Math.sin(time*4+o.x)*3;ctx.fillStyle='#ffbc6b18';ctx.beginPath();ctx.arc(x,y-17,23,0,Math.PI*2);ctx.fill();if(o.item==='upgrade'){ctx.fillStyle='#b99de9';ctx.beginPath();ctx.moveTo(x,y-37+bob);ctx.lineTo(x+10,y-22+bob);ctx.lineTo(x,y-8+bob);ctx.lineTo(x-10,y-22+bob);ctx.closePath();ctx.fill();}else if(o.item==='potion')drawPotion(x,y-18+bob);else if(o.item==='trap'){rect(x-13,y-27+bob,26,20,'#53644c');rect(x-10,y-29+bob,20,4,'#c1d6a0');rect(x-2,y-28+bob,4,22,'#a8bf8b');text('⌁',x,y-10+bob,20,'#d3e9b1');}else drawBombIcon(x,y-17+bob);if(near(o,100))text(o.item==='potion'?(s.potions>=3?'BAG FULL':'POTION'):o.item==='trap'?'TRAP KIT':o.item==='upgrade'?'POWER CRYSTAL':'BOMB',x,y-45,8,'#e7c58d');return;}
 if(o.type==='crate'){rect(x-23,y-43,46,43,'#8b694b');rect(x-19,y-39,38,35,'#493e34');rect(x-15,y-36,7,33,'#a07952');rect(x+9,y-36,7,33,'#a07952');rect(x-19,y-25,37,6,'#a07952');}
 if(o.type==='barrel'){rect(x-20,y-45,40,42,'#864d42');rect(x-16,y-49,32,5,'#a57350');rect(x-22,y-36,44,7,'#4c4448');rect(x-22,y-14,44,7,'#4c4448');text('×',x,y-18,22,'#ffd693');if(o.fuse!=null){rect(x-3,y-57,6,9,'#ffd189');text('!',x,y-65,19,'#ffd189');}}
 if(o.type==='chest'){drawTreasureChest(o);return;}
 if(o.type==='door'){arch(x-50,y-DOOR_HEIGHT,100,DOOR_HEIGHT);rect(x-40,y-DOOR_OPENING,80,DOOR_OPENING,'#101923');rect(x-36,y-DOOR_OPENING+5,72,DOOR_OPENING-5,'#423b38');for(let j=0;j<4;j++)rect(x-31+j*20,y-DOOR_OPENING+8,2,DOOR_OPENING-10,'#76614b');rect(x-36,y-112,72,6,'#292d34');rect(x-36,y-38,72,6,'#292d34');rect(x+22,y-68,6,6,'#e9b86a');}
 if(o.type==='wall'){for(let row=0;row<3;row++){rect(x-35,y-120+row*40,72,37,'#63676a');rect(x-31,y-117+row*40,63,3,'#7b7c7d');}for(let i=0;i<5;i++)rect(x-6+(i%2)*10,y-112+i*22,6,27,'#242e37');}
 if(o.type==='trap'){rect(x-43,y-3,86,7,o.rewired?'#7b9874':'#5d4b50');for(let j=0;j<7;j++){const h=o.firing?18:5;ctx.fillStyle=o.rewired?'#b8d79b':'#a59699';ctx.beginPath();ctx.moveTo(x-40+j*12,y);ctx.lineTo(x-34+j*12,y-h);ctx.lineTo(x-28+j*12,y);ctx.fill();}if(o.rewired)text('REWIRED',x,y-33,9,'#b7d29f');}
 if(o.type==='stairs'){arch(x-52,y-170,104,170);rect(x-48,y-147,96,147,'#0c1421');for(let i=0;i<5;i++){rect(x-40+i*15,y-24-i*16,75-i*12,7,s.flags.bossLoot?'#a39c80':'#4c5360');rect(x-40+i*15,y-17-i*16,75-i*12,12,'#303947');}text(s.flags.bossLoot?'↓':'🔒',x,y-187,18,'#d2c58f');}
 if(o.type==='sign'){rect(x-2,y-39,4,39,'#695844');rect(x-51,y-60,102,25,'#393636');text(o.text,x,y-43,10,'#d6bea0');}
}
function drawAim(){if(!aim||mode!=='play')return;const b=bombLaunch(aim);for(let i=0;i<Math.ceil(b.fuse/DT);i++){bombMotion(b,DT);if(i%6===0)rect(b.x-2,b.y-2,4,4,'#edcca1aa');}ctx.strokeStyle='#ffc28077';ctx.setLineDash([6,7]);ctx.beginPath();ctx.ellipse(b.x,b.y,142,26,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);text(s.bombs?'RELEASE K TO THROW':'NO BOMBS',p.x,p.y-166,10,'#f0bf83');}
function render(){ctx.save();if(shake)ctx.translate(Math.sin(time*80)*shake,Math.cos(time*100)*shake*.5);background();ctx.save();ctx.translate(-Math.round(camera),0);
 for(const f of platforms){rect(f.x,f.y,f.w,8,'#877963');rect(f.x+4,f.y+8,f.w-8,17,'#44464a');for(let i=12;i<f.w;i+=35)rect(f.x+i,f.y+13,24,6,'#596065');}
 for(const o of props)drawProp(o);for(const e of enemies)drawEnemy(e);drawSpecials();drawCat();drawCarl();if(p.drinkTime>0){drawPotion(p.x+p.face*17,p.y-100,.8);text('DRINKING…',p.x,p.y-151,10,'#e8b0bd');}
 for(const b of bombs){rect(b.x-7,b.y-7,14,14,'#353442');rect(b.x-4,b.y-10,8,4,'#aa997a');rect(b.x,b.y-15,4,6,'#ffc277');}
 for(const b of hostile){if(b.type==='shockwave'){ctx.strokeStyle='#efbc7c';ctx.lineWidth=3;ctx.beginPath();ctx.arc(b.x,b.y+9,18,Math.PI,Math.PI*2);ctx.stroke();rect(b.x-17,b.y+6,34,4,'#efbc7c55');}else if(b.type==='spit'){rect(b.x-6,b.y-5,12,10,'#bbd17f');rect(b.x-2,b.y-3,5,4,'#e2eeb1');}else{rect(b.x-14,b.y-12,28,24,'#968573');rect(b.x-10,b.y-9,20,5,'#c9bfa3');rect(b.x-3,b.y-12,5,24,'#666877');text('↓',b.targetX,FLOOR-9,16,'#d8987477');}}
 for(const b of shots){rect(b.x-7,b.y-3,14,6,'#9d79d5');rect(b.x-3,b.y-4,6,8,'#e1caff');}
 drawAim();for(const a of particles){ctx.globalAlpha=clamp(a.life*2,0,1);if(a.radius){ctx.strokeStyle=a.color;ctx.lineWidth=6;ctx.beginPath();ctx.arc(a.x,a.y,a.radius*(1-a.life/.35),0,Math.PI*2);ctx.stroke();ctx.lineWidth=1;}else rect(a.x,a.y,a.size,a.size,a.color);}ctx.globalAlpha=1;
 for(const f of floats){ctx.globalAlpha=clamp(f.life,0,1);text(f.text,f.x,f.y,12,f.color);}ctx.globalAlpha=1;ctx.restore();
 // Soft vignette, and tiny scan lines for the televised-dungeon look.
 const v=ctx.createLinearGradient(0,0,0,H);v.addColorStop(0,'#090d1b66');v.addColorStop(.25,'#00000000');v.addColorStop(.9,'#00000000');v.addColorStop(1,'#080b1655');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);for(let y=0;y<H;y+=4)rect(0,y,W,1,'#070c1208');ctx.restore();
}
// Floor-one training is an isolated scene: real inventory and room objects are restored on exit.
let guild=null,practiceTrace=null,simulationTick=0;
const lessons=[
 {name:'Walk over',key:'A / D',instruction:'Walk to the glowing circle beside Mordecai.',reply:'Good. Movement first. Heroics can wait.'},
 {name:'Jump',key:'SPACE',instruction:'Jump onto the low practice platform.',reply:'You can jump over attacks, too. Watch for the warning.'},
 {name:'Punch',key:'J',instruction:'Walk close to the straw dummy and punch it.',reply:'Get close, face your target, then strike.'},
 {name:'Throw a bomb',key:'HOLD K → RELEASE',instruction:'Aim at the target on the right. Release K to throw. Practice bombs refill.',reply:'Watch the arc. A bomb in the right place beats three thrown blindly.'},
 {name:'Set a trap',key:'T',instruction:'Place a snare on the floor. Let the moving dummy walk into it.',reply:'A trap needs a moment to arm. Plan where the enemy will go.'},
 {name:'Drink a potion',key:'H',instruction:'Three practice hearts are missing. Drink a potion to restore them.',reply:'Find a safe moment to drink. You carry only three real potions.'},
 {name:'Work with Donut',key:'Q',instruction:'Mark the dummy. Donut will focus her spell on it.',reply:'Good. Give her a target. She will claim it was her idea.'},
 {name:'Royal Decoy',key:'V',instruction:'Press V to create Donut’s illusion. Watch the dummy follow it instead of Carl. Practice charge refills.',reply:'It took the bait. Against the truck, use the decoy before its charge starts; it cannot turn once charging.'},
 {name:'Barefoot Breaker',key:'F',instruction:'Stand near the dummy and press F. Carl leaps, then stomps on landing. Practice charge refills.',reply:'The landing is the hit. In combat, damage and clever plays refill your special meter. A well-placed box still hits harder.'},
 {name:'Ask Donut to help a trap',key:'T → G',instruction:'Press T to place a snare, then G once to choose Help traps & boxes (or use Donut’s goal menu below). Let her lure the dummy across it.',reply:'You set the trap and gave the goal. Donut chose the lure. Auto can do this too; your goal tells her what to prioritize.'}
];
function recordPractice(kind,detail={}){if(practiceTrace&&practiceTrace.events.length<3000)practiceTrace.events.push({tick:simulationTick,kind,...detail});}
function checkpointGuild(){if(!checkpoint)return;try{const cp=JSON.parse(checkpoint);cp.state.flags.guildVisited=true;cp.state.flags.lessons=[...(guild?guild.completed:s.flags.lessons||[])];if(!cp.state.flags.guildPotionGift){cp.state.potions=Math.min(3,(cp.state.potions||0)+2);cp.state.flags.guildPotionGift=true;}checkpoint=JSON.stringify(cp);save();}catch{}}
function enterGuild(){
 if(guild)return;
 if(!s.flags.guildPotionGift){s.potions=Math.min(3,(s.potions||0)+2);s.flags.guildPotionGift=true;event('Mordecai supplied two health potions');}
 s.flags.guildVisited=true;checkpointGuild();
 const returned={s,p,cat,enemies,props,platforms,bombs,shots,hostile,particles,floats,camera,roomWidth,target,checkpoint,time,decoy,coop};
 guild={returned,lesson:0,done:false,completed:[...(s.flags.lessons||[])],lastKeys:'',announced:false};
 practiceTrace={format:'dungeon-broadcast-practice-v1',version:'0.15.0',stepSeconds:DT,scenario:'mordecai-guild',seed:1,build:{race:s.race,class:s.job,strength:s.str,intelligence:s.int,level:s.level,xp:s.xp,donutMagic:s.donutMagic,baseStrength:s.baseStr,baseIntelligence:s.baseInt,skills:clone(s.skills)},events:[]};simulationTick=0;
 decoy=null;coop=false;$('coop').disabled=true;s=clone(s);s.hp=s.maxHp;s.bombs=9;s.traps=9;s.potions=9;mode='play';roomWidth=W;camera=0;time=0;
 props=[{type:'guildExit',x:75,y:FLOOR,active:true},{type:'mentor',x:295,y:FLOOR,active:true},{type:'planningDesk',x:410,y:FLOOR,active:true}];
 enemies=[];platforms=[];bombs=[];shots=[];hostile=[];particles=[];floats=[];target=null;aim=0;
 p={x:145,y:FLOOR,vx:0,vy:0,face:1,onGround:true,cool:0,attack:0,throwTime:0,drinkTime:0,knockTime:0,knockVX:0,inv:0};cat={x:105,y:FLOOR,vx:0,vy:0,face:1,onGround:true,cool:0};
 hide();toastTime=0;$('toast').classList.remove('show');setLesson(0);say('A warm room. Finally, somewhere worthy of my presence.');sync();
}
function leaveGuild(){if(!guild)return;recordPractice('leave');const completed=[...guild.completed],r=guild.returned;guild=null;
 ({s,p,cat,enemies,props,platforms,bombs,shots,hostile,particles,floats,camera,roomWidth,target,checkpoint,time,decoy,coop}=r);
 s.flags.lessons=completed;$('coop').disabled=false;$('coop').innerHTML='P2 <span>'+(coop?'LEAVE':'JOIN')+'</span>';checkpointGuild();aim=0;keys.clear();pressed.clear();mode='play';$('lesson-panel').hidden=true;sync();canvas.focus({preventScroll:true});toast('BACK IN THE HALLWAY · H TO DRINK A POTION');
}
function trainingDummy(x,moving=false){return {id:++enemyID,type:'dummy',training:true,x,y:FLOOR,vx:0,vy:0,h:85,w:38,hp:30,max:30,face:-1,hit:0,cool:0,phase:'walk',moving,previousX:x};}
function setLesson(index){if(!guild)return;guild.lesson=clamp(index,0,lessons.length-1);guild.done=false;guild.lastKeys='';guild.rng=1;guild.commanded=false;shake=0;decoy=null;keys.clear();pressed.clear();s.specials={stomp:100,decoy:100};s.donutGoal=guild.lesson===9?'attack':'stay';
 enemies=[];platforms=[];bombs=[];shots=[];particles=[];floats=[];target=null;aim=0;props=props.filter(o=>!['snare','crate'].includes(o.type));
 p.x=guild.lesson===0?145:560;p.y=FLOOR;p.vx=p.vy=p.cool=p.attack=p.throwTime=p.drinkTime=0;p.face=1;p.onGround=true;p.stompActive=false;p.stompWave=0;cat.plan=null;cat.planTime=0;cat.onGround=true;cat.x=p.x-65;cat.y=FLOOR;cat.vx=cat.vy=cat.cool=0;
 s.hp=guild.lesson===5?3:s.maxHp;s.bombs=9;s.traps=9;s.potions=9;
 if(guild.lesson===1)platforms=[{x:685,y:FLOOR-52,w:115}];
 if([2,3,4,6,7,8,9].includes(guild.lesson))enemies=[trainingDummy(guild.lesson===8?675:guild.lesson===2?670:guild.lesson===4?850:850,guild.lesson===4)];
 recordPractice('reset',{lesson:guild.lesson,player:{x:p.x,y:p.y},resources:{bombs:9,traps:9,potions:9}});lessonUI();sync();
}
function lessonUI(){if(!guild)return;const l=lessons[guild.lesson],done=guild.done;const panel=$('lesson-panel');panel.hidden=false;
 $('lesson-count').textContent='MORDECAI · SAFE PRACTICE · '+(guild.lesson+1)+' / '+lessons.length;
 $('lesson-title').textContent=done?'✓ '+l.name:l.name;$('lesson-instruction').textContent=done?l.reply:l.instruction;$('lesson-key').textContent=done?'WELL DONE':l.key;
 $('lesson-next').hidden=!done;$('lesson-next').textContent=guild.lesson===lessons.length-1?'Finish training →':'Next lesson →';$('lesson-skip').hidden=done;
}
function lessonSuccess(){if(!guild||guild.done)return;guild.done=true;if(!guild.completed.includes(guild.lesson))guild.completed.push(guild.lesson);guild.returned.s.flags.lessons=[...guild.completed];
 recordPractice('success',{lesson:guild.lesson});lessonUI();beep(780,.15,'triangle');bits(p.x,p.y-85,'#b7dbad',14);checkpointGuild();
}
function nextLesson(){if(!guild)return;if(!guild.done)recordPractice('skip',{lesson:guild.lesson});if(guild.lesson===lessons.length-1){leaveGuild();return;}setLesson(guild.lesson+1);canvas.focus({preventScroll:true});}
function guildTalk(){if(!guild)return;mode='pause';show('<div class="eyebrow">MORDECAI · GUILDMASTER</div><h2>Ask before you explode.</h2><p>Bombs come from crates and goblin stash. Potions restore three hearts. A snare holds a creature, not an entire bulldozer.</p><p><b>The Murder Dozer:</b> push an explosive box into it for '+barrelDamage()+' damage and a two-second opening. Watch its headlights. Jump its charge. When it stalls, hit the glowing boiler. The cracked supports can stop it for longer. Below half health, watch for its blade slam.</p><div class="lesson-menu">'+lessons.map((l,i)=>'<button class="quiet" id="choose-lesson-'+i+'">'+(i+1)+'. '+l.name+'</button>').join('')+'</div><div class="modal-actions"><button class="primary" id="guild-resume">Back to practice →</button><button class="quiet" id="export-practice">Save practice record</button></div>');
 lessons.forEach((l,i)=>$('choose-lesson-'+i).onclick=()=>{resume();setLesson(i);});$('guild-resume').onclick=resume;$('export-practice').onclick=exportPractice;
}
function exportPractice(){if(!practiceTrace)return;const report={...practiceTrace,events:[...practiceTrace.events]};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mordecai-practice.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function drinkPotion(){if(mode!=='play'||p.stompActive||p.drinkTime>0)return;if(s.hp>=s.maxHp){toast('Health is full · potion saved');return;}if(!s.potions){toast('No potions · look for red bottles in the loot');return;}if(p.throwTime>0||aim){toast('Finish your throw first');return;}p.drinkTime=.6;toast('DRINKING…');}
function potionTick(dt){if(!(p.drinkTime>0))return;p.drinkTime=Math.max(0,p.drinkTime-dt);if(!p.drinkTime){s.potions=Math.max(0,s.potions-1);s.hp=Math.min(s.maxHp,s.hp+3);float('+3 HEALTH',p.x,p.y-130,'#d3eab3');beep(620,.2,'sine');if(guild&&guild.lesson===5)lessonSuccess();sync();}}
function dropPotion(x,source){dropItem(x,'potion',source);}
function tickGuild(dt){
 simulationTick++;shake=Math.max(0,shake-30*dt);specialTick(dt);if(pressed.has('KeyF'))barefootBreaker();if(pressed.has('KeyV'))royalDecoy();if(pressed.has('KeyG'))setDonutGoal(DONUT_GOALS[(DONUT_GOALS.indexOf(s.donutGoal)+1)%DONUT_GOALS.length]);const action=[...keys].sort().join(',');if(action!==guild.lastKeys){recordPractice('input',{keys:[...keys].sort()});guild.lastKeys=action;}
 p.cool=Math.max(0,p.cool-dt);p.attack=Math.max(0,p.attack-dt);p.throwTime=Math.max(0,p.throwTime-dt);cat.cool=Math.max(0,cat.cool-dt);potionTick(dt);
 const movement=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);p.vx=movement*(p.stompActive?70:p.drinkTime>0?75:keys.has('KeyK')?120:245);if(movement&&!p.throwTime)p.face=movement;
 if((pressed.has('Space')||pressed.has('KeyW')||pressed.has('ArrowUp'))&&p.onGround&&!p.stompActive)p.vy=-540;
 physics(p,dt);if(p.stompActive&&p.onGround)stompImpact();if(keys.has('KeyJ'))punch();if(keys.has('KeyK')&&!p.stompActive&&p.throwTime<=0&&!p.drinkTime)aim=clamp(aim+dt,.02,1);else if(aim)throwBomb();
 if(pressed.has('KeyT'))placeSnare();if(pressed.has('KeyH'))drinkPotion();if(pressed.has('KeyQ')){mark();cast();}
 if(pressed.has('KeyE')){const o=interaction();if(o?.type==='guildExit'){leaveGuild();return;}if(o?.type==='mentor'||o?.type==='planningDesk'){guildTalk();return;}use();}
 if(guild.lesson===9)donutPlannerTick(dt);else{cat.vx=clamp((p.x-p.face*65-cat.x)*4,-270,270);if(Math.abs(cat.vx)>10)cat.face=Math.sign(cat.vx);if(cat.onGround&&p.y<cat.y-40)cat.vy=-530;}physics(cat,dt);
 for(const e of alive()){
  e.hit=Math.max(0,e.hit-dt);e.previousX=e.x;
  if(e.moving&&!e.snared){e.x-=70*dt;if(e.x<470)e.x=940;}
  if(!e.snared&&[7,9].includes(guild.lesson)){
   const victim=enemyAim(e);
   if(victim!==p){e.face=Math.sign(victim.x-e.x)||1;e.x+=e.face*100*dt;
    if(guild.lesson===7&&victim===decoy&&dist(e,decoy)<55){consumeDecoy(e);bits(e.x,e.y-50,'#c9a9ed',12);lessonSuccess();}
   }
  }
 }
 for(const o of props)if(o.active&&o.type==='snare')snareTick(o,dt);
 for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.fuse-=dt;bombMotion(b,dt);if(b.fuse<=0){bombs.splice(i,1);explode(b.x,b.y,142,b.blast);}}
 for(let i=shots.length-1;i>=0;i--){const b=shots[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;const e=alive().find(e=>Math.abs(e.x-b.x)<e.w/2+10&&b.y>e.y-e.h-10&&b.y<e.y+8);if(e){damage(e,b.damage??magicDamage(),'donut');b.life=0;}if(b.life<=0)shots.splice(i,1);}
 s.bombs=s.traps=s.potions=9;if(!decoy)s.specials.decoy=100;if(!p.stompActive&&!p.stompWave)s.specials.stomp=100;
 if(guild.lesson===0&&p.x>=440)lessonSuccess();if(guild.lesson===1&&p.onGround&&p.y===FLOOR-52)lessonSuccess();
 for(const a of particles){a.life-=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.vy+=400*dt;}particles=particles.filter(a=>a.life>0);for(const f of floats){f.life-=dt;f.y-=24*dt;}floats=floats.filter(f=>f.life>0);
 const hint=promptFor(interaction());$('prompt').textContent=hint;$('prompt').style.display=hint?'block':'none';pressed.clear();
}
function startChallenge(){if(s.flags.challengeStarted)return;s.flags.challengeStarted=true;enemies=[spawnEnemy(780),spawnEnemy(1080),spawnEnemy(1290)];for(const e of enemies){e.phase='recover';e.timer=1.6;}
 toast('THE CAMERAS ARE ROLLING · THREE GOBLINS');event('Entered the optional broadcast arena');say('At last. An audience with something to watch.');}
function dozerWeak(e){return e.phase==='stunned';}
function dozerStall(e,seconds=3.2){e.phase='stunned';e.timer=seconds;e.vx=0;toast('BOILER EXPOSED · PUNCH OR THROW');beep(95,.15,'sawtooth');}
function dozerTick(e,dt){
 if(!e.rage&&e.hp<=e.max/2){e.rage=true;toast('BOILER OVERHEATING · WATCH FOR THE BLADE SLAM');say('It is falling apart. For once, that is encouraging.');}
 if(e.phase==='intro'){if(e.timer<=0){e.phase='walk';e.cool=.8;}return;}
 if(e.phase==='walk'){const victim=enemyAim(e);e.face=Math.sign(victim.x-e.x)||-1;if(e.cool<=0){const slam=e.rage&&(e.cycles||0)%2===1;e.phase=slam?'slamWindup':'windup';e.timer=e.cycles?1.1:1.65;e.destination=clamp(victim.x+e.face*115,300,1370);toast(slam?'BLADE RISING · JUMP OR MOVE BACK':'HEADLIGHTS FLASHING · GET READY TO JUMP');}return;}
 if(e.phase==='windup'&&decoy&&!decoy.used&&decoy.targetId===e.id){e.face=Math.sign(decoy.x-e.x)||e.face;e.destination=clamp(decoy.x+e.face*115,300,1370);}
 if(e.phase==='windup'&&e.timer<=0){consumeDecoy(e);e.phase='charge';e.vx=e.face*(e.rage?410:345);beep(80,.3,'sawtooth');}
 if(e.phase==='charge'){
  const old=e.x;e.x+=e.vx*dt;const support=props.find(o=>o.type==='support'&&o.active&&!o.broken&&Math.abs(o.x-e.x)<190);
  for(const actor of [p,cat]){const oldX=actor.x,oldY=actor.y;if(actor.onDozer===e.id)actor.x+=e.x-old;solidDozer(actor,oldX,oldY,true);}
  if(support){support.broken=true;e.cycles=(e.cycles||0)+1;dozerStall(e,4.4);damage(e,6,'environment');bits(support.x,FLOOR-95,'#ba956e',30);award('pillar'+support.x,15,'STRUCTURAL PROBLEM',true);}
  else if((e.x-e.destination)*e.face>=0||e.x<290||e.x>1420){e.x=clamp(e.x,290,1420);e.cycles=(e.cycles||0)+1;dozerStall(e);}
  e.previousX=old;return;
 }
 if(e.phase==='slamWindup'&&e.timer<=0){e.phase='slam';e.timer=.3;shake=7;if(Math.abs(p.x-e.x)<235&&(p.y>FLOOR-70||p.onDozer===e.id))hurt();for(const face of [-1,1])hostile.push({type:'shockwave',x:e.x+face*150,y:FLOOR-12,vx:face*260,vy:0,life:2});beep(55,.2,'sawtooth');return;}
 if(e.phase==='slam'&&e.timer<=0){e.cycles=(e.cycles||0)+1;dozerStall(e,3.7);return;}
 if(e.phase==='stunned'&&e.timer<=0){e.phase='walk';e.cool=.9;}
}
function drawPotion(x,y,scale=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle='#a34859';ctx.beginPath();ctx.roundRect(-8,-5,16,18,5);ctx.fill();rect(-4,-12,8,8,'#d5c8b9');rect(-5,-15,10,5,'#af8154');rect(-4,-1,3,9,'#f3bbc3');ctx.restore();}
function drawDummy(e){ctx.save();ctx.translate(e.x,e.y);rect(-3,-66,6,66,'#a08157');rect(-26,-58,52,8,'#a08157');ctx.fillStyle=e.hit>0?'#ffe5b7':'#c7a668';ctx.beginPath();ctx.ellipse(0,-64,21,28,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#745b44';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-12,-74);ctx.lineTo(12,-53);ctx.moveTo(12,-74);ctx.lineTo(-12,-53);ctx.stroke();text(e.snared?'CAUGHT':'PRACTICE',0,-103,10,'#dfc898');ctx.restore();}
function drawGuildBackground(){
 const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#30292d');g.addColorStop(1,'#171c24');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 for(let row=0;row<8;row++)for(let c=0;c<12;c++){const x=c*106+(row%2?53:0),y=40+row*47;rect(x,y,102,43,row%2?'#393333':'#332e30');rect(x+4,y+3,93,2,'#4a3e39');}
 // Fireplace, a bed, shelves and a small desk make this a lived-in room.
 rect(170,212,170,208,'#514239');rect(180,237,150,183,'#211c20');rect(160,203,190,16,'#8b6b4d');rect(195,265,120,145,'#15191e');
 for(let i=0;i<5;i++){const x=211+i*20,y=390-Math.sin(time*5+i)*5;ctx.fillStyle=i%2?'#f2b45e':'#b9653f';ctx.beginPath();ctx.ellipse(x,y,12,25+i%2*12,.1,0,Math.PI*2);ctx.fill();}rect(190,408,135,12,'#b49467');
 for(let r=0;r<2;r++){rect(355,167+r*64,150,9,'#98734e');for(let j=0;j<6;j++)rect(365+j*20,132+r*64,13,35,['#75647f','#927d56','#55766e'][j%3]);}
 rect(358,354,135,13,'#896743');rect(367,367,9,53,'#6b513e');rect(472,367,9,53,'#6b513e');rect(382,341,59,12,'#d2bea0');
 rect(34,319,107,60,'#775845');rect(39,316,96,25,'#b3987d');rect(43,308,32,15,'#d4bc9c');rect(33,373,9,47,'#614b3c');rect(133,373,9,47,'#614b3c');
 rect(0,FLOOR,W,H-FLOOR,'#292b2e');for(let x=0;x<W;x+=100){rect(x,FLOOR,97,8,'#806e5b');rect(x+3,FLOOR+10,95,45,'#38383a');}rect(175,FLOOR+8,315,34,'#5d4857');rect(184,FLOOR+12,297,25,'#705760');

 if(actorImages.mordecai){const d=actorDefinitions.mordecai, f=d.frames[guild?.done?0:1];ctx.drawImage(actorImages.mordecai,f.sx,f.sy,f.sw,f.sh,295-f.anchorX*d.scale,FLOOR-f.anchorY*d.scale,f.sw*d.scale,f.sh*d.scale);}
 else {text('MORDECAI',295,305,13,'#d8c2a0');rect(280,323,30,97,'#8d7b66');}
 if(guild?.lesson===0){ctx.strokeStyle='#dfc78a';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(455,FLOOR-4,24,7,0,0,Math.PI*2);ctx.stroke();}
}
function drawDozer(e){
 const damaged=e.hp<=e.max/2,weak=dozerWeak(e),x=e.x,y=e.y,bob=e.phase==='charge'?Math.sin(time*35)*2:Math.sin(time*9)*.5;
 ctx.save();ctx.translate(x,y);ctx.scale(e.face===-1?1:-1,1);
 if(actorImages.dozer){const d=actorDefinitions.dozer,f=d.frames[damaged?1:0];ctx.drawImage(actorImages.dozer,f.sx,f.sy,f.sw,f.sh,-f.anchorX*d.scale,-f.anchorY*d.scale+bob,f.sw*d.scale,f.sh*d.scale);}
 else{rect(-130,-100,240,95,'#6b7865');rect(-160,-55,50,60,'#b69b6c');rect(-90,-25,180,30,'#303438');rect(-10,-145,90,70,'#83785b');}
 if(weak){ctx.fillStyle='#ffb95566';ctx.beginPath();ctx.ellipse(76,-84,30+Math.sin(time*10)*3,34,0,0,Math.PI*2);ctx.fill();text('BOILER',75,-133,10,'#ffe1a4');}
 if(e.phase==='windup'){ctx.fillStyle=Math.sin(time*20)>0?'#ffe6a1':'#bf7337';ctx.beginPath();ctx.arc(-105,-84,8,0,Math.PI*2);ctx.fill();}
 if(damaged){for(let j=0;j<4;j++){const rise=(time*25+j*17)%65;ctx.fillStyle='#c9c3b333';ctx.beginPath();ctx.arc(70+Math.sin(time+j)*8,-140-rise,8+rise*.12,0,Math.PI*2);ctx.fill();}}
 ctx.restore();rect(x-174,y-237,348,60,'#101722db');text('LV 3 · MURDER DOZER · '+Math.ceil(e.hp)+' / '+e.max,x,y-205,12,'#edc799');rect(x-120,y-192,240,7,'#342d32');rect(x-120,y-192,240*e.hp/e.max,7,damaged?'#e08e65':'#b7bb88');
 const label=e.phase==='intro'?'KEEP YOUR EYES ON THE HEADLIGHTS':e.phase==='windup'?'CHARGE · JUMP!':e.phase==='slamWindup'?'BLADE SLAM · JUMP OR RETREAT':weak?'STALLED · ATTACK THE BOILER':damaged?'BOILER OVERHEATING':'';text(label,x,y-221,10,'#edc799');
 if(e.phase==='windup'||e.phase==='slamWindup'){ctx.strokeStyle='#f3ad76aa';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(e.phase==='windup'?Math.min(x,e.destination):x-235,FLOOR-3);ctx.lineTo(e.phase==='windup'?Math.max(x,e.destination):x+235,FLOOR-3);ctx.stroke();}
 if(target===e.id)text('▼',x,y-239,16,'#c5a1f4');
}

function frame(stamp){if(!last)last=stamp;acc+=Math.min((stamp-last)/1000,.08);last=stamp;while(acc>=DT){tick(DT);acc-=DT;}render();requestAnimationFrame(frame);}
window.addEventListener('keydown',e=>{const controlled=['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyJ','KeyK','KeyQ','KeyE','Slash','KeyP','KeyI','KeyT','KeyH','KeyF','KeyV','KeyG','Escape'];if(!controlled.includes(e.code)||e.target?.tagName==='SELECT')return;if(e.target instanceof HTMLButtonElement&&e.code==='Space')return;e.preventDefault();if(e.repeat)return;if(e.code==='KeyI'){inventory();return;}if(e.code==='KeyH'&&mode==='inventory'){if(s.hp<s.maxHp&&s.potions>0){resume();drinkPotion();}return;}if(e.code==='KeyP'||e.code==='Escape'){mode==='pause'||mode==='inventory'||mode==='reward'?resume():pause();return;}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();pressed.clear();aim=0;if(mode==='play')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='play')pause();});
$('donut-goal').onchange=()=>setDonutGoal($('donut-goal').value);$('stomp-button').onclick=()=>{barefootBreaker();canvas.focus({preventScroll:true});};$('decoy-button').onclick=()=>{royalDecoy();canvas.focus({preventScroll:true});};
$('inventory-button').onclick=inventory;$('hud-inventory').onclick=inventory;$('potion-button').onclick=()=>{drinkPotion();canvas.focus({preventScroll:true});};$('lesson-next').onclick=nextLesson;$('lesson-skip').onclick=nextLesson;$('lesson-repeat').onclick=()=>{setLesson(guild.lesson);canvas.focus({preventScroll:true});};$('lesson-exit').onclick=leaveGuild;$('lesson-help').onclick=guildTalk;
$('pause').onclick=()=>mode==='pause'||mode==='inventory'||mode==='reward'?resume():pause();$('help').onclick=()=>{if(mode==='play')pause(true);else if(mode==='setup')toast('Start the game, then use ? for the field guide');};
$('sound').onclick=()=>{sound=!sound;try{localStorage.setItem('dungeon-broadcast-sound',sound?'on':'off');}catch{}updateSound();beep(500,.12,'triangle');};
function updateSound(){$('sound').innerHTML='♪ <span>SOUND '+(sound?'ON':'OFF')+'</span>';$('sound').setAttribute('aria-label','Turn sound '+(sound?'off':'on'));$('sound').setAttribute('aria-pressed',String(sound));}
try{sound=localStorage.getItem('dungeon-broadcast-sound')==='on';}catch{}updateSound();
$('coop').onclick=()=>{if(guild)return;coop=!coop;cat.plan=null;cat.planTime=0;syncTactics();$('coop').innerHTML='P2 <span>'+(coop?'LEAVE':'JOIN')+'</span>';toast(coop?'PLAYER 2 · ARROWS + / TO CAST':'DONUT AI IS BACK');say(coop?'At last. Someone qualified to direct my talents.':'I was doing a splendid job on my own, actually.');canvas.focus({preventScroll:true});};
document.querySelectorAll('[data-key]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);const k=b.dataset.key;if(!keys.has(k))pressed.add(k);keys.add(k);});const release=()=>keys.delete(b.dataset.key);b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});
// Read-only structured observations are available for future planning experiments.
window.dungeon={observe:()=>clone({mode,room:s.room,guild:guild?{lesson:guild.lesson,done:guild.done,completed:guild.completed}:null,stats:{strength:s.str,intelligence:s.int,health:s.hp,bombs:s.bombs,potions:s.potions,audience:s.fame},player:p,companion:cat,enemies:alive(),objects:props,inventory:{bombs:s.bombs,traps:s.traps,potions:s.potions,upgrades:s.upgrades},progression:{level:s.level,xp:s.xp,punch:punchDamage(),magic:magicDamage(),bomb:bombDamage(),barrel:barrelDamage(),skills:s.skills,items:s.items,pendingRewards:s.pendingRewards},tactics:{goal:s.donutGoal,plan:cat.plan||null,control:coop?"player2":"planner",decoy,specials:s.specials,stompDamage:stompDamage()},projectiles:hostile,decisions:s.log}),version:'0.15.0'};
setup();loadActorImages();requestAnimationFrame(frame);loadBackgroundImages();
})();
