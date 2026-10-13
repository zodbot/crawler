DUNGEON BROADCAST — FLOOR 01
A fan-made, browser-local playable prototype. No account or API key is needed
for the downloaded copy. The hosted version is a private Site.

PLAY
Open dist/index.html in a modern browser, or run:
  python3 -m http.server 4173 --directory dist
Then visit http://localhost:4173.

Carl: A/D or Left/Right to move; Space to jump; J to punch;
hold K to preview a bomb throw, release K to throw; E to interact;
Q to mark a monster for Donut; T to place a snare trap;
E beside an unused snare to recover it; I opens inventory and pauses;
P or Escape to pause.

Choose Human or Goblin, then Brawler or Saboteur. Brawlers push harder;
Saboteurs can rewire floor traps with E. Strength affects punch damage;
Intelligence affects explosion damage. Every combination can finish.

Donut is AI-controlled by default. P2 JOIN gives a second local player
Left/Right, Up to jump, and / to cast. Carl then uses A/D and Space.
P2 LEAVE returns Donut to AI. Gamepad and online co-op are not implemented.

FLOOR
1. Backstage: try movement, jumping and punching crates; use the exit door.
2. Goblin road crew: a truck arrives and two goblins jump out. Defeat them,
   open the cargo chest, then walk over its two bomb pickups. One goblin
   also drops a bomb. The cargo gives two snare trap kits directly to your
   inventory. The first backstage crate contains a tutorial bomb.
3. Supply room: a ranged Bad Llama guards the far side. Dodge its spit,
   approach behind cover, or set a snare. Use the exit switch; optionally
   spend a bomb to open the
   cracked supply cache for +1 Strength and up to two health.
4. Sponsor challenge: skip to the boss, or use the lever to accept a fight.
   Winning unlocks a chest with two bomb pickups and one health.
5. The Hoarder: move away from the marked landing spots of three junk
   throws, then attack while the boss is winded. A snare also interrupts
   the boss for 1.5 seconds. Open the reward chest, then use the stairs.

Environmental tricks and teamwork earn audience points. Each recognized
trick pays once per room; every two clever moments grant Intelligence +1.
At 60 audience points, earn a gift with one bomb and one health, delivered
when no enemy is nearby. Boss victory grants +1 Strength and Intelligence.
Boss chest rewards reflect the number of clever moments in your run.

There is no time limit. Your own explosions do not hurt Carl. Entering a
room heals one health and records a checkpoint in this browser's local
storage. Retry restores the state at room entry. Continue resumes that
entry checkpoint, not your exact position. Completing the floor clears it.
The results screen exports your choices and final stats as JSON.

DEVELOPMENT
dist/game.js owns a fixed-step 60 Hz simulation and separate canvas drawing.
dist/style.css and dist/index.html define the surrounding interface.
No installation or build step is required. Google Fonts are optional;
system fonts are used if the network is unavailable.

Run functional tests with Node.js:
  node --test tests/game.test.cjs

The read-only window.dungeon.observe() method provides structured state
for future planning experiments. Donut currently uses hand-written rules;
there is no trained RL policy or Gymnasium adapter in this first version.
Only floor one is implemented. The stairs lead to a completion screen.

Art, dialogue and game rules in this prototype are newly created.

V0.2: GOBLIN ROAD CREW + INVENTORY
Bomb pickups are unlit and remain on the ground until collected. Collected
bombs stay in your inventory between rooms and are consumed one per throw.
The inventory button below the game or I opens the bag and pauses the fight.
The start screen also offers a shortcut directly to the goblin encounter.

V0.3: SNARES, BAD LLAMA, AND THE HOARDER
Press T on the dungeon floor to spend one trap kit and place a snare. It
arms in one second. It holds one enemy for 2 + 0.15 x Intelligence seconds;
bosses are held for 1.5 seconds. One unused snare can be deployed at a time.
Carl and Donut cross safely. Press E nearby to recover an unused snare.
Leaving a room packs unused snares automatically. Sprung snares are spent.
Trapping an enemy and following up with a bomb earns an audience bonus.
Practice shortcuts on the start screen provide 3 bombs and 2 trap kits.
Older room checkpoints without trap stock receive two kits from room 3 on.
Monster appearances and combat are simplified interpretations for this game.

V0.4 character art: larger, detailed Carl and Princess Donut; animated limbs and tail; matching HUD portraits. Character artwork is display-only; collision, combat reach, progression, and save compatibility are unchanged.

V0.5: smooth shaded cartoon Carl, jointed animation and blinking face; matching portrait; doubled canvas resolution. Donut artwork and gameplay are unchanged.
