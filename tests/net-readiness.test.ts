import { describe, expect, it } from 'vitest';
import { GameWorld, LOCAL_PLAYER_ID, isValidPlayerId, type Command, type SaveData } from '../src/sim/world';
import { COMMAND_TYPES, validateCommand } from '../src/net/validate';
import { EVENT_AUDIENCE, routeEvents } from '../src/net/audience';
import { mergeSave, splitSave } from '../src/sim/records';
import { mulberry32 } from '../src/core/rng';
import { isBlocked } from '../src/sim/worldmap';
import { QUESTS } from '../src/data/quests';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
// Fixture saves from earlier batches (loaded through Vite, so no Node file APIs are needed).
const FIXTURE_FILES = import.meta.glob('./fixtures/saves/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const FIXTURES = Object.keys(FIXTURE_FILES).map((p) => p.split('/').pop()!);
const fixture = (name: string) => JSON.parse(FIXTURE_FILES[`./fixtures/saves/${name}`]) as SaveData;
const SHARED_SOURCES = import.meta.glob(['../src/sim/*.ts', '../src/data/*.ts', '../src/exchange/*.ts', '../src/net/*.ts', '../src/core/*.ts'], { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

/** One well-formed example of every command kind (exhaustive: a new kind must be added here to compile). */
const SAMPLES: { [K in Command['type']]: Extract<Command, { type: K }> } = {
  joystick: { type: 'joystick', dx: 0.5, dz: -0.7 },
  moveTo: { type: 'moveTo', x: 56.5, z: 66.5 },
  interact: { type: 'interact', target: 1003 },
  setStyle: { type: 'setStyle', style: 'ranged' },
  useItem: { type: 'useItem', slot: 0 },
  dropItem: { type: 'dropItem', slot: 27 },
  swapItems: { type: 'swapItems', a: 1, b: 2 },
  claimOverflow: { type: 'claimOverflow' },
  discardOverflow: { type: 'discardOverflow' },
  bankDeposit: { type: 'bankDeposit', slot: 3, qty: 10, tab: 2 },
  bankDepositAll: { type: 'bankDepositAll' },
  bankSetTab: { type: 'bankSetTab', item: 'logs', tab: 1 },
  bankReleasePlaceholders: { type: 'bankReleasePlaceholders', item: 'logs' },
  bankSetPlaceholders: { type: 'bankSetPlaceholders', on: true },
  bankDepositHeld: { type: 'bankDepositHeld' },
  bankWithdraw: { type: 'bankWithdraw', item: 'coins', qty: 2_000_000 },
  bankClose: { type: 'bankClose' },
  equip: { type: 'equip', slot: 4 },
  unequip: { type: 'unequip', slot: 'ammo' },
  craft: { type: 'craft', recipe: 'bronze_bar', count: 14 },
  beltAdd: { type: 'beltAdd', slot: 5 },
  beltRemove: { type: 'beltRemove', category: 'fishing_rod' },
  beltAddAll: { type: 'beltAddAll' },
  lightFire: { type: 'lightFire', slot: 6 },
  openFletching: { type: 'openFletching' },
  openAnywhere: { type: 'openAnywhere', kind: 'crafting' },
  closeProduction: { type: 'closeProduction' },
  shopBuy: { type: 'shopBuy', item: 'fishing_rod', qty: 1 },
  shopSell: { type: 'shopSell', slot: 7, qty: 50 },
  shopClose: { type: 'shopClose' },
  tan: { type: 'tan', item: 'wolf_pelt', qty: 5 },
  tannerClose: { type: 'tannerClose' },
  acceptQuest: { type: 'acceptQuest', quest: Object.keys(QUESTS)[0] },
  tradeRequest: { type: 'tradeRequest', target: 1_000_002 },
  tradeOffer: { type: 'tradeOffer', slot: 4, qty: 10 },
  tradeRemove: { type: 'tradeRemove', item: 'logs', qty: 2 },
  tradeAccept: { type: 'tradeAccept' },
  tradeDecline: { type: 'tradeDecline' },
  exchange: { type: 'exchange', req: { op: 'place', nonce: 3, slot: 0, side: 'buy', item: 'logs', qty: 10, price: 5 } },
  exchangeClose: { type: 'exchangeClose' },
  exchangeResetPractice: { type: 'exchangeResetPractice' },
  build: { type: 'build', hotspot: 'chair', furniture: 'crude_chair' },
  removeFurniture: { type: 'removeFurniture', hotspot: 'bed' },
  pickpocket: { type: 'pickpocket', target: 112 },
  togglePrayer: { type: 'togglePrayer', prayer: 'keepsake' },
  pray: { type: 'pray' },
  chargeSparks: { type: 'chargeSparks' },
  burnIncense: { type: 'burnIncense' },
  reclaimHeld: { type: 'reclaimHeld' },
  quench: { type: 'quench' },
  setOption: { type: 'setOption', option: 'autoGather', on: false },
  setFocus: { type: 'setFocus', focus: 'power' },
  respawn: { type: 'respawn', at: 'checkpoint' },
};

describe('3A.1 command validation', () => {
  it('accepts every command kind the client sends, unchanged', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...COMMAND_TYPES].sort());
    for (const cmd of Object.values(SAMPLES)) expect(validateCommand(cmd), cmd.type).toEqual(cmd);
    expect(validateCommand({ type: 'exchange', req: { op: 'cancel', nonce: 4, orderId: 9 } })).not.toBeNull();
    expect(validateCommand({ type: 'bankDeposit', slot: 0, qty: 1 })).not.toBeNull();
  });

  it('rejects malformed commands', () => {
    const bad: unknown[] = [
      null, undefined, 42, 'moveTo', [], [{ type: 'pray' }], {}, { type: 'fly' }, { type: 'toString' }, { type: '__proto__' },
      { type: 'moveTo', x: 1 },
      { type: 'moveTo', x: NaN, z: 1 },
      { type: 'moveTo', x: Infinity, z: 1 },
      { type: 'moveTo', x: '5', z: 1 },
      { type: 'joystick', dx: 50, dz: 0 },
      { type: 'useItem', slot: 28 },
      { type: 'useItem', slot: -1 },
      { type: 'useItem', slot: 1.5 },
      { type: 'pray', extra: true },
      { type: 'interact', target: 5, account: 'someone' },
      { type: 'bankWithdraw', item: 'gold_bar_of_wishes', qty: 1 },
      { type: 'bankWithdraw', item: 'logs', qty: 0 },
      { type: 'bankWithdraw', item: 'logs', qty: 1e12 },
      { type: 'craft', recipe: 'hasOwnProperty', count: 1 },
      { type: 'craft', recipe: 'bronze_bar', count: 0 },
      { type: 'unequip', slot: 'tail' },
      { type: 'setStyle', style: 'constructor' },
      { type: 'setOption', option: 'godMode', on: true },
      { type: 'respawn', at: 'anywhere' },
      { type: 'exchange', req: { op: 'place', nonce: 1, slot: 0, side: 'buy', item: 'logs', qty: 1, price: 1, account: 'sim:Ash' } },
      { type: 'exchange', req: { op: 'place', nonce: 1, slot: 0, side: 'gift', item: 'logs', qty: 1, price: 1 } },
      { type: 'exchange', req: { op: 'deposit', nonce: 1, asset: 'coins', qty: 1e6 } },
      { type: 'exchange', req: null },
      { type: 'build', hotspot: 'chair', furniture: 'x'.repeat(5000) },
      JSON.parse('{"type":"pray","__proto__":{"admin":true}}'),
    ];
    for (const b of bad) expect(validateCommand(b), JSON.stringify(b)).toBeNull();
  });

  it('fuzz: random junk and mutated commands never throw, and mutations are caught', () => {
    const rng = mulberry32(0xf022);
    const junk = (depth = 0): unknown => {
      const r = rng();
      if (depth > 3 || r < 0.15) return [null, true, false, NaN, Infinity, -0, 1e308, '', 'logs', '__proto__'][Math.floor(rng() * 10)];
      if (r < 0.35) return (rng() - 0.5) * 10 ** Math.floor(rng() * 12);
      if (r < 0.5) return Math.floor(rng() * 40) - 5;
      if (r < 0.65) return ['type', 'moveTo', 'pray', 'craft', 'bronze_bar', 'x'.repeat(Math.floor(rng() * 200))][Math.floor(rng() * 6)];
      if (r < 0.8) return Array.from({ length: Math.floor(rng() * 4) }, () => junk(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = Math.floor(rng() * 5); i > 0; i--) o[['type', 'x', 'z', 'slot', 'qty', 'item', 'req', 'target', 'tab'][Math.floor(rng() * 9)]] = junk(depth + 1);
      return o;
    };
    for (let i = 0; i < 20_000; i++) expect(() => validateCommand(junk())).not.toThrow();
    // Every single-field mutation of a valid command is rejected.
    const breakers: unknown[] = [undefined, null, NaN, -1e9, 1e15, 'x', {}, [], true];
    for (const cmd of Object.values(SAMPLES)) {
      expect(validateCommand({ ...cmd, extra: 1 }), `${cmd.type} + extra`).toBeNull();
      for (const k of Object.keys(cmd)) {
        if (k === 'type' || (cmd.type === 'bankDeposit' && k === 'tab') || k === 'item' && cmd.type === 'bankReleasePlaceholders') continue;
        for (const v of breakers) {
          const m = { ...cmd, [k]: v } as Record<string, unknown>;
          if (v === undefined) delete m[k];
          // Booleans legitimately accept `true`.
          if (typeof (cmd as Record<string, unknown>)[k] === 'boolean' && v === true) continue;
          expect(validateCommand(m), `${cmd.type}.${k} = ${String(v)}`).toBeNull();
        }
      }
    }
  });

  it('fuzz: thousands of well-formed random commands never break the simulation', () => {
    const rng = mulberry32(0xbeef);
    const w = new GameWorld();
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
    const types = COMMAND_TYPES.filter((t) => t !== 'discardOverflow');
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      const sample = SAMPLES[pick(types)] as Record<string, unknown>;
      const cmd: Record<string, unknown> = { ...sample };
      for (const [k, v] of Object.entries(sample)) {
        if (typeof v === 'number') cmd[k] = k === 'x' || k === 'z' ? 40 + rng() * 40 : k === 'dx' || k === 'dz' ? rng() * 2 - 1 : Math.floor(rng() * (k === 'target' ? 6000 : 30));
      }
      const ok = validateCommand(cmd);
      if (!ok) continue;
      accepted++;
      expect(() => w.issue(ok)).not.toThrow();
      if (i % 10 === 0) run(w, 0.2);
    }
    expect(accepted).toBeGreaterThan(2000);
    // The world still saves and loads.
    const again = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });
    expect(again.player.name).toBe(w.player.name);
  });
});

describe('3A.1 player ids', () => {
  it('player ids are assigned, validated, and never clash with world entities', () => {
    expect(new GameWorld().player.id).toBe(LOCAL_PLAYER_ID);
    for (const bad of [0, 100, 1000, 5000, 20000, 1.5, -1, NaN]) expect(() => new GameWorld({ playerId: bad })).toThrow();
    for (const id of [7, 1_000_042]) {
      const w = new GameWorld({ playerId: id });
      expect(isValidPlayerId(id)).toBe(true);
      expect(w.player.id).toBe(id);
      expect(w.get(id)).toBeUndefined();
    }
  });

  it('a world with player id 1,000,042 plays: combat, loot ownership, wisps and saves', () => {
    const w = new GameWorld({ playerId: 1_000_042 });
    const p = w.player;
    // Fight a meadow slime until it drops loot that only this player can see at first.
    const slime = w.enemies.find((e) => e.def.id === 'slime')!;
    slime.hp = 1;
    p.x = p.prevX = slime.x + 1;
    p.z = p.prevZ = slime.z;
    (w as unknown as { rng: () => number }).rng = () => 0.01;
    w.issue({ type: 'interact', target: slime.id });
    run(w, 4);
    expect(slime.alive).toBe(false);
    const piles = w.visibleGroundItems(p.id);
    expect(piles.length).toBeGreaterThan(0);
    expect(piles.every((g) => g.owner === p.id)).toBe(true);
    expect(w.visibleGroundItems(7).filter((g) => g.isPrivate).length).toBe(0);
    // Damage and death events name this player; the wisp belongs to them.
    p.inventory.add('logs', 6);
    (w as unknown as { killPlayer: () => void }).killPlayer();
    expect(w.graves[0].owner).toBe(p.id);
    expect(w.interactable(w.graves[0].id)?.kind).toBe('grave');
    // Saves round-trip, and loading under another id keeps this player's piles theirs.
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    expect(save.playerId).toBe(1_000_042);
    const moved = new GameWorld({ save, playerId: 1_000_099 });
    expect(moved.visibleGroundItems(1_000_099).length).toBe(piles.length);
    expect(moved.graves[0].owner).toBe(1_000_099);
  });

  it('issueFor only accepts commands for a player in this world', () => {
    const w = new GameWorld({ playerId: 7 });
    expect(w.issueFor(8, { type: 'setStyle', style: 'magic' })).toBe(false);
    expect(w.player.style).toBe('melee');
    expect(w.issueFor(7, { type: 'setStyle', style: 'magic' })).toBe(true);
    expect(w.player.style).toBe('magic');
  });
});

describe('3A.1 character record and zone state', () => {
  it('fixture saves from earlier batches split and merge back exactly', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(2);
    for (const f of FIXTURES) {
      const save = fixture(f);
      const parts = splitSave(save);
      expect(mergeSave(parts), f).toEqual(save);
      expect(Object.keys(parts.character)).not.toContain('ground');
      expect(Object.keys(parts.character)).not.toContain('graves');
      expect(Object.keys(parts.character)).not.toContain('exchangePractice');
    }
  });

  it('a world loaded from merged parts saves exactly like one loaded from the original', () => {
    for (const f of FIXTURES) {
      const t = 1_790_000_100_000;
      const a = new GameWorld({ save: fixture(f), clock: () => t }).save();
      const b = new GameWorld({ save: mergeSave(splitSave(fixture(f))), clock: () => t }).save();
      expect(b, f).toEqual(a);
      // And the round trip is stable: save → load → save gives the same record and zone state.
      const w = new GameWorld({ save: JSON.parse(JSON.stringify(a)) as SaveData, clock: () => t });
      expect(w.characterRecord()).toEqual(splitSave(a).character);
      expect(w.zoneState()).toEqual(splitSave(a).zone);
    }
  });

  it('the full fixture keeps everything: skills, bank, gear, house, allotments, held items, piles and wisps', () => {
    const w = new GameWorld({ save: fixture('batch-11-full.json'), clock: () => 1_790_000_100_000 });
    const p = w.player;
    expect(p.skills.level('mining')).toBe(42);
    expect(p.bank.count('coins')).toBe(5000);
    expect(p.equipment.get('weapon')).toBe('riverwood_longbow');
    expect(p.equipment.ammoQty).toBe(40);
    expect(p.furniture.chair).toBe('crude_chair');
    expect(w.patches[0].crop).toBe('onion');
    expect(p.shrineHeld).toEqual([{ item: 'iron_sword', qty: 1 }]);
    expect(p.lanternBurn).toBe(90);
    expect(w.zoneState().ground?.length).toBe(2);
    expect(w.graves.length).toBe(1);
  });

  it('the early P0-era save still loads', () => {
    const w = new GameWorld({ save: fixture('p0-early.json') });
    expect(w.player.name).toBe('Early');
    expect(w.player.inventory.count('logs') + w.player.overflow.reduce((a, s) => a + (s.item === 'logs' ? s.qty : 0), 0)).toBe(2);
    expect(w.player.toolbelt.get('axe')).toBe('bronze_axe');
  });
});

describe('3A.1 event audiences', () => {
  it('every event kind is classified', () => {
    const kinds = new Set(Object.values(EVENT_AUDIENCE));
    expect([...kinds].sort()).toEqual(['nearby', 'self', 'zone']);
    expect(Object.keys(EVENT_AUDIENCE).length).toBe(51);
  });

  it('routes events: messages and loot to the player, gathering to those nearby, depletion to the zone', () => {
    const w = new GameWorld({ playerId: 9 });
    const p = w.player;
    const tree = w.nodes.find((n) => n.def.id === 'tree' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b)))!;
    const [a, b] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => !isBlocked(w.map, tree.x + a, tree.z + b))!;
    p.x = p.prevX = tree.x + a;
    p.z = p.prevZ = tree.z + b;
    (w as unknown as { rng: () => number }).rng = () => 0.01;
    w.issue({ type: 'interact', target: tree.id });
    run(w, 4);
    const routed = routeEvents(w, w.drainEvents());
    const gather = routed.find((r) => r.event.type === 'gather')!;
    expect(gather.audience).toEqual({ kind: 'nearby', x: tree.x, z: tree.z });
    expect(routed.find((r) => r.event.type === 'loot')!.audience).toEqual({ kind: 'self', player: 9 });
    expect(routed.find((r) => r.event.type === 'nodeDepleted')!.audience).toEqual({ kind: 'zone' });
  });
});

describe('3A.1 server-safe shared code', () => {
  it('src/sim, src/data, src/exchange, src/net and src/core use no browser, DOM, rendering or UI code', () => {
    const forbiddenImports = /from\s+['"](three|\.\.\/(render|ui|input)\/|\.\.\/main)/;
    const forbiddenGlobals = /\b(window|document|localStorage|sessionStorage|navigator|requestAnimationFrame|HTMLElement|HTMLCanvasElement)\b/;
    expect(Object.keys(SHARED_SOURCES).length).toBeGreaterThan(30);
    for (const [file, raw] of Object.entries(SHARED_SOURCES)) {
      const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, `${file} imports`).not.toMatch(forbiddenImports);
      expect(src, `${file} globals`).not.toMatch(forbiddenGlobals);
    }
  });
});
