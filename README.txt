DUNGEON BROADCAST — FLOOR 01 · v0.15
A fan-made browser-local prototype. The downloaded game needs no login.

PLAY AND SOURCE
Serve the game directly from this repository:
  python3 -m http.server 4173 --directory dist
Visit http://localhost:4173.
Editable source: dist/game.js, dist/index.html, dist/style.css.
Assets: dist/assets/. Tests: tests/game.test.cjs.
To build the self-contained HTML and source ZIP, run:
  python3 scripts/package_game.py
Then open build/Dungeon-Broadcast.html. Both generated files go in build/.
No JavaScript build step or package install is needed.

CONTROLS
Carl: A/D or Left/Right move; Space jumps; J punches or pushes explosive
boxes; hold K to aim and release to throw a bomb; T places a snare;
E interacts or recovers unused snares; Q marks a target for Donut;
H drinks a potion; I opens inventory; P or Escape pauses.
Potions heal three hearts, take a short moment, and cap at three carried.
Damage interrupts drinking without consuming the potion.
Donut chooses a short plan automatically. G cycles her goal (also a dropdown).
F triggers Carl’s stomp; V triggers Donut’s decoy. P2 JOIN gives a local second player
arrows, Up to jump, and / to cast; Carl then uses A/D and Space.
P2 LEAVE restores AI. No online co-op or gamepad support.

FLOOR FLOW
1. First hallway: enter Mordecai's guildhall with E. Ten playable lessons
   teach walking, jumping, punching, bombs, snares, healing, targeting,
   Royal Decoy, Barefoot Breaker, and assigning Donut a trap-help goal.
   Lessons can be skipped or repeated. Supplies refill; real inventory and
   skill progress are isolated. First visit gives two real potions once.
2. Goblin workshop: defeat two guards on foot, open their stash and collect
   bombs. The stash also provides two trap kits. No delivery truck.
3. Bad Llama stable: dodge spit or snare the llama. Defeat it to unlock
   the exit. It drops a trap kit and a power crystal. An optional cracked
   wall hides a supply cache: spend an explosive to reveal it.
4. Broadcast junction: visit Mordecai, go directly to the boss, or walk
   into the optional arena farther right. Three goblins guard its chest.
   Entering the arena locks the boss route until victory. No lever.
5. Murder Dozer machinery bay: jump charges, push explosive boxes into
   the truck, or lure it into cracked supports. Attack its exposed boiler.
   Below half health it adds blade slams and jumpable shockwaves. Defeat
   it, open its chest, choose your reward, then descend the stairs.
Only floor one exists; the stairs lead to a completion screen.

DAMAGE RULES
Starting damage, for all four race/class combinations:
                      Ordinary enemy   Armored truck   Exposed boiler
  Carl punch                  1               1                2
  Donut magic                 1               1                2
  Thrown bomb                 4               3                6
  Explosive box              10              10               15

Carl punch = max(1, 1 + current STR - starting STR).
Donut magic = her magic stat, starting at 1.
Bomb = 4 + floor(max(0, current INT - starting INT) / 2).
Explosive box = 10 + 2 * floor(max(0, current INT - starting INT) / 2).
Starting STR and INT retain race/class choices. Brawlers have stronger
knockback; Saboteurs can rewire floor traps; higher INT lengthens snares.

Armor subtracts one from punches, spells and bombs, minimum one; boxes
bypass armor. During a stall punches/spells deal double, and explosives
1.5 times damage, rounded to a whole number. Broken supports deal six
fixed damage. Creature snares immobilize ordinary monsters, not the truck.

A box detonates on contact with the truck, whether pushed into it or run
into. A surviving truck stalls for at least two seconds. Damage is
calculated BEFORE that stall, so a normal impact does ten, not fifteen.
A box hitting an already exposed boiler does fifteen and keeps any longer
existing stall. Chain-triggered boxes retain box damage. Blasts reach the
truck's body, not just its center. Own explosions do not harm Carl.

MONSTERS
  Goblin: level 1, 5 HP, worth 3 crawler XP.
  Bad Llama: level 2, 16 HP, worth 6 crawler XP.
  Murder Dozer: level 3 boss, 60 HP, worth 12 crawler XP.
Monster stats stay fixed as Carl grows. Enemy hits cost one heart, with
brief invulnerability. The solid truck blocks walking through its sides.
Carl can land on its chassis and ride it; moving side impacts push him
clear and damage him. Blade slams damage riders unless they jump.

SKILLS AND LEVELS
Successful damaging punches give one Strength practice point. Successful
spells give one Donut Magic practice point. Each ordinary monster grants
at most three points per skill; the boss grants at most six per skill.
Misses, crates, walls, defeated enemies and Mordecai practice give none.

Distinct clever plays train Intelligence: a planned box hit gives three
points, a support crash or snare/explosion combination gives two; other
recognized tricks give one. Each event pays once per room; Intelligence
practice is capped at six points per room. Repeating a trick cannot farm it.

Each skill independently needs 6 practice points for its first stat
increase, then 10, then 14, increasing by 4 each time. Excess progress
carries over. Strength +1 gives punch damage +1; Magic +1 gives spell
 damage +1; every two earned Intelligence points improve explosives.
Inventory > Skills & rewards shows all progress bars.

Crawler level increases every 12 total XP as a shared progress milestone.
It does NOT automatically increase combat stats. Boss victory heals Carl
but no longer grants free STR/INT. Skills and chosen upgrades drive damage.

LOOT AND CHOICES
Ordinary monsters leave one bomb, potion or trap kit. No coins. Drops stay
in the current room until collected. Full potion bags leave bottles on
the ground. Bad Llama additionally drops a power crystal. Crystals can be
spent on +1 Carl Strength OR +1 Donut Magic in Skills & rewards.

Major chests each offer one permanent upgrade from three choices:
  Supply cache / optional arena (Uncommon):
    Brawler's training manual: STR +1.
    Demolition notes: INT +2 (bomb +1, box +2).
    Enchanted spell treat: Donut magic +1.
  Boss chest (Rare):
    Champion's training manual: STR +2.
    Master demolition notes: INT +4 (bomb +2, box +4).
    Royal spell treat: Donut magic +2.

Quality follows the encounter, not Carl's current Strength. Successful
play suggests a matching option but never removes the alternatives.
Choosing consumes the reward once. These are permanent training items,
not an equipment-slot system. Applied items are listed in the inventory.
Choose later saves the choice in inventory; it can travel to the next room.
The final stairs require actually selecting the boss reward.
The supply cache also heals two and drops a potion; the arena chest heals
one and drops a potion plus two bombs; the boss chest supplies one bomb.

AUDIENCE AND SAVES
Distinct clever plays and teamwork earn audience points and recognition.
Automatic sponsor gifts remain disabled. No currency or purchases.
Entering a normal room heals one heart and saves a room-entry checkpoint.
Retry restores entry resources, skill progress, reward choices and stats.
Continue resumes that checkpoint, not the exact position. Finishing clears
it. Earlier saves preserve earned stats and initialize new skill fields.

ART AND PLANNING TOOLS
Seven illustrated actor atlases and five painted hallway backgrounds are
embedded in the standalone file. Prompts/provenance: ARTWORK.txt. Canvas
fallbacks keep it playable if an image fails. Optional Google Fonts fall
back to system fonts offline. Carl remains barefoot; Donut remains white.

Fixed-step 60 Hz simulation. Mordecai's menu exports a practice JSON trace:
scenario, seed, build/skills, inputs by simulation tick, resets and outcomes.
window.dungeon.observe() exposes a read-only structured snapshot including
skill progress, damage, enemy levels, items and unclaimed rewards. These
support future planning/RL experiments; there is no trained policy or
Gymnasium adapter. Donut uses a deterministic scored short-plan selector,
not a trained model. It reconsiders every 0.25 seconds, scores feasible
follow/attack/lure/wait/evade sequences with a movement cost, and executes
the next action. This is a bounded planner, not general-purpose tree search.
observe() also exposes her selected goal, current plan, special charges and
the active decoy. No accounts, model calls or training are required.

DONUT GOALS AND SPECIALS
Auto (default): choose a target, lure across an armed snare, hold fire while
Carl lines up a box against the boss, then attack the exposed boiler.
Attack my target: prioritize the Q-marked enemy, or the nearest monster.
Help traps & boxes: wait for a setup, lure, then attack a caught/stalled foe.
Stay close: follow Carl and hold fire. Already-fired spells still travel.
Visible immediate threats can temporarily override any goal to dodge.
Donut's intent appears below the goal selector. P2 disables her planner;
leaving P2 resumes the selected goal. Donut still has no separate health bar.

F — Barefoot Breaker: start on solid ground near an enemy. Carl makes a
short leap and deals damage once on landing, within 150px of a normal foe
or the truck's 240px half-width plus 150px. Damage = 6 + 2 per earned STR;
truck armor does not reduce it, exposed boiler multiplies it by 1.5.
It briefly staggers survivors (truck 1 second), preserving longer stalls.
It cannot overlap a throw/drink or recharge itself. Movement is reduced
during the leap; it does not grant invulnerability. A moving foe can escape.
The explosive box still wins at starting stats: 10/15 versus stomp 6/9.

V — Royal Decoy: manually create a glowing Donut illusion for up to 4 seconds.
It attracts one selected monster toward an armed snare or a box setup;
otherwise it appears on Carl's side of the target. Ordinary foes spend one
attack on it. The truck can retarget during its windup, but cannot change
course after its charge starts. Invalid use preserves charge. A caught
monster cannot be decoyed until free. The planner never spends this move.

Both specials start at 100%. Each point of actual non-stomp damage restores
2 percentage points to both meters; each unique clever-play award restores
15. No idle refill, overkill credit, or guild farming. Charges cap at 100.
Each special is enabled in its own guild lesson, with free practice refill.
The final lesson enables Donut’s goal selector and G shortcut; it starts on
Attack, so one G selects Help traps & boxes. Place T, give that goal, and
wait for the real lure/snare sequence. Earlier lessons keep specials disabled.
Ask Mordecai opens a menu to jump directly to any of the ten lessons.
Try again resets the scene, charges and goal. Guild practice temporarily
uses AI control; leaving restores P2, real charges, goals and progression. Pause freezes all
special timers. Room checkpoints restore charges and the selected goal;
room changes remove illusions. Touch players can use the two visible buttons.

VALIDATION
  node --check dist/game.js
  node --test tests/game.test.cjs
79 tests cover controls, AI/co-op, guild lessons, damage tables across all
builds, box impacts/chains, capped skill growth, treasure choices, saved
rewards, migration, retry, collision, and boss victories without supplies. Additional cases cover goal overrides,
real snare lures, boss follow-ups, decoy charge locking, stomp landing,
charge accounting, pause, P2 takeover, and checkpoint restoration. Guild
cases require all ten lesson actions, verify practice refill and resets,
and ensure no training rewards or goal changes leak into the real run.

DELIVERY
Local standalone file and source ZIP are current. Hosting remains unchanged
because the earlier source-helper credential submission was rejected by
approval policy. No new login is needed for the local game.
