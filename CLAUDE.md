# ProjectRS — Browser-Based MMORPG

A multiplayer browser MMORPG inspired by RuneScape Classic and HighSpell. Built with Bun, TypeScript, and Babylon.js.

## Tech Stack

- **Runtime:** Bun (server), Browser (client)
- **Language:** TypeScript (strict mode, shared types between client/server)
- **3D Engine:** Babylon.js 7 (WebGL)
- **Visual Style:** Low-poly 3D terrain with 2D billboard sprites (RS Classic style)
- **Networking:** Dual WebSocket — binary game protocol + JSON chat protocol
- **Build:** Vite for client bundling, Bun for server
- **Monorepo:** Bun workspaces (`shared/`, `server/`, `client/`)

## Project Structure

```
ProjectRS/
├── package.json              # Workspace root
├── tsconfig.json             # Base TS config (ES2022, strict)
├── shared/                   # Shared types, constants, protocol
│   ├── index.ts              # Barrel re-export
│   ├── opcodes.ts            # Client/Server opcode enums
│   ├── constants.ts          # TICK_RATE, MAP_SIZE, INVENTORY_SIZE, ports
│   ├── types.ts              # ItemDef, NpcDef, TileType, entity interfaces
│   ├── protocol.ts           # Binary packet encode/decode (opcode + int16 values)
│   └── skills.ts             # OSRS XP formulas, combat formulas, stances, bonuses
├── server/                   # Game server (Bun)
│   ├── src/
│   │   ├── main.ts           # Bun.serve() — HTTP static + WebSocket upgrade
│   │   ├── World.ts          # Game loop, tick processing, NPC spawning, combat
│   │   ├── GameMap.ts        # 96x96 tile generation, collision, A* pathfinding
│   │   ├── entity/
│   │   │   ├── Entity.ts     # Base: id, position, health, damage/heal
│   │   │   ├── Player.ts     # Inventory, equipment, skills, stance, movement
│   │   │   └── Npc.ts        # AI wandering, combat target, respawn
│   │   ├── combat/
│   │   │   └── Combat.ts     # OSRS hit chance, max hit, XP distribution, loot
│   │   ├── network/
│   │   │   ├── GameSocket.ts # Binary protocol handler (8 client opcodes)
│   │   │   └── ChatSocket.ts # JSON chat handler (local, PM, commands)
│   │   └── data/
│   │       └── DataLoader.ts # Loads JSON definitions at startup
│   └── data/
│       ├── items.json        # 22 items with OSRS-style equipment bonuses
│       └── npcs.json         # 9 NPC types (Chicken through Dark Knight)
├── client/                   # Browser client (Vite + Babylon.js)
│   ├── index.html            # Game canvas
│   ├── vite.config.ts        # Aliases @projectrs/shared, proxies /ws to :3000
│   ├── src/
│   │   ├── main.ts           # Creates GameManager with canvas
│   │   ├── managers/
│   │   │   ├── GameManager.ts    # Scene, lighting, entities, UI, game loop
│   │   │   ├── NetworkManager.ts # Dual WebSocket client (binary + JSON)
│   │   │   └── InputManager.ts   # Click-to-move via scene.pick()
│   │   ├── rendering/
│   │   │   ├── Terrain.ts        # Vertex-colored tile mesh (must match GameMap.ts!)
│   │   │   ├── SpriteEntity.ts   # Billboard planes with dynamic textures
│   │   │   ├── Camera.ts         # ArcRotateCamera, WASD/arrow rotation, follow
│   │   │   └── Pathfinding.ts    # Client-side A* for click-to-move
│   │   └── ui/
│   │       ├── SidePanel.ts      # Tabbed: Inventory / Skills / Equipment
│   │       ├── ChatPanel.ts      # Chat log + input, Enter to focus
│   │       ├── StatsPanel.ts     # HP bar (top-left)
│   │       └── Minimap.ts        # 150px canvas overlay (top-right)
```

## Running the Project

```bash
# Build client
cd client && bunx vite build

# Start server (serves built client on port 3000)
cd /path/to/ProjectRS && bun server/src/main.ts

# Open http://localhost:3000

# For development with hot reload (two terminals):
bun run dev:server    # watches server changes
bun run dev:client    # vite dev server on :5173, proxies /ws to :3000
```

## Architecture

### Server-Authoritative

All game state lives on the server. The client sends intentions (move, attack, equip), the server validates and broadcasts results. The server ticks at 600ms intervals.

### Movement Model

- **Client:** Runs A* pathfinding on click, smoothly interpolates along the path at 3.0 tiles/sec. Client path prediction is trusted for visual rendering — no server position correction is applied to the local player.
- **Server:** Receives the client's path, validates it against collision, processes 2 waypoints per tick (~3.33 tiles/sec) to stay ahead of the client.
- **Important:** Client and server terrain generation must be identical. `Terrain.ts` and `GameMap.ts` must always be kept in sync.

### Network Protocol

Two WebSocket connections per client:

1. **Game socket** (`/ws/game`) — Binary `Uint8Array` packets: `[opcode (1 byte), ...int16 values]`
2. **Chat socket** (`/ws/chat`) — JSON messages

Opcodes are defined in `shared/opcodes.ts`. The protocol helpers are in `shared/protocol.ts`.

### Combat System (OSRS-style)

Ported from the TextQuest project. Key formulas in `shared/skills.ts`:

- **Hit chance:** Piecewise function based on attack roll vs defence roll (`calculateHitChance`)
- **Max hit:** `floor(1.3 + effStr/10 + bStr/80 + effStr*bStr/640)` (`osrsMeleeMaxHit`)
- **XP:** 4 XP per damage dealt, distributed by stance. Combat skills auto-award 1/3 XP to hitpoints.
- **Stances:** Accurate (+3 acc), Aggressive (+3 pow), Defensive (+3 def), Controlled (+1 each)
- **Equipment bonuses:** Per-slot bonuses for stab/slash/crush attack and defence, melee strength, ranged, magic

### Skills System

12 skills with OSRS XP formula: `xpForLevel(L) = floor(sum(1..L-1 of floor(lvl + 300 * 2^(lvl/7))) / 4)`

Combat: accuracy, power, defence, magic, archery, hitpoints
Gathering/crafting: forestry, fishing, cooking, mining, smithing, crafting

Combat level: `floor(0.25*(def+hp) + max(0.325*(acc+pow), 0.325*(1.5*arch), 0.325*(1.5*mag)))`

### Map

96x96 tile grid with zones:
- **Village center** (~48,48): Stone plaza, 4 buildings, guards, shopkeeper
- **Farm** (~55,60): Fenced area with chickens (beginner combat)
- **Stone mine** (~14,14): Stone tiles with rats
- **Goblin camp** (~20,72): Dirt area with goblins
- **Forest** (~75,22): Trees (wall tiles) with wolves and spiders
- **Dungeon** (~82,82): Walled stone area with skeletons and Dark Knight boss
- Roads connecting all areas, lake with sand beach (~65,47)

### Items

22 items defined in `server/data/items.json`. Equipment has detailed bonuses:
- Attack: stabAttack, slashAttack, crushAttack
- Defence: stabDefence, slashDefence, crushDefence
- Strength: meleeStrength
- Other: rangedAccuracy, rangedStrength, rangedDefence, magicAccuracy, magicDefence
- Weapons have: attackSpeed, weaponStyle (stab/slash/crush)
- Food has: healAmount

Equipment slots: weapon, shield, head, body, legs, neck, ring, hands, feet, cape

### NPCs

9 types in `server/data/npcs.json`, 21 spawns total:
| NPC | HP | Aggressive | Location |
|-----|-----|------------|----------|
| Chicken | 5 | No | Farm |
| Rat | 8 | No | Mine |
| Goblin | 15 | No | Camp |
| Wolf | 25 | Yes | Forest |
| Spider | 12 | No | Forest |
| Skeleton | 30 | Yes | Dungeon |
| Guard | 40 | No | Village |
| Shopkeeper | 50 | No | Village |
| Dark Knight | 60 | Yes | Dungeon |

## Known Gotchas

- **Babylon.js tree-shaking:** Side-effect imports are needed. `InputManager.ts` requires `import '@babylonjs/core/Culling/ray'` or scene.pick() breaks silently.
- **ArcRotateCamera keyboard input:** Built-in keyboard handling is removed (`removeByType('ArcRotateCameraKeyboardMoveInput')`) so it doesn't conflict with our WASD handler. Pointer input is set to middle-mouse-button only (`buttons = [1]`).
- **Map sync:** `client/src/rendering/Terrain.ts` and `server/src/GameMap.ts` generate the map independently using the same algorithm. Any change to map generation must be applied to both files.
- **Binary protocol XP encoding:** XP values can exceed int16 range. Skills are sent as `[skillIndex, level, currentLevel, xpHigh, xpLow]` where XP is split into two 16-bit values. Reconstructed on client as `(xpHigh << 16) | (xpLow & 0xFFFF)`.
- **Bun serve binaryType:** Bun's WebSocket handler doesn't accept `binaryType` in the config object — messages arrive as `Buffer` and must be converted to `ArrayBuffer` via `.buffer.slice(0)`.
- **Vite build directory:** `bunx vite build` must be run from the `client/` directory, not the project root.

## What's Implemented

- [x] 3D world with vertex-colored tile terrain
- [x] Click-to-move with A* pathfinding (8-directional, no corner cutting)
- [x] Server-authoritative multiplayer (multiple browser tabs = multiple players)
- [x] Billboard sprite entities with health bars
- [x] NPC AI (wandering, aggressive targeting)
- [x] OSRS-style tick-based combat with proper formulas
- [x] 12-skill XP system with OSRS formulas
- [x] 4 melee stances with XP distribution
- [x] Equipment system (10 slots, proper bonuses)
- [x] Inventory (28 slots, equip/eat/drop context menus)
- [x] Tabbed side panel (Inventory / Skills / Equipment)
- [x] Food healing system
- [x] Loot drops on NPC death
- [x] Ground item pickup
- [x] NPC respawning
- [x] Chat system (local broadcast, private messages, /commands)
- [x] Enter-to-chat, Escape to unfocus
- [x] WASD/arrow camera rotation
- [x] Minimap with entity dots
- [x] HP bar with color transitions
- [x] XP drop notifications and level-up messages
- [x] 96x96 map with distinct zones
- [x] 9 NPC types, 22 item types

## Not Yet Implemented

- [ ] Sprite art (currently colored rectangles with text)
- [ ] Sound effects / music
- [ ] NPC dialogue system
- [ ] Shop buy/sell system
- [ ] Login screen (currently auto-assigns Player1, Player2, etc.)
- [ ] SQLite persistence (player data resets on server restart)
- [ ] Death penalty (currently respawns at full HP, no item loss)
- [ ] Ranged/magic combat (formulas exist in shared/skills.ts but not wired up)
- [ ] Non-combat skills (forestry, fishing, cooking, mining, smithing, crafting)
- [ ] 3D objects (trees, rocks — currently just tile colors)
