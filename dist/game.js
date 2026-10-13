/* Dungeon Broadcast. Fixed-step simulation, separate from canvas rendering.
   No accounts, remote inference, or runtime dependencies. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const canvas=$('game'), ctx=canvas.getContext('2d');
const W=1100,H=500,FLOOR=420,DT=1/60,SAVE='dungeon-broadcast-v1';
canvas.width=W*2;canvas.height=H*2;ctx.scale(2,2);
const roomNames=['Backstage','Goblin road crew','Supply room','Sponsor challenge','The Hoarder'];
const keys=new Set(), pressed=new Set();
let s, p, cat, enemies=[], props=[], platforms=[], bombs=[], shots=[], hostile=[], particles=[], floats=[];
let mode='setup',camera=0,time=0,shake=0,toastTime=0,banterTime=0,checkpoint='',coop=false,sound=false,audio;
let race='human',job='brawler',aim=0,target=null,last=0,acc=0,enemyID=0,interactable=null,roomWidth=1650;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.abs(a.x-b.x);
const clone=o=>JSON.parse(JSON.stringify(o));
const alive=()=>enemies.filter(e=>e.hp>0);
const near=(o,d=85)=>dist(p,o)<d&&Math.abs(p.y-(o.y??FLOOR))<95;
function fresh(){return {race,job,str:(race==='human'?3:2)+(job==='brawler'?2:0),int:(race==='human'?3:4)+(job==='saboteur'?2:0),hp:6,maxHp:6,bombs:0,traps:0,fame:0,room:0,seen:[],log:[],sponsor:false,cleared:[],flags:{},kills:0,smart:0};}
function beep(freq=220,dur=.08,type='square',vol=.035){if(!sound)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(40,freq/2),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}catch{}}
function say(text){$('banter').textContent='“'+text+'”';banterTime=5;}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');toastTime=3.3;}
function float(text,x,y,color='#ffbd79'){floats.push({text,x,y,life:1.4,color});}
function bits(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:(Math.random()-.5)*230,vy:-Math.random()*220,life:.4+Math.random()*.5,color,size:3+Math.random()*5});}
function event(text){s.log.push(text);}
function show(html){$('overlay').innerHTML='<div class="modal">'+html+'</div>';$('overlay').classList.remove('hidden');keys.clear();pressed.clear();aim=0;}
function hide(){ $('overlay').classList.add('hidden');$('overlay').innerHTML='';canvas.focus({preventScroll:true});keys.clear();pressed.clear();}
function save(){try{localStorage.setItem(SAVE,checkpoint);}catch{}}
function saved(){try{const v=JSON.parse(localStorage.getItem(SAVE));return v&&v.version===1&&v.state&&Number.isInteger(v.state.room)&&v.state.room>=0&&v.state.room<5?v:null;}catch{return null;}}
function sync(){
 $('trap-count').textContent=s.traps??0;$('inventory-count').textContent=s.bombs;$('inventory-status').textContent=s.bombs?'K · throw bomb    T · place trap':'T · place trap    I · open inventory';
 $('str').textContent=s.str;$('int').textContent=s.int;$('bombs').textContent=s.bombs;
 $('player-name').textContent=s.race==='goblin'?'CARL · GOBLIN':'CARL';
 $('health').innerHTML=Array.from({length:s.maxHp},(_,i)=>'<span class="heart '+(i<s.hp?'':'empty')+'">♥</span>').join('');$('health').setAttribute('aria-label',s.hp+' of '+s.maxHp+' health');
 $('fame').textContent=s.fame+(s.sponsor?' · GIFT SENT':' / 60');$('fame-fill').style.width=Math.min(100,s.fame/60*100)+'%';
 $('room-number').textContent='0'+(s.room+1)+' / 05';$('room-name').textContent=roomNames[s.room].toUpperCase();
 document.querySelectorAll('[data-room]').forEach(el=>{let r=+el.dataset.room;el.className=r===s.room?'active':s.cleared.includes(r)?'done':'';});
}
function award(key,amount,label,smart=false){
 if(s.seen.includes(key))return;s.seen.push(key);s.fame+=amount;if(smart){s.smart++;if(s.smart%2===0){s.int++;float('INT +1',p.x,p.y-100,'#c4a3f9');}}
 toast(label+'  ·  +'+amount+' AUDIENCE');beep(480,.16,'triangle');
 if(s.fame>=60&&!s.sponsor){s.sponsor=true;s.flags.giftPending=true;event('Earned a sponsor package');}
 sync();
}
function inventory(){
 if(mode==='inventory'){resume();return;}if(mode!=='play')return;mode='inventory';
 show('<div class="eyebrow">CARL’S INVENTORY · GAME PAUSED</div><h2>Save it for a good entrance.</h2><div class="inventory-item"><span class="bomb-symbol" aria-hidden="true"></span><div><strong>Goblin bombs <b>× '+s.bombs+'</b></strong><p>Collected, unlit, and ready whenever you are.</p></div><kbd>K</kbd></div><p>'+(s.bombs?'Hold K to see the throwing arc. Release to throw one bomb. Your remaining bombs stay in your inventory.':'No bombs left. Punch wooden crates, defeat goblins, and open cargo chests. Walk over a glowing bomb to collect it.')+'</p><div class="inventory-item"><span class="trap-symbol" aria-hidden="true">⌁</span><div><strong>Snare traps <b>× '+s.traps+'</b></strong><p>T to place · E to recover an unused trap.</p></div><kbd>T</kbd></div><p>A snare arms in one second and holds the first monster for '+(2+s.int*.15).toFixed(1)+' seconds (bosses: 1.5s). One active trap at a time. Carl and Donut can cross safely. Unused traps are packed when you leave a room.</p><button class="primary" id="close-inventory">Back to the dungeon →</button>');
 $('close-inventory').onclick=resume;
}
function dropBombs(x,count,source){
 for(let i=0;i<count;i++)props.push({type:'pickup',item:'bomb',x:clamp(x+(i-(count-1)/2)*45,35,roomWidth-45),y:FLOOR,active:true,delay:.35,source});
}
function broadcastClear(){const t=props.find(o=>o.type==='truck');return !!t&&t.phase==='parked'&&t.spawned===2&&!alive().length;}
function truckTick(t,dt){
 if(t.phase==='waiting'){if(p.x>360){t.phase='driving';toast('SPECIAL DELIVERY · GOBLIN ROAD CREW');say('They brought a truck into a dungeon. And you question my luggage.');beep(95,.3,'sawtooth',.035);}return;}
 if(t.phase==='driving'){t.x=Math.max(950,t.x-270*dt);t.smoke-=dt;if(t.smoke<=0){t.smoke=.15;bits(t.x+135,FLOOR-35,'#768077',2);}if(t.x===950){t.phase='unloading';t.timer=.4;shake=3;beep(120,.25,'sawtooth');event('The goblin road crew arrived by truck');}return;}
 if(t.phase==='unloading'){t.timer-=dt;if(t.timer<=0){const e=spawnEnemy(t.x+120);e.phase='arriving';e.y=FLOOR-60;e.vx=80+t.spawned*40;e.vy=-210;e.dropBomb=t.spawned===1;e.fromTruck=true;enemies.push(e);t.spawned++;t.timer=1;if(t.spawned===2){t.phase='parked';toast('GOBLIN ROAD CREW · DEFEAT BOTH TO CLAIM THE CARGO');}}}
}
function drawBombIcon(x,y){rect(x-9,y-7,18,15,'#343947');rect(x-6,y-11,12,4,'#676b74');rect(x-5,y-5,5,5,'#9ca4ab');rect(x+1,y-16,5,6,'#c5a778');rect(x+4,y-18,6,3,'#f3cb87');}
function drawTruck(t){if(t.phase==='waiting')return;const x=t.x,y=FLOOR-8+(t.phase==='driving'?Math.sin(time*30)*2:0);
 rect(x-153,y-10,306,12,'#0006');
 // Left-facing cab, rusty cargo bed, and an intentionally ridiculous sign.
 rect(x-132,y-71,286,42,'#595b4c');rect(x-135,y-36,292,12,'#343b40');
 rect(x-116,y-119,78,81,'#9f774c');rect(x-134,y-74,36,39,'#af8151');rect(x-111,y-115,72,7,'#d0a367');
 rect(x-107,y-103,29,29,'#83b3b0');rect(x-73,y-103,26,29,'#283c41');rect(x-103,y-100,8,21,'#b8d2b4');
 rect(x-133,y-66,9,16,'#ffe4a1');rect(x-143,y-38,27,10,'#8c9694');rect(x-51,y-63,11,4,'#343b40');
 rect(x-24,y-116,170,69,'#65765c');rect(x-24,y-116,170,9,'#8a9a76');
 for(let i=0;i<5;i++)rect(x-20+i*36,y-108,5,58,'#3f5148');rect(x-26,y-71,175,8,'#9a8764');
 rect(x-13,y-105,148,28,'#303d39');text('GOBLIN EXPRESS',x+61,y-86,12,'#e8cc8c');text('FRAGILE. PROBABLY.',x+58,y-55,8,'#d5c7a0');
 rect(x-3,y-145,11,30,'#4d4b47');rect(x-6,y-149,18,8,'#7b7364');
 for(const wx of [x-91,x+95]){rect(wx-23,y-32,46,40,'#20262d');rect(wx-27,y-25,54,25,'#20262d');rect(wx-14,y-23,28,23,'#8b8c80');rect(wx-7,y-17,14,12,'#414d4e');if(t.phase==='driving')rect(wx-2,y-23,4,23,'#b5ab8f');}
 if(t.phase==='unloading'||t.phase==='parked'){rect(x+146,y-50,9,39,'#817a59');rect(x+153,y-14,34,6,'#817a59');}
}
function spawnEnemy(x,type='goblin'){const boss=type==='boss',llama=type==='llama';return {id:++enemyID,type,x,y:FLOOR,vx:0,vy:0,hp:boss?100:llama?32:24,max:boss?100:llama?32:24,face:-1,cool:1,phase:'walk',timer:0,hit:0,w:boss?98:llama?62:35,h:boss?116:llama?76:47,attacked:false};}
function loadRoom(index,{persist=true}={}){
 s.traps??=(index>=2?2:0);s.room=index;p={x:100,y:FLOOR,vx:0,vy:0,face:1,onGround:true,cool:0,attack:0,inv:0};cat={x:55,y:FLOOR,vx:0,vy:0,cool:0,onGround:true,face:1};
 enemies=[];props=[];platforms=[];bombs=[];shots=[];hostile=[];particles=[];floats=[];camera=0;target=null;aim=0;roomWidth=1650;
 const prop=(type,x,extra={})=>props.push({type,x,y:FLOOR,active:true,...extra});
 if(index===0){prop('crate',370,{loot:1});prop('crate',870);platforms=[{x:570,y:365,w:150},{x:1090,y:330,w:160}];prop('sign',230,{text:'J · PUNCH'});prop('sign',570,{text:'SPACE · JUMP'});prop('door',1510,{label:'FIRST BROADCAST'});say('Try to look competent, Carl. We have an audience.');}
 if(index===1){prop('truck',1900,{phase:'waiting',spawned:0,timer:0,smoke:0});prop('barrel',640);prop('chest',1370,{kind:'bombs'});prop('door',1550,{label:'SUPPLY ROOM'});prop('sign',390,{text:'DELIVERIES →'});platforms=[{x:780,y:310,w:145}];say('A goblin delivery truck. Somehow, I doubt they brought flowers.');}
 if(index===2){enemies=[spawnEnemy(1230,'llama')];prop('crate',1080);prop('sign',250,{text:'T · SET A TRAP'});prop('switch',520);prop('wall',880);prop('chest',1000,{kind:'supply'});prop('door',1510,{label:'SPONSOR CHALLENGE'});platforms=[{x:720,y:325,w:135}];say('A Bad Llama. Set a trap, Carl. I refuse to be spat on for ratings.');}
 if(index===3){prop('lever',330);prop('trap',860);prop('barrel',690);prop('chest',1210,{kind:'challenge'});prop('door',1510,{label:'BOSS ARENA'});platforms=[{x:940,y:305,w:130}];say('Optional danger. Optional fame. My beauty, however, is compulsory.');}
 if(index===4){roomWidth=1750;enemies=[spawnEnemy(1130,'boss')];prop('barrel',690);prop('barrel',1370);prop('trap',920);prop('stairs',1580);prop('chest',1440,{kind:'boss'});prop('junkheap',470);prop('junkheap',1270);say('The Hoarder. All this storage, and not a single decent cat bed.');}
 // Snapshot before consuming a queued delivery so retries preserve that gift.
 if(persist){checkpoint=JSON.stringify({version:1,state:clone(s)});save();}
 if(s.flags.giftPending){s.flags.giftPending=false;prop('gift',240);}
 sync();
}
function setup(){mode='setup';s=fresh();loadRoom(0,{persist:false});const hasSave=!!saved();show('<div class="eyebrow">YOU HAVE BEEN SELECTED</div><h2>Make an entrance.</h2><p>Be Carl. Break things. Let Donut take the credit. Choose your starting style—every combination can finish the floor.</p><div class="selections"><div><span class="select-label">01 / RACE</span><div class="options"><button class="option selected" data-race="human"><strong>Human</strong><small>STR 3 · INT 3</small></button><button class="option" data-race="goblin"><strong>Goblin</strong><small>STR 2 · INT 4</small></button></div></div><div><span class="select-label">02 / CLASS</span><div class="options"><button class="option selected" data-job="brawler"><strong>Brawler</strong><small>+2 STR · heavy punches</small></button><button class="option" data-job="saboteur"><strong>Saboteur</strong><small>+2 INT · rewire traps</small></button></div></div></div><div class="loadout"><span id="loadout">STRENGTH 5 · INTELLIGENCE 3</span><span>♥ 6 health · Donut on your team</span></div><div class="modal-actions"><button class="primary" id="start">Enter the dungeon →</button>'+(hasSave?'<button class="quiet" id="continue">Continue saved floor →</button>':'<small>No timer. Room checkpoints.<br>Your own bombs won’t hurt you.</small>')+'</div><button class="quick-encounter quiet" id="try-encounter">Skip the tutorial · try the goblin truck →</button><button class="quick-encounter quiet" id="try-traps">Practice traps · face the Bad Llama →</button><button class="quick-encounter quiet" id="try-boss">Try the Hoarder boss →</button>');
 document.querySelectorAll('[data-race]').forEach(b=>b.onclick=()=>{race=b.dataset.race;updateChoice();});document.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>{job=b.dataset.job;updateChoice();});
 $('start').onclick=()=>{s=fresh();mode='play';loadRoom(0);hide();toast('A / D to move · SPACE to jump · J to punch');};
 $('try-encounter').onclick=()=>{s=fresh();s.bombs=1;s.cleared=[0];mode='play';loadRoom(1);p.x=420;cat.x=360;hide();toast('GOBLIN ENCOUNTER · ONE BOMB IN YOUR INVENTORY');};
 $('try-traps').onclick=()=>practice(2);$('try-boss').onclick=()=>practice(4);
 if(hasSave)$('continue').onclick=()=>{s=saved().state;race=s.race;job=s.job;mode='play';loadRoom(s.room);hide();toast('Room checkpoint restored');};updateChoice();
}
function updateChoice(){document.querySelectorAll('[data-race]').forEach(b=>b.classList.toggle('selected',b.dataset.race===race));document.querySelectorAll('[data-job]').forEach(b=>b.classList.toggle('selected',b.dataset.job===job));const st=fresh();$('loadout').textContent='STRENGTH '+st.str+' · INTELLIGENCE '+st.int;}
function pause(help=false){if(mode!=='play')return;mode='pause';show('<div class="eyebrow">BROADCAST PAUSED</div><h2>'+ (help?'A little field guide.':'Take a breath.')+'</h2><p>No timer. Think through your next move. Your own explosions never hurt you.</p><div class="help-grid"><span><kbd>A D</kbd> Move Carl</span><span><kbd>SPACE</kbd> Jump / dodge projectiles</span><span><kbd>J</kbd> Punch · push barrels</span><span><kbd>T</kbd> Place a snare · E recovers it</span><span><kbd>K</kbd> Hold to aim, release to throw</span><span><kbd>E</kbd> Open / use / enter a door</span><span><kbd>Q</kbd> Mark a target for Donut</span><span><kbd>I</kbd> Open inventory · pauses the game</span><span><kbd>P / ESC</kbd> Pause / resume</span><span><kbd>E</kbd> Rewire nearby traps as a Saboteur</span></div><p>Donut follows and casts automatically. In two-player mode: Carl uses A/D and Space; Donut uses ←/→, ↑ to jump, and / to cast. Stay within the same screen.</p><div class="modal-actions"><button class="primary" id="resume">Back to the show →</button><button class="quiet" id="retry">Restart this room</button></div>');$('resume').onclick=resume;$('retry').onclick=retry;}
function resume(){if(mode==='pause'||mode==='inventory'){mode='play';hide();}}
function retry(){if(!checkpoint)return;s=JSON.parse(checkpoint).state;mode='play';loadRoom(s.room);hide();toast('Room restarted · entry supplies restored');}
function hurt(){if(p.inv>0||mode!=='play')return;s.hp--;p.inv=1.5;shake=5;bits(p.x,p.y-30,'#e98770',8);beep(100,.17,'sawtooth');sync();if(s.hp<=0){mode='dead';show('<div class="eyebrow">A TEMPORARY INTERRUPTION</div><h2>You’re not cancelled. Yet.</h2><p>Restart this room with the health, upgrades, and supplies you had when you entered. Try a jump, a trap, or a different plan.</p><button class="primary" id="retry">Try the room again →</button>');$('retry').onclick=retry;say('A rehearsal. Obviously. Nobody broadcast that.');}}
function damage(e,amount,source='punch',direction=p.face){if(e.hp<=0)return;
 if(e.type==='boss'&&e.phase!=='stunned'&&!(e.snared>0)){amount=Math.max(1,Math.round(amount*.22));float('JUNK ARMOR',e.x,e.y-e.h-9,'#abb7c5');}else float('-'+Math.round(amount),e.x,e.y-e.h-8,source==='donut'?'#d4acf7':'#ffd19c');
 e.hp-=amount;e.hit=.14;if(e.type!=='boss'&&!(e.snared>0)){e.vx=direction*(s.job==='brawler'?290:200);e.x=clamp(e.x+direction*12,30,roomWidth-35);}bits(e.x,e.y-e.h/2,source==='donut'?'#bfa0f5':'#d9a479',5);
 if(source==='punch'){e.punched=time;if(e.type!=='boss')for(const other of enemies){if(other!==e&&other.hp>0&&Math.abs(other.x-e.x)<70){damage(other,5,'collision',direction);award('collision'+s.room,15,'MONSTER DOMINOES',true);}}}
 if(source==='explosion'&&e.snared>0)award('snare-combo'+s.room,20,'PLANNED TO PERFECTION',true);
 if(source==='donut'&&e.punched&&time-e.punched<3)award('team'+s.room,12,'TEAMWORK MAKES GOOD TELEVISION',true);
 if(e.hp<=0){e.hp=0;s.kills++;if(e.type==='llama'){event('Defeated the Bad Llama');say('Appalling manners. Excellent target practice.');}if(e.dropBomb)dropBombs(e.x,1,'goblin');bits(e.x,e.y-e.h/2,e.type==='boss'?'#ffb36d':'#a4bf8a',22);beep(170,.18);if(source==='explosion'||source==='trap')award(source+s.room,20,source==='trap'?'MIND YOUR STEP!':'EXPLOSIVE ENTRANCE',true);if(e.type==='boss'){s.flags.bossDead=true;s.str++;s.int++;s.hp=s.maxHp;award('boss',25,'BOSS DOWN · STR +1 · INT +1');event('Defeated The Hoarder');say('I did the difficult part. You may carry the chest.');}sync();}
}
function punch(){if(p.cool>0)return;p.cool=.34;p.attack=.18;beep(140,.05,'triangle');
 const close=alive().filter(e=>dist(p,e)<88&&Math.abs(p.y-e.y)<70).sort((a,b)=>dist(p,a)-dist(p,b))[0];if(close)p.face=Math.sign(close.x-p.x)||p.face;
 for(const e of alive())if(dist(p,e)<92&&Math.abs(p.y-e.y)<70&&(e.x-p.x)*p.face>-20)damage(e,5+s.str,'punch',p.face);
 for(const o of props){if(!o.active||!near(o,90)||(o.x-p.x)*p.face<-22)continue;if(o.type==='crate'){o.active=false;bits(o.x,o.y-20,'#a17a50',14);award('crate',5,'CAMERA TEST COMPLETE');if(o.loot)dropBombs(o.x,o.loot,'crate');}if(o.type==='barrel'){o.vx=p.face*(s.job==='brawler'?390:290);o.fuse=o.fuse??1.5;toast('BARREL LIT · MOVE IT INTO POSITION');}}
}
function throwBomb(){if(!aim)return;if(s.bombs>0){s.bombs--;const power=clamp(aim,0,1);bombs.push({x:p.x+p.face*22,y:p.y-35,vx:p.face*(235+power*150),vy:-250-power*100,fuse:1.45});beep(270,.08,'triangle');sync();}else toast('No bombs · find a chest or sponsor gift');aim=0;}
function explode(x,y,r=142){shake=8;bits(x,y,'#ffb267',40);particles.push({x,y,vx:0,vy:0,life:.3,color:'#ffe0a0',radius:r});beep(70,.3,'sawtooth',.08);let hits=0;
 for(const e of alive())if(Math.hypot(e.x-x,e.y-25-y)<r){damage(e,16+s.int*3,'explosion',Math.sign(e.x-x)||1);hits++;}
 if(hits>1){award('multi'+s.room,25,'MULTI-HIT MAYHEM',true);say('An actual plan! I shall revise my expectations.');}
 for(const o of props){if(!o.active||Math.abs(o.x-x)>r)continue;if(o.type==='barrel'){o.active=false;setExplosion(o.x,o.y-25);award('chain'+s.room,15,'CHAIN REACTION',true);}if(o.type==='wall'){o.active=false;s.flags.wallOpen=true;event('Spent an explosive to open the supply cache');bits(o.x,o.y-70,'#748087',35);award('wall',12,'A NEW OPENING',true);say('Subtle. I believe the wall has accepted your argument.');}if(o.type==='crate'){o.active=false;bits(o.x,o.y-20,'#a17a50',12);if(o.loot)dropBombs(o.x,o.loot,'crate');}}
}
function setExplosion(x,y){bombs.push({x,y,vx:0,vy:0,fuse:.12,fixed:true});}
function cast(){if(cat.cool>0)return;const choices=alive().filter(e=>dist(cat,e)<600);const e=choices.find(e=>e.id===target)||choices.sort((a,b)=>dist(cat,a)-dist(cat,b))[0];if(!e){if(coop)toast('Donut needs a monster in range');return;}cat.cool=1.5;cat.face=Math.sign(e.x-cat.x)||1;const dx=e.x-cat.x,dy=e.y-e.h/2-(cat.y-23),len=Math.hypot(dx,dy)||1;shots.push({x:cat.x,y:cat.y-23,vx:dx/len*420,vy:dy/len*420,life:1.7});beep(660,.12,'sine',.025);}
function mark(){const list=alive().filter(e=>dist(e,p)<650).sort((a,b)=>a.x-b.x);if(!list.length){toast('No monsters nearby to target');return;}const i=list.findIndex(e=>e.id===target);target=list[(i+1)%list.length].id;toast('TARGET MARKED · DONUT WILL FOCUS FIRE');}
function interaction(){
 let list=props.filter(o=>o.active&&near(o,o.type==='stairs'?100:82));
 if(s.room===3&&!s.flags.challengeStarted&&!s.flags.challengeCleared)list=list.filter(o=>o.type!=='trap');
 list=list.filter(o=>o.type!=='snare'||!o.spent);
 const order={snare:-1,gift:0,chest:1,lever:2,switch:2,trap:3,door:4,stairs:4,wall:5};list=list.filter(o=>order[o.type]!==undefined).sort((a,b)=>(order[a.type]-order[b.type])||dist(p,a)-dist(p,b));return list[0]||null;
}
function promptFor(o){if(!o)return '';if(o.type==='snare')return 'E · Recover unused trap'+(o.arm>0?' · arming…':' · armed');if(o.type==='door'){if(s.room===1&&!broadcastClear())return 'Defeat the goblin road crew';if(s.room===1&&!s.flags.bombsChest)return 'E at the cargo chest · collect your loot';if(s.room===1&&props.some(v=>v.active&&v.type==='pickup'&&v.source==='cargo'))return 'Walk over the dropped cargo bombs to collect them';if(s.room===2&&!s.flags.exitSwitch)return 'Use the exit switch on the left first';if(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared)return 'Finish the challenge to open the door';return 'E · '+(s.room===3&&!s.flags.challengeStarted?'Skip challenge → boss arena':'Enter '+o.label.toLowerCase());}
 if(o.type==='chest'){if(o.open)return '';if(o.kind==='bombs'&&!broadcastClear())return 'Cargo locked · defeat the goblin road crew';if(o.kind==='supply'&&!s.flags.wallOpen)return 'Cracked wall · hold K to aim a bomb, release to throw';if(o.kind==='challenge'&&!s.flags.challengeCleared)return 'Win the sponsor challenge to unlock';if(o.kind==='boss'&&!s.flags.bossDead)return 'Boss reward · defeat The Hoarder';return 'E · Open '+(o.kind==='supply'?'supply cache · heal +2, STR +1':'loot chest');}
 if(o.type==='switch')return s.flags.exitSwitch?'Exit unlocked':'E · Unlock exit (keep your bombs)';if(o.type==='lever')return s.flags.challengeStarted?'Challenge accepted':'E · Accept optional sponsor challenge';if(o.type==='trap')return s.job==='saboteur'?(o.rewired?'Trap rewired · monsters only':'E · Rewire trap · make it safe for Carl'):'Floor trap · lure monsters here, then jump';if(o.type==='wall')return 'Cracked wall · a bomb could reveal supplies';if(o.type==='gift')return 'E · Sponsor gift · +1 bomb and heal +1';if(o.type==='stairs')return s.flags.bossLoot?'E · Descend the stairs':s.flags.bossDead?'Open the boss chest before descending':'Stairs sealed · defeat the boss';return '';}
function use(){const o=interaction();if(!o)return;if(o.type==='snare'&&!o.spent){o.active=false;s.traps++;sync();toast('UNUSED TRAP RECOVERED');return;}if(o.type==='door'){
 if((s.room===1&&(!s.flags.bombsChest||!broadcastClear()||props.some(v=>v.active&&v.type==='pickup'&&v.source==='cargo')))||(s.room===2&&!s.flags.exitSwitch)||(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared)){toast(promptFor(o));return;}
 if(s.room===2&&!s.flags.wallOpen)event('Kept bombs instead of opening the supply cache');if(s.room===3&&!s.flags.challengeStarted){s.flags.skippedChallenge=true;event('Skipped the optional sponsor challenge');}
 packTraps();s.cleared.push(s.room);s.hp=Math.min(s.maxHp,s.hp+1);loadRoom(s.room+1);toast('ROOM CHECKPOINT · +1 HEALTH');return;}
 if(o.type==='chest'&&!o.open){if(o.kind==='bombs'&&!broadcastClear()||o.kind==='supply'&&!s.flags.wallOpen||o.kind==='challenge'&&!s.flags.challengeCleared||o.kind==='boss'&&!s.flags.bossDead){toast(promptFor(o));return;}o.open=true;beep(720,.2,'triangle');bits(o.x,o.y-40,'#ffd17e',16);
 if(o.kind==='bombs'){dropBombs(o.x,2,'cargo');s.traps+=2;s.flags.bombsChest=true;toast('2 TRAP KITS STOWED · COLLECT THE BOMBS');say('Traps! A plan you can put on the floor. Press T to place one.');event('Looted two snare trap kits from the goblin cargo');}
 if(o.kind==='supply'){s.hp=Math.min(s.maxHp,s.hp+2);s.str++;s.flags.supplyLoot=true;toast('SUPPLY CACHE · HEAL +2 · STRENGTH +1');event('Collected the supply cache: strength +1');}
 if(o.kind==='challenge'){dropBombs(o.x,2,'challenge');s.hp=Math.min(s.maxHp,s.hp+1);toast('SPONSOR STASH · 2 BOMBS TO PICK UP · HEAL +1');event('Collected the sponsor challenge reward');}
 if(o.kind==='boss'){s.flags.bossLoot=true;const style=s.smart>=2?'Demolition darling':'Heavyweight favorite';s.flags.sponsorTitle=style;s.bombs+=s.smart>=2?2:1;if(s.smart<2)s.str++;toast(style.toUpperCase()+' · STAIRS UNLOCKED');event('Boss reward: '+style);}
 sync();return;}
 if(o.type==='switch'){s.flags.exitSwitch=true;toast('EXIT OPEN · SUPPLY CACHE IS OPTIONAL');}
 if(o.type==='lever'&&!s.flags.challengeStarted){s.flags.challengeStarted=true;enemies=[spawnEnemy(780),spawnEnemy(1100),spawnEnemy(1260)];toast('SPONSOR CHALLENGE · THREE MONSTERS');event('Accepted the optional sponsor challenge');say('Excellent. More witnesses to my magnificence.');}
 if(o.type==='trap'&&s.job==='saboteur'&&!o.rewired){o.rewired=true;award('rewire'+s.room,12,'TRAP REWIRED',true);event('Rewired a floor trap');}
 if(o.type==='gift'){o.active=false;s.bombs++;s.hp=Math.min(s.maxHp,s.hp+1);toast('SPONSOR GIFT · +1 BOMB · HEAL +1');say('A gift for us. Mostly for me, spiritually.');sync();}
 if(o.type==='stairs'&&s.flags.bossLoot)finish();
}
function finish(){packTraps();s.cleared.push(4);mode='win';try{localStorage.removeItem(SAVE);}catch{}sync();show('<div class="eyebrow">FLOOR 01 CLEARED · BROADCAST COMPLETE</div><h2>Going down. Ratings going up.</h2><p>Carl and Donut take the stairs. Your next-floor loadout is ready. This prototype ends here—the next floor is still backstage.</p><div class="result-grid"><div><strong>'+s.str+' / '+s.int+'</strong><small>STRENGTH / INTELLIGENCE</small></div><div><strong>'+s.fame+'</strong><small>AUDIENCE POINTS</small></div><div><strong>'+s.bombs+'</strong><small>BOMBS CARRIED DOWN</small></div></div><p><b>'+s.flags.sponsorTitle+'</b><br>'+(s.flags.wallOpen?'You opened the supply cache.':'You saved your explosives in the supply room.')+' '+(s.flags.challengeCleared?'You won the sponsor challenge.':'You took the safer route to the boss.')+'</p><div class="modal-actions"><button class="primary" id="again">Try another build →</button><button class="quiet" id="export">Save run summary ↓</button></div>');$('again').onclick=setup;$('export').onclick=exportRun;say('I accept your applause. Carl is also here.');}
function exportRun(){const report={game:'Dungeon Broadcast',floor:1,race:s.race,class:s.job,strength:s.str,intelligence:s.int,health:s.hp,bombs:s.bombs,traps:s.traps,audience:s.fame,decisions:s.log};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='dungeon-broadcast-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function physics(a,dt){const old=a.y;a.vy+=1250*dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.onGround=false;if(a.y>=FLOOR){a.y=FLOOR;a.vy=0;a.onGround=true;}for(const f of platforms){if(a.x>f.x-10&&a.x<f.x+f.w+10&&old<=f.y+2&&a.y>=f.y&&a.vy>=0){a.y=f.y;a.vy=0;a.onGround=true;}}a.x=clamp(a.x,30,roomWidth-40);}
function tick(dt){if(mode==='play'||mode==='setup')time+=dt;if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').classList.remove('show');}if(mode!=='play'){pressed.clear();return;}banterTime-=dt;shake=Math.max(0,shake-30*dt);p.cool=Math.max(0,p.cool-dt);p.attack=Math.max(0,p.attack-dt);p.inv=Math.max(0,p.inv-dt);cat.cool=Math.max(0,cat.cool-dt);
 let move=(keys.has('KeyD')||!coop&&keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||!coop&&keys.has('ArrowLeft')?1:0);p.vx=move*(keys.has('KeyK')?120:245);if(move)p.face=move;
 if((pressed.has('Space')||!coop&&pressed.has('ArrowUp')||pressed.has('KeyW'))&&p.onGround){p.vy=-540;beep(260,.09,'triangle');}
 physics(p,dt);if(keys.has('KeyJ'))punch();if(keys.has('KeyK'))aim=clamp(aim+dt,.02,1);else if(aim)throwBomb();if(pressed.has('KeyQ'))mark();if(pressed.has('KeyT'))placeSnare();if(pressed.has('KeyE')){use();if(mode!=='play'){pressed.clear();return;}}
 if(coop){const cm=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);cat.vx=cm*265;if(cm)cat.face=cm;if(pressed.has('ArrowUp')&&cat.onGround)cat.vy=-520;if(keys.has('Slash'))cast();}
 else{const desired=p.x-p.face*62,delta=desired-cat.x;cat.vx=clamp(delta*4,-270,270);if(Math.abs(cat.vx)>10)cat.face=Math.sign(cat.vx);if(cat.onGround&&p.y<cat.y-45)cat.vy=-530;if(alive().some(e=>dist(e,p)<480))cast();}
 physics(cat,dt);cat.x=clamp(cat.x,Math.max(25,p.x-430),Math.min(roomWidth-25,p.x+430));
 for(const e of alive()){e.hit=Math.max(0,e.hit-dt);e.cool-=dt;e.timer-=dt;e.previousX=e.x;
 if(e.snared>0){e.snared=Math.max(0,e.snared-dt);e.vx=0;if(e.snared===0){e.phase='walk';e.cool=1;}continue;}
 if(e.type==='llama'){llamaTick(e,dt);continue;}
 if(e.type==='boss'){bossTick(e,dt);continue;}
 if(e.phase==='arriving'){physics(e,dt);if(e.onGround){e.phase='walk';e.vx=0;}continue;}
 if(e.phase==='windup'){e.vx=0;if(e.timer<=0){if(dist(e,p)<77&&Math.abs(p.y-e.y)<65)hurt();e.phase='recover';e.timer=.6;}}
 else if(e.phase==='recover'){if(e.timer<=0)e.phase='walk';e.vx*=.85;}
 else if(Math.abs(e.vx)>130){e.vx*=.9;}
 else if(dist(e,p)<600||e.fromTruck){e.face=Math.sign(p.x-e.x)||1;if(dist(e,p)<61&&Math.abs(p.y-e.y)<65){e.phase='windup';e.timer=.65;e.vx=0;}else e.vx=e.face*58;}
 else e.vx=0;
 e.x=clamp(e.x+e.vx*dt,40,roomWidth-70);
 }
 for(const o of props){if(!o.active)continue;
 if(o.type==='truck')truckTick(o,dt);if(o.type==='snare')snareTick(o,dt);
 if(o.type==='pickup'){o.delay-=dt;if(o.delay<=0&&near(o,34)){o.active=false;s.bombs++;float('+1 BOMB',p.x,p.y-74,'#f5cf8f');beep(780,.12,'triangle');sync();$('inventory-button').classList.add('collected');toast('BOMB ADDED TO INVENTORY · HOLD K TO AIM');if(!s.flags.firstPickup){s.flags.firstPickup=true;say('Put that in your inventory, Carl. We may need a dramatic exit.');}}}
 if(o.type==='barrel'){if(o.vx){o.x=clamp(o.x+o.vx*dt,35,roomWidth-35);o.vx*=.987;}if(o.fuse!=null){o.fuse-=dt;if(o.fuse<=0){o.active=false;explode(o.x,o.y-25);}}}
 if(o.type==='trap'){const active=Math.sin(time*2.3)>-.1;o.firing=active;if(active){if(near(o,43)&&p.y>FLOOR-35&&!o.rewired)hurt();for(const e of alive())if(dist(e,o)<50&&!e.trapCooldown){damage(e,20,'trap',Math.sign(e.x-o.x)||1);e.trapCooldown=1.2;}}}
 }
 for(const e of enemies)if(e.trapCooldown)e.trapCooldown=Math.max(0,e.trapCooldown-dt);
 for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.fuse-=dt;if(!b.fixed){b.vy+=750*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.y>FLOOR-10){b.y=FLOOR-10;b.vy*=-.35;b.vx*=.65;}if(b.x<15||b.x>roomWidth-15){b.vx*=-.5;b.x=clamp(b.x,15,roomWidth-15);}}if(b.fuse<=0){bombs.splice(i,1);explode(b.x,b.y);}}
 hostileTick(dt);
 for(let i=shots.length-1;i>=0;i--){const b=shots[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;const e=alive().find(e=>Math.abs(e.x-b.x)<e.w/2+10&&b.y>e.y-e.h-10&&b.y<e.y+8);if(e){damage(e,5,'donut',Math.sign(b.vx));b.life=0;}if(b.life<=0)shots.splice(i,1);}
 if(s.room===3&&s.flags.challengeStarted&&!s.flags.challengeCleared&&!alive().length){s.flags.challengeCleared=true;award('challenge',25,'SPONSOR CHALLENGE COMPLETE');say('Naturally they loved us. Open our tribute.');}
 if(s.flags.giftPending&&!alive().some(e=>dist(e,p)<400)){s.flags.giftPending=false;props.push({type:'gift',x:clamp(p.x+95,60,roomWidth-100),y:FLOOR,active:true});toast('SPONSOR DELIVERY · A GIFT HAS ARRIVED');}
 for(const a of particles){a.life-=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.vy+=400*dt;}particles=particles.filter(a=>a.life>0);for(const f of floats){f.y-=24*dt;f.life-=dt;}floats=floats.filter(f=>f.life>0);
 camera+= (clamp(p.x-W*.35,0,roomWidth-W)-camera)*Math.min(1,dt*7);
 interactable=interaction();const text=promptFor(interactable);$('prompt').textContent=text;$('prompt').style.display=text?'block':'none';pressed.clear();
}
function practice(room){s=fresh();s.bombs=3;s.traps=2;s.cleared=Array.from({length:room},(_,i)=>i);s.flags.bombsChest=true;mode='play';loadRoom(room);p.x=room===2?680:600;cat.x=p.x-60;camera=clamp(p.x-W*.35,0,roomWidth-W);hide();toast('PRACTICE LOADOUT · 3 BOMBS · 2 SNARE TRAPS');}
function placeSnare(){
 if(mode!=='play')return;if(!p.onGround||p.y!==FLOOR){toast('Place traps on the dungeon floor');return;}
 if(props.some(o=>o.type==='snare'&&o.active&&!o.spent)){toast('One active snare · use E to recover it first');return;}
 if(s.traps<=0){toast('No trap kits · loot the goblin cargo');return;}
 s.traps--;props.push({type:'snare',x:p.x,y:FLOOR,active:true,arm:1,spent:false});sync();beep(310,.1,'triangle');toast('SNARE ARMING · LURE A MONSTER OVER IT');
}
function packTraps(){for(const o of props)if(o.type==='snare'&&o.active&&!o.spent){s.traps++;o.active=false;}}
function snareTick(o,dt){
 if(o.spent){o.life-=dt;if(o.life<=0)o.active=false;return;}if(o.arm>0){o.arm=Math.max(0,o.arm-dt);return;}
 const e=alive().find(e=>Math.abs(e.y-o.y)<28&&(Math.abs(e.x-o.x)<36||Math.min(e.previousX??e.x,e.x)<=o.x&&Math.max(e.previousX??e.x,e.x)>=o.x));
 if(!e)return;o.spent=true;o.life=2;e.snared=e.type==='boss'?1.5:2+s.int*.15;e.vx=0;e.phase=e.type==='boss'?'stunned':'recover';e.timer=e.snared;
 bits(o.x,o.y-10,'#b8d6a0',12);float('SNARED!',e.x,e.y-e.h-15,'#badbab');award('snare'+s.room,15,'A LITTLE FORWARD PLANNING',true);event('Caught '+(e.type==='boss'?'the Hoarder':e.type==='llama'?'a Bad Llama':'a goblin')+' in a placed snare');
}
function llamaTick(e,dt){
 e.face=Math.sign(p.x-e.x)||1;
 if(e.phase==='windup'){e.vx=0;if(e.timer<=0){const x=e.x+e.face*33,y=e.y-58,dx=p.x-x,dy=p.y-28-y,len=Math.hypot(dx,dy)||1;hostile.push({type:'spit',x,y,vx:dx/len*265,vy:dy/len*265,life:3});e.phase='recover';e.timer=.85;e.cool=1.8;beep(170,.08,'sawtooth',.02);}return;}
 if(e.phase==='recover'){if(e.timer<=0)e.phase='walk';return;}
 const d=dist(e,p);if(d>620){e.vx=0;return;}if(e.cool<=0){e.phase='windup';e.timer=.95;return;}
 e.vx=d<210?-e.face*70:d>370?e.face*55:0;e.x=clamp(e.x+e.vx*dt,200,roomWidth-220);
}
function tossJunk(e){const x=e.x+e.face*35,y=e.y-84,flight=1.05,gravity=820;hostile.push({type:'junk',x,y,vx:(e.targetX-x)/flight,vy:(FLOOR-20-y-.5*gravity*flight*flight)/flight,gravity,life:flight+.25,targetX:e.targetX});beep(100,.12,'sawtooth',.03);}
function bossTick(e,dt){
 if(e.phase==='walk'){e.face=Math.sign(p.x-e.x)||-1;e.x=clamp(e.x+e.face*52*dt,115,roomWidth-180);if(e.cool<=0&&dist(e,p)<640){e.phase='windup';e.timer=1.1;e.throws=0;e.targetX=p.x;toast('THE HOARDER IS AIMING · MOVE OFF THE MARK');}}
 else if(e.phase==='windup'){if(e.timer<=0){tossJunk(e);e.throws++;e.phase='between';e.timer=.7;}}
 else if(e.phase==='between'){if(e.timer<=0){if(e.throws<3){e.phase='windup';e.timer=.8;e.targetX=p.x;}else{e.phase='stunned';e.timer=3.5;toast('THE HOARDER IS WINDED · ATTACK NOW');}}}
 else if(e.phase==='stunned'){if(e.timer<=0){e.phase='walk';e.cool=.8;}}
}
function hostileTick(dt){
 for(let i=hostile.length-1;i>=0;i--){const b=hostile[i];b.life-=dt;b.vy+=(b.gravity||0)*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
 if(b.type==='spit'){const cover=props.find(o=>o.active&&(o.type==='crate'||o.type==='wall')&&Math.abs(o.x-b.x)<27&&b.y>o.y-(o.type==='wall'?120:55)&&b.y<o.y);if(cover){b.life=0;bits(b.x,b.y,'#b5c68b',5);}}
 if(b.life>0&&Math.abs(b.x-p.x)<(b.type==='junk'?30:23)&&b.y>p.y-48&&b.y<p.y+5){hurt();b.life=0;bits(b.x,b.y,b.type==='spit'?'#a7bf78':'#a79d80',7);}
 if(b.y>=FLOOR-4){if(b.type==='junk'){bits(b.x,FLOOR-9,'#a69c86',10);if(Math.abs(p.x-b.x)<40&&p.y>FLOOR-35)hurt();}b.life=0;}
 if(b.life<=0||b.x<0||b.x>roomWidth)hostile.splice(i,1);
 }
}
// Canvas art is deliberately drawn on a coarse pixel grid.
function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function text(t,x,y,size=12,color='#d9cebb',align='center'){ctx.fillStyle=color;ctx.font=`${size}px monospace`;ctx.textAlign=align;ctx.fillText(t,Math.round(x),Math.round(y));}
function arch(x,y,w,h){rect(x-12,y+25,w+24,h-25,'#303943');rect(x,y+30,w,h-30,'#101923');rect(x+12,y+13,w-24,18,'#101923');rect(x+28,y,w-56,16,'#101923');rect(x-8,y+29,9,h-29,'#434b50');rect(x+w,y+29,8,h-29,'#242e39');for(let j=0;j<5;j++){rect(x-12,y+55+j*37,13,4,'#17232d');rect(x+w,y+55+j*37,13,4,'#17232d');}}
function torch(x,y){rect(x-3,y,7,33,'#67564a');rect(x-8,y+4,17,8,'#343039');const flick=Math.sin(time*12+x)*3;ctx.fillStyle='#ffa55712';ctx.beginPath();ctx.arc(x,y-9,55+flick,0,Math.PI*2);ctx.fill();rect(x-8,y-21+flick,16,25,'#e77d49');rect(x-4,y-26-flick,9,23,'#ffb86c');rect(x-2,y-12,6,15,'#ffe6a6');}
function banner(x,label,color='#764442'){rect(x,111,73,109,color);rect(x+5,116,63,88,'#00000018');rect(x+8,220,57,6,color);rect(x+17,226,39,6,color);rect(x+26,232,21,6,color);rect(x-7,107,87,6,'#927756');text(label,x+36,162,22,'#e2bd87');text('DB',x+36,192,13,'#c5a479');}
function background(){rect(0,0,W,H,'#17212d');
 for(let row=0;row<9;row++){const yy=28+row*45;for(let col=-2;col<14;col++){const xx=col*118+(row%2?59:0)-(camera*.3%118);rect(xx,yy,114,41,(row+col)%3===0?'#202b37':'#1d2834');rect(xx+3,yy+3,107,2,'#26323e');}}
 for(let i=0;i<6;i++){let x=i*340-130-camera*.52;arch(x,119,134,280);rect(x+18,180,98,217,'#111a26');for(let j=0;j<3;j++)rect(x+30+j*32,177,5,220,'#222e3b');}
 for(let i=0;i<7;i++){let x=i*310+155-camera*.75;rect(x,64,25,357,'#2c3640');rect(x-5,68,35,13,'#444a4e');rect(x+2,82,5,334,'#38424b');rect(x-6,398,37,22,'#333d45');torch(x+12,216);}
 banner(260-camera*.7,s.room===4?'♜':'I',s.room===4?'#694251':'#60473f');banner(890-camera*.7,'I','#4a405d');
 const grad=ctx.createLinearGradient(0,250,0,430);grad.addColorStop(0,'#0d182300');grad.addColorStop(1,'#0c142b77');ctx.fillStyle=grad;ctx.fillRect(0,210,W,220);
 rect(0,FLOOR,W,80,'#131c25');rect(0,FLOOR,W,7,'#777263');rect(0,FLOOR+7,W,9,'#41484a');
 for(let i=-1;i<18;i++){let x=i*83-(camera%83);rect(x,FLOOR+17,79,30,'#2c343b');rect(x+4,FLOOR+20,72,3,'#374048');rect(x+38,FLOOR+49,79,29,'#252d36');}
 for(let i=0;i<35;i++){const x=(i*157.7+Math.sin(time*.2+i)*15-camera*.2)%W,y=90+(i*73.1)%300;rect(x,y,2,2,'#dec6a52b');}
}
function pixelSprite(rows,palette,x,y,scale=3,flip=false){ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip)ctx.scale(-1,1);const w=rows[0].length;for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){const color=palette[rows[r][c]];if(color)rect((c-w/2)*scale,r*scale,scale,scale,color);}ctx.restore();}
const monsterSprite=['.....rrrrr......','....rrrrrrr.....','g..ggggggggg..g.','.ggggggggggggg..','..ggwggggwggg...','...gggnggggg....','....gkkwggg.....','....hhhhhh......','...hhhbhhhh.....','..gghhbhhhgg....','..gghhbhhhgg....','....bbbbbb......','....bb..bb......','...ggg..ggg.....'];
// Display-only character art. Feet remain anchored to the simulation positions;
// the larger silhouettes do not change reach, collision, or platform movement.
// Smooth, shaded cartoon artwork; gameplay still uses the original simulation.
function drawCarl(){
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
 ctx.restore();text('CARL',p.x,p.y-112,10,'#f4cfac');
}
function drawCat(){
 const moving=cat.onGround&&Math.abs(cat.vx)>10,step=moving?Math.sin(time*18):0;
 const bob=moving?Math.abs(step):Math.sin(time*2.4)*.5,casting=cat.cool>1.25;
 rect(cat.x-29,cat.y-2,58,5,'#0006');ctx.save();ctx.translate(Math.round(cat.x),Math.round(cat.y));ctx.scale(cat.face*1.65,1.65);
 // A full, gently swaying Persian tail behind the cape.
 const swish=Math.round(Math.sin(time*3)*2);
 rect(-18,-17+swish,5,14,'#282431');rect(-22,-23+swish,7,13,'#282431');rect(-24,-22+swish,6,6,'#282431');
 rect(-21,-21+swish,5,12,'#bf8a61');rect(-23,-21+swish,4,5,'#f1d2a0');rect(-18,-13+swish,4,9,'#6d4c47');rect(-17,-8+swish,7,4,'#c99b73');
 // Body silhouette and purple cape with a gold clasp.
 rect(-13,-20,25,17,'#282431');rect(-15,-16,29,10,'#282431');rect(-12,-19,22,14,'#d5aa7c');rect(-13,-14,26,7,'#efcf9e');
 rect(-13,-19,10,12,'#65416f');rect(-14,-12,12,6,'#80598c');rect(-13,-7,12,2,'#c294b9');rect(-10,-18,3,7,'#ab7eab');
 rect(2,-17,10,9,'#f6deb2');rect(0,-9,11,4,'#e9c697');
 // Small walking paws, always attached to the platform surface.
 const paw=cat.onGround?Math.round(step):0;
 rect(-9,-5+paw,7,5,'#282431');rect(6,-5-paw,7,5,'#282431');rect(-8,-4+paw,5,3,'#f4d8ac');rect(7,-4-paw,5,3,'#f7e4c0');
 ctx.translate(0,-Math.round(bob));
 // Fluffy head, pointed ears, tortoiseshell patches and cheek tufts.
 rect(-9,-29,7,10,'#282431');rect(8,-29,7,10,'#282431');rect(-7,-28,4,6,'#c39279');rect(10,-28,3,6,'#e1b193');
 rect(-9,-24,24,14,'#282431');rect(-12,-21,30,8,'#282431');rect(-7,-12,22,3,'#282431');
 rect(-8,-24,22,13,'#ddb58a');rect(-10,-20,27,6,'#f1d1a4');rect(-6,-13,19,3,'#e8c392');
 rect(-7,-24,8,7,'#6f4e46');rect(-9,-21,8,5,'#976751');rect(-7,-16,5,3,'#bb895f');rect(7,-24,7,5,'#f8e4bf');
 // Wide green eyes and little pink nose; whiskers show at normal game scale.
 rect(-4,-20,6,4,'#414136');rect(7,-20,6,4,'#414136');rect(-3,-20,4,3,'#aad28d');rect(8,-20,4,3,'#badb97');rect(-1,-20,1,3,'#232b31');rect(10,-20,1,3,'#232b31');rect(-3,-20,1,1,'#fff6dc');rect(8,-20,1,1,'#fff6dc');
 rect(0,-15,11,4,'#fff0ce');rect(4,-16,3,2,'#bf7d83');rect(5,-14,1,2,'#8a5a60');rect(2,-12,3,1,'#b88978');rect(6,-12,3,1,'#b88978');
 rect(-11,-16,7,1,'#dfbfac');rect(-12,-13,8,1,'#dfbfac');rect(13,-16,7,1,'#dfbfac');rect(13,-13,8,1,'#dfbfac');
 // Five-point crown with warm highlights and a purple center jewel.
 rect(-5,-31,17,6,'#6b483c');rect(-6,-35,4,7,'#6b483c');rect(1,-37,4,9,'#6b483c');rect(9,-35,4,7,'#6b483c');
 rect(-5,-34,2,6,'#ffe09a');rect(2,-36,2,8,'#ffe8af');rect(10,-34,2,6,'#ffe09a');rect(-4,-31,15,4,'#dbaa58');rect(-4,-28,15,2,'#ffe6a0');rect(2,-31,4,4,'#925ca8');rect(3,-31,2,2,'#e1b3f4');
 rect(1,-10,8,2,'#ae7b46');rect(4,-9,3,4,'#edc477');rect(5,-8,1,2,'#b79bd5');
 ctx.restore();text(coop?'DONUT · P2':'DONUT',cat.x,cat.y-76,10,'#e2c5fa');
 if(casting){ctx.save();ctx.strokeStyle='#c2a0f0aa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cat.x+cat.face*14,cat.y-29,34,0,Math.PI*2);ctx.stroke();for(let i=0;i<4;i++){const a=time*6+i*Math.PI/2;rect(cat.x+cat.face*14+Math.cos(a)*34-2,cat.y-29+Math.sin(a)*34-2,4,4,'#efdcff');}ctx.restore();}
}
function drawEnemy(e){if(e.hp<=0)return;ctx.save();if(e.hit>0)ctx.globalAlpha=.6;rect(e.x-e.w/2,e.y-3,e.w,6,'#0006');
 if(e.type==='boss'){
 const x=e.x,y=e.y,bob=e.phase==='walk'?Math.sin(time*5)*2:0;
 rect(x-45,y-80+bob,90,67,'#716075');rect(x-52,y-58,104,33,'#65586a');rect(x-31,y-108+bob,66,41,'#b39680');rect(x-35,y-116+bob,72,18,'#676263');rect(x-40,y-110+bob,15,33,'#676263');rect(x+27,y-108+bob,15,32,'#676263');
 rect(x-18,y-97+bob,9,5,'#303235');rect(x+12,y-97+bob,9,5,'#303235');rect(x-12,y-82+bob,29,8,e.phase==='stunned'?'#463d44':'#68554d');rect(x-65,y-61,20,46,'#b39680');rect(x+46,y-65,22,49,'#b39680');rect(x-38,y-16,27,17,'#594e48');rect(x+15,y-16,27,17,'#594e48');
 if(e.phase!=='stunned'){rect(x-38,y-71,29,31,'#8b8f70');rect(x-8,y-61,38,28,'#9f7752');rect(x+16,y-79,28,27,'#777c87');rect(x-34,y-68,21,4,'#b6b899');rect(x-3,y-57,27,4,'#c9aa72');}else text('✦  WINDED  ✦',x,y-132,12,'#ffd69a');
 text('THE HOARDER',x,y-154,12,'#e8bbaa');rect(x-72,y-144,144,6,'#302632');rect(x-72,y-144,144*e.hp/e.max,6,'#d79789');
 if(e.phase==='windup'){const tx=e.targetX;rect(tx-33,FLOOR-4,66,4,'#e9a47d');text('↓',tx,FLOOR-18,24,'#e9a47d');}
 }
 else if(e.type==='llama'){
 const x=e.x,y=e.y,f=e.face,bob=Math.sin(time*7)*1.5;
 rect(x-26,y-48+bob,50,29,'#d3bc95');rect(x-28,y-45+bob,7,14,'#f0d8ab');rect(x+f*20-9,y-73+bob,17,45,'#d3bc95');rect(x+f*25-14,y-81+bob,31,19,'#e4cda3');rect(x+f*28-8,y-90+bob,5,13,'#d3bc95');rect(x+f*17-3,y-90+bob,5,13,'#d3bc95');rect(x+f*35-4,y-76+bob,5,4,'#272b32');
 rect(x-20,y-22,9,22,'#aa936e');rect(x+13,y-22,9,22,'#aa936e');rect(x-21,y-5,11,5,'#5e564e');rect(x+12,y-5,11,5,'#5e564e');rect(x-17,y-45,31,17,'#a76057');rect(x-12,y-41,22,5,'#d8a469');text('BAD LLAMA',x,y-107,9,'#dbcea6');rect(x-27,y-101,54,4,'#292d32');rect(x-27,y-101,54*e.hp/e.max,4,'#bac894');
 }
 else{pixelSprite(monsterSprite,{h:'#8b6548',g:'#9ec36a',w:'#ffedb2',n:'#709647',k:'#313837',r:'#ba6655',b:'#494847'},e.x,e.y-49,3.5,e.face<0);rect(e.x-19,e.y-58,38,4,'#272c34');rect(e.x-19,e.y-58,38*e.hp/e.max,4,'#a7c58a');}
 if(e.snared>0){ctx.strokeStyle='#bfd69b';ctx.strokeRect(e.x-e.w/2-6,e.y-17,e.w+12,12);text('SNARED',e.x,e.y-e.h-22,10,'#c5dda6');}
 if(e.phase==='windup'){text('!',e.x,e.y-e.h-18,26,'#ffc36c');ctx.strokeStyle='#eab36d77';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(e.x,e.y+1);ctx.lineTo(e.x+e.face*(e.type==='boss'?0:e.type==='llama'?320:75),e.y+1);ctx.stroke();ctx.setLineDash([]);}
 if(target===e.id){text('▼',e.x,e.y-e.h-32,16,'#c5a1f4');}ctx.restore();}
function drawProp(o){if(!o.active)return;const x=o.x,y=o.y;
 if(o.type==='truck'){drawTruck(o);return;}
 if(o.type==='snare'){const c=o.spent?'#667368':o.arm>0?'#bba67b':'#c0d998';rect(x-26,y-5,52,5,'#61635a');for(let j=0;j<5;j++){rect(x-25+j*11,y-(o.spent?8:14),5,o.spent?5:9,c);}rect(x-4,y-7,8,6,c);text(o.spent?'SPRUNG':o.arm>0?'ARMING…':'SNARE · READY',x,y-26,9,c);return;}
 if(o.type==='junkheap'){rect(x-60,y-40,120,40,'#4b4a48');for(let j=0;j<7;j++){rect(x-55+j*16,y-25-(j%3)*17,29,23,['#77725c','#6c6071','#8b7153'][j%3]);}return;}
 if(o.type==='pickup'){const bob=Math.sin(time*4+o.x)*3;ctx.fillStyle='#ffbc6b18';ctx.beginPath();ctx.arc(x,y-17,23,0,Math.PI*2);ctx.fill();drawBombIcon(x,y-17+bob);text('PICK UP',x,y-45,8,'#e7c58d');return;}
 if(o.type==='crate'){rect(x-23,y-43,46,43,'#8b694b');rect(x-19,y-39,38,35,'#493e34');rect(x-15,y-36,7,33,'#a07952');rect(x+9,y-36,7,33,'#a07952');rect(x-19,y-25,37,6,'#a07952');}
 if(o.type==='barrel'){rect(x-20,y-45,40,42,'#864d42');rect(x-16,y-49,32,5,'#a57350');rect(x-22,y-36,44,7,'#4c4448');rect(x-22,y-14,44,7,'#4c4448');text('×',x,y-18,22,'#ffd693');if(o.fuse!=null){rect(x-3,y-57,6,9,'#ffd189');text('!',x,y-65,19,'#ffd189');}}
 if(o.type==='chest'||o.type==='gift'){const gift=o.type==='gift';rect(x-27,y-34,54,32,gift?'#6a5383':'#9e7146');rect(x-28,y-40,56,13,o.open?'#58452f':gift?'#8d72b0':'#c39355');rect(x-4,y-39,8,37,'#e6c17e');rect(x-9,y-22,18,9,'#e4c784');if(o.open){rect(x-22,y-35,44,12,'#2d282b');}else{const a=.4+Math.sin(time*4)*.3;text('✦',x,y-55,16,`rgba(251,208,133,${a})`);}if(gift)text('SPONSOR',x,y-70,10,'#ceabea');}
 if(o.type==='door'){arch(x-38,y-114,76,114);rect(x-29,y-82,58,82,'#19232e');rect(x-24,y-77,48,77,'#423b38');for(let j=0;j<3;j++)rect(x-20+j*18,y-75,2,73,'#76614b');rect(x+13,y-40,6,6,'#e9b86a');text('EXIT →',x,y-137,12,'#bfb599');}
 if(o.type==='switch'||o.type==='lever'){rect(x-14,y-40,28,39,'#535562');rect(x-20,y-7,40,7,'#67656a');const on=o.type==='switch'?s.flags.exitSwitch:s.flags.challengeStarted;rect(x-3,y-68,7,38,on?'#a4c591':'#a3907b');rect(x-10,y-72,21,10,on?'#bfe0a1':'#d9a373');text(o.type==='lever'?'ACCEPT CHALLENGE':'EXIT SWITCH',x,y-90,10,'#d7ba95');}
 if(o.type==='wall'){for(let row=0;row<3;row++){rect(x-35,y-120+row*40,72,37,'#63676a');rect(x-31,y-117+row*40,63,3,'#7b7c7d');}for(let i=0;i<5;i++)rect(x-6+(i%2)*10,y-112+i*22,6,27,'#242e37');text('SUPPLIES?',x+75,y-135,11,'#c7b591');}
 if(o.type==='trap'){rect(x-43,y-3,86,7,o.rewired?'#7b9874':'#5d4b50');for(let j=0;j<7;j++){const h=o.firing?18:5;ctx.fillStyle=o.rewired?'#b8d79b':'#a59699';ctx.beginPath();ctx.moveTo(x-40+j*12,y);ctx.lineTo(x-34+j*12,y-h);ctx.lineTo(x-28+j*12,y);ctx.fill();}if(o.rewired)text('REWIRED',x,y-33,9,'#b7d29f');}
 if(o.type==='stairs'){rect(x-48,y-110,108,112,'#0c1421');for(let i=0;i<5;i++){rect(x-40+i*15,y-24-i*16,75-i*12,7,s.flags.bossLoot?'#a39c80':'#4c5360');rect(x-40+i*15,y-17-i*16,75-i*12,12,'#303947');}text(s.flags.bossLoot?'↓ NEXT FLOOR':'STAIRS SEALED',x,y-131,11,s.flags.bossLoot?'#d2c58f':'#898695');}
 if(o.type==='sign'){rect(x-2,y-39,4,39,'#695844');rect(x-51,y-60,102,25,'#393636');text(o.text,x,y-43,10,'#d6bea0');}
}
function drawAim(){if(!aim||mode!=='play')return;let x=p.x+p.face*22,y=p.y-35,vx=p.face*(235+aim*150),vy=-250-aim*100;ctx.fillStyle='#f2c992';for(let i=0;i<30;i++){vy+=750*.045;x+=vx*.045;y+=vy*.045;if(y>FLOOR-10){y=FLOOR-10;vy*=-.35;vx*=.65;}if(i%2===0)rect(x-2,y-2,4,4,'#edcca1aa');}ctx.strokeStyle='#ffc28077';ctx.setLineDash([6,7]);ctx.beginPath();ctx.ellipse(x,FLOOR-5,142,26,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);text(s.bombs?'RELEASE K TO THROW':'NO BOMBS',p.x,p.y-121,10,'#f0bf83');}
function render(){ctx.save();if(shake)ctx.translate(Math.sin(time*80)*shake,Math.cos(time*100)*shake*.5);background();ctx.save();ctx.translate(-Math.round(camera),0);
 for(const f of platforms){rect(f.x,f.y,f.w,8,'#877963');rect(f.x+4,f.y+8,f.w-8,17,'#44464a');for(let i=12;i<f.w;i+=35)rect(f.x+i,f.y+13,24,6,'#596065');}
 for(const o of props.filter(o=>o.type==='truck'))drawProp(o);for(const o of props.filter(o=>o.type!=='truck'))drawProp(o);for(const e of enemies)drawEnemy(e);drawCat();drawCarl();
 for(const b of bombs){rect(b.x-7,b.y-7,14,14,'#353442');rect(b.x-4,b.y-10,8,4,'#aa997a');rect(b.x,b.y-15,4,6,'#ffc277');}
 for(const b of hostile){if(b.type==='spit'){rect(b.x-6,b.y-5,12,10,'#bbd17f');rect(b.x-2,b.y-3,5,4,'#e2eeb1');}else{rect(b.x-14,b.y-12,28,24,'#968573');rect(b.x-10,b.y-9,20,5,'#c9bfa3');rect(b.x-3,b.y-12,5,24,'#666877');text('↓',b.targetX,FLOOR-9,16,'#d8987477');}}
 for(const b of shots){rect(b.x-7,b.y-3,14,6,'#9d79d5');rect(b.x-3,b.y-4,6,8,'#e1caff');}
 drawAim();for(const a of particles){ctx.globalAlpha=clamp(a.life*2,0,1);if(a.radius){ctx.strokeStyle=a.color;ctx.lineWidth=6;ctx.beginPath();ctx.arc(a.x,a.y,a.radius*(1-a.life/.35),0,Math.PI*2);ctx.stroke();ctx.lineWidth=1;}else rect(a.x,a.y,a.size,a.size,a.color);}ctx.globalAlpha=1;
 for(const f of floats){ctx.globalAlpha=clamp(f.life,0,1);text(f.text,f.x,f.y,12,f.color);}ctx.globalAlpha=1;ctx.restore();
 // Soft vignette, and tiny scan lines for the televised-dungeon look.
 const v=ctx.createLinearGradient(0,0,0,H);v.addColorStop(0,'#090d1b66');v.addColorStop(.25,'#00000000');v.addColorStop(.9,'#00000000');v.addColorStop(1,'#080b1655');ctx.fillStyle=v;ctx.fillRect(0,0,W,H);for(let y=0;y<H;y+=4)rect(0,y,W,1,'#070c1208');ctx.restore();
}
function frame(stamp){if(!last)last=stamp;acc+=Math.min((stamp-last)/1000,.08);last=stamp;while(acc>=DT){tick(DT);acc-=DT;}render();requestAnimationFrame(frame);}
window.addEventListener('keydown',e=>{const controlled=['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyJ','KeyK','KeyQ','KeyE','Slash','KeyP','KeyI','KeyT','Escape'];if(!controlled.includes(e.code))return;if(e.target instanceof HTMLButtonElement&&e.code==='Space')return;e.preventDefault();if(e.repeat)return;if(e.code==='KeyI'){inventory();return;}if(e.code==='KeyP'||e.code==='Escape'){mode==='pause'||mode==='inventory'?resume():pause();return;}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();pressed.clear();aim=0;if(mode==='play')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='play')pause();});
$('inventory-button').onclick=inventory;
$('pause').onclick=()=>mode==='pause'||mode==='inventory'?resume():pause();$('help').onclick=()=>{if(mode==='play')pause(true);else if(mode==='setup')toast('Start the game, then use ? for the field guide');};
$('sound').onclick=()=>{sound=!sound;try{localStorage.setItem('dungeon-broadcast-sound',sound?'on':'off');}catch{}updateSound();beep(500,.12,'triangle');};
function updateSound(){$('sound').innerHTML='♪ <span>SOUND '+(sound?'ON':'OFF')+'</span>';$('sound').setAttribute('aria-label','Turn sound '+(sound?'off':'on'));$('sound').setAttribute('aria-pressed',String(sound));}
try{sound=localStorage.getItem('dungeon-broadcast-sound')==='on';}catch{}updateSound();
$('coop').onclick=()=>{coop=!coop;$('coop').innerHTML='P2 <span>'+(coop?'LEAVE':'JOIN')+'</span>';toast(coop?'PLAYER 2 · ARROWS + / TO CAST':'DONUT AI IS BACK');say(coop?'At last. Someone qualified to direct my talents.':'I was doing a splendid job on my own, actually.');canvas.focus({preventScroll:true});};
document.querySelectorAll('[data-key]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);const k=b.dataset.key;if(!keys.has(k))pressed.add(k);keys.add(k);});const release=()=>keys.delete(b.dataset.key);b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});
// Read-only structured observations are available for future planning experiments.
window.dungeon={observe:()=>clone({mode,room:s.room,stats:{strength:s.str,intelligence:s.int,health:s.hp,bombs:s.bombs,audience:s.fame},player:p,companion:cat,enemies:alive(),objects:props,inventory:{bombs:s.bombs,traps:s.traps},projectiles:hostile,decisions:s.log}),version:'0.5.0'};
setup();requestAnimationFrame(frame);
})();
