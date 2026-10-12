DUNGEON BROADCAST — FLOOR 01
A fan-made, browser-local playable prototype. No account or API key is needed
for the downloaded copy. The hosted version is a private Site.

PLAY
Open dist/index.html in a modern browser, or run:
  python3 -m http.server 4173 --directory dist
Then visit http://localhost:4173.

Carl: A/D or Left/Right to move; Space to jump; J to punch;
hold K to preview a bomb throw, release K to throw; E to interact;
Q to mark a monster for Donut; P or Escape to pause.

Choose Human or Goblin, then Brawler or Saboteur. Brawlers push harder;
Saboteurs can rewire floor traps with E. Strength affects punch damage;
Intelligence affects explosion damage. Every combination can finish.

Donut is AI-controlled by default. P2 JOIN gives a second local player
Left/Right, Up to jump, and / to cast. Carl then uses A/D and Space.
P2 LEAVE returns Donut to AI. Gamepad and online co-op are not implemented.

FLOOR
1. Backstage: try movement, jumping and punching crates; use the exit door.
2. First broadcast: defeat two monsters, open the chest for two bombs.
3. Supply room: use the exit switch; optionally spend a bomb to open the
   cracked supply cache for +1 Strength and up to two health.
4. Sponsor challenge: skip to the boss, or use the lever to accept a fight.
   Winning unlocks a chest with two bombs and one health.
5. The Floor Manager: jump over charges. When the boss hits a wall, attack
   during its stun. Open its reward chest, then use the stairs to complete.

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
