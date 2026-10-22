import type { ItemId } from './items';

export type NpcId = 'elder' | 'merchant' | 'guard' | 'smith' | 'banker' | 'tanner' | 'townsman' | 'townswoman' | 'farmer' | 'sawyer' | 'clerk_pell' | 'clerk_imogen' | 'exbanker' | 'gambler' | 'smuggler' | 'quartermaster'
  // Heronwick, Mirefen Marsh (Phase 4A)
  | 'reeve' | 'provisioner' | 'heron_banker' | 'fisher'
  // Cairnhold, Thornridge Highlands (Phase 4A)
  | 'warden' | 'silversmith' | 'cairn_banker' | 'shepherd';

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  /** Appearance colours for the humanoid model. */
  look: { skin: string; hair: string; hairStyle: number; tunic: string; trousers: string; robe?: boolean; beard?: boolean };
  /** Generic lines used when no quest dialogue applies. */
  idleLines: string[];
  /** Service this NPC provides when talked to (opens that interface instead of dialogue). */
  service?: 'bank' | 'shop' | 'tanner' | 'sawmill' | 'exchange';
  /** How close the player must be to use the NPC (e.g. across a counter). Default 1.9. */
  reach?: number;
  /** Pickpocketing (Thieving): level, xp, what you can get, and the stun damage when caught. */
  thieving?: { level: number; xp: number; loot: { item: ItemId; min: number; max: number; weight: number }[]; stunDamage: number };
}

/** Pickpocket success: 58% at the target's level, rising with skill to 94%. */
export function pickpocketChance(level: number, req: number): number {
  return Math.min(0.94, 0.58 + Math.max(0, level - req) * 0.014);
}

export const NPCS: Record<NpcId, NpcDef> = {
  elder: {
    id: 'elder', name: 'Elder Maren', title: 'Village Elder',
    look: { skin: '#e9c3a0', hair: '#e8e8e8', hairStyle: 2, tunic: '#5a3e8a', trousers: '#3a2a5c', robe: true },
    idleLines: [
      'Brightwater has stood for three hundred years. With your help, it will stand for three hundred more.',
      'The Goblin Warlord Grukk grows bolder in the northeast. Only the strongest should face him.',
    ],
  },
  merchant: {
    id: 'merchant', name: 'Tilly Thimble', title: 'Travelling Merchant',
    look: { skin: '#c98e62', hair: '#c4482c', hairStyle: 1, tunic: '#d98c2b', trousers: '#5a4632' },
    service: 'shop',
    reach: 2.2,
    idleLines: [
      'Tools, strings, arrows and spark stones! And I buy what you gather.',
      'Copper and tin are found in the Ironcrag Hills to the east. Iron lies deeper, for seasoned miners.',
      'Tap a tree or rock and you will keep working it automatically while you stay nearby.',
    ],
  },
  guard: {
    id: 'guard', name: 'Captain Bram', title: 'Village Guard',
    look: { skin: '#8d5a3b', hair: '#2b1d14', hairStyle: 0, tunic: '#3b6fb6', trousers: '#2c3a4f', beard: true },
    thieving: { level: 35, xp: 52, loot: [{ item: 'coins', min: 18, max: 32, weight: 4 }, { item: 'bronze_arrow', min: 4, max: 10, weight: 2 }], stunDamage: 18 },
    idleLines: [
      'Slimes in the western meadow are harmless enough. Wolves in the Whispering Woods bite back.',
      'Switch combat styles with the big button: blade, bow, or staff. Bows need arrows, wands burn spark stones.',
      'If you fall, the shrine in the plaza will bring you back. You keep your belongings.',
    ],
  },
  smith: {
    id: 'smith', name: 'Hilda Ironhand', title: 'Blacksmith',
    look: { skin: '#f1cfae', hair: '#6b3d1f', hairStyle: 3, tunic: '#7a3b2e', trousers: '#3d2f28' },
    idleLines: [
      'Bring me ore once my forge is rebuilt and I will teach you to smith. For now, keep mining!',
      'A good pickaxe is worth more than a good sword. Well — almost.',
    ],
  },
  tanner: {
    id: 'tanner', name: 'Rook Hidewell', title: 'Tanner',
    look: { skin: '#b07a52', hair: '#3b2a1c', hairStyle: 2, tunic: '#6b4a2c', trousers: '#3a2e24', beard: true },
    idleLines: ['Bring me pelts and a couple of coins, and I will give you good leather.'],
    service: 'tanner',
  },
  townsman: {
    id: 'townsman', name: 'Osric', title: 'Townsman',
    look: { skin: '#d9a77c', hair: '#6b4a2c', hairStyle: 0, tunic: '#7a8a4a', trousers: '#4a3a2a' },
    idleLines: ['Lovely day for a stroll round the fountain.', 'Mind your purse in the plaza, friend.'],
    thieving: { level: 1, xp: 7, loot: [{ item: 'coins', min: 2, max: 4, weight: 4 }, { item: 'bronze_nails', min: 2, max: 4, weight: 1 }], stunDamage: 8 },
  },
  townswoman: {
    id: 'townswoman', name: 'Maud', title: 'Townswoman',
    look: { skin: '#c98e62', hair: '#2b1d14', hairStyle: 3, tunic: '#a0465a', trousers: '#4a3a46' },
    idleLines: ['The baker’s cart has the best bread in the valley.', 'Have you seen the flax by the fields? Pretty blue flowers.'],
    thieving: { level: 1, xp: 7, loot: [{ item: 'coins', min: 2, max: 4, weight: 4 }, { item: 'thread', min: 1, max: 3, weight: 1 }], stunDamage: 8 },
  },
  farmer: {
    id: 'farmer', name: 'Farmer Wren', title: 'Farmer',
    look: { skin: '#e2b48c', hair: '#c4a060', hairStyle: 1, tunic: '#6a7a3a', trousers: '#5a4632' },
    idleLines: ['Rake the weeds, plant your seeds, water and wait. That is farming.', 'Sunroot first. Everyone starts with sunroot.', 'Burn a wardleaf at the shrine. The spirits like the smell.'],
    thieving: { level: 8, xp: 16, loot: [{ item: 'coins', min: 5, max: 10, weight: 3 }, { item: 'potato_seed', min: 1, max: 2, weight: 2 }, { item: 'onion_seed', min: 1, max: 1, weight: 1 }], stunDamage: 10 },
  },
  sawyer: {
    id: 'sawyer', name: 'Bertram Ashby', title: 'Sawmill',
    look: { skin: '#d9a77c', hair: '#8a8478', hairStyle: 0, tunic: '#5a6f8a', trousers: '#3a2e24', beard: true },
    idleLines: ['Five coins a plank, fifteen for oak. Finest planks in the valley.'],
    service: 'sawmill',
  },
  clerk_pell: {
    id: 'clerk_pell', name: 'Clerk Pell', title: 'Exchange Clerk',
    look: { skin: '#e2b48c', hair: '#3b2a1c', hairStyle: 0, tunic: '#2a4f7a', trousers: '#2a2a33' },
    idleLines: ['Buy offers, sell offers, eight slots each. The board does the rest.'],
    service: 'exchange',
    reach: 2.5,
  },
  // Original pickpocket targets (docs/ORIGINALITY.md H9 follow-up).
  gambler: {
    id: 'gambler', name: 'Corwin Lightfinger', title: 'Dice Player',
    look: { skin: '#e2b48c', hair: '#2b1d14', hairStyle: 0, tunic: '#7a2e4a', trousers: '#2c2430' },
    idleLines: ['Knucklebones, friend? Double or nothing.', 'The inn is warm and the dice are kind. Mostly.'],
    thieving: { level: 15, xp: 28, loot: [{ item: 'coins', min: 6, max: 18, weight: 5 }, { item: 'air_rune', min: 3, max: 6, weight: 1 }], stunDamage: 12 },
  },
  smuggler: {
    id: 'smuggler', name: 'Nell Quickwater', title: 'River Trader',
    look: { skin: '#c98e62', hair: '#c4482c', hairStyle: 3, tunic: '#3a5a4a', trousers: '#2a2e24' },
    idleLines: ['Trader. Just a trader. What would I be smuggling, river water?', 'Boats come down from the north when the bridge-toll is high.'],
    thieving: { level: 25, xp: 40, loot: [{ item: 'coins', min: 12, max: 30, weight: 4 }, { item: 'emberglass_shard', min: 1, max: 1, weight: 1 }, { item: 'steel_bar', min: 1, max: 1, weight: 1 }], stunDamage: 15 },
  },
  quartermaster: {
    id: 'quartermaster', name: 'Snag', title: 'Goblin Quartermaster',
    look: { skin: '#6f9e3c', hair: '#3a2a1c', hairStyle: 2, tunic: '#6b4a2c', trousers: '#3a2e24' },
    idleLines: ['Snag counts the arrows. Snag counts the coins. Snag does NOT count you.', 'Warlord says no humans. Snag says humans pay for arrows.'],
    thieving: { level: 40, xp: 62, loot: [{ item: 'coins', min: 20, max: 45, weight: 3 }, { item: 'bronze_arrow', min: 10, max: 25, weight: 2 }, { item: 'glimsteel_arrow', min: 3, max: 8, weight: 1 }], stunDamage: 22 },
  },
  clerk_imogen: {
    id: 'clerk_imogen', name: 'Clerk Imogen', title: 'Exchange Clerk',
    look: { skin: '#b07a52', hair: '#c4a060', hairStyle: 3, tunic: '#2a4f7a', trousers: '#2a2a33' },
    idleLines: ['Until the trade routes open, the board runs as a practice market.'],
    service: 'exchange',
    reach: 2.5,
  },
  exbanker: {
    id: 'exbanker', name: 'Hal Tallow', title: 'Banker',
    look: { skin: '#d9a77c', hair: '#8a8478', hairStyle: 0, tunic: '#2f5d4a', trousers: '#2f2a26' },
    idleLines: ['The Bank of Brightwater, at your service by the exchange.'],
    service: 'bank',
    reach: 2.4,
  },
  // ---- Heronwick, Mirefen Marsh (Phase 4A, docs/WORLD_EXPANSION.md)
  reeve: {
    id: 'reeve', name: 'Reeve Odalys Fenn', title: 'Reeve of Heronwick',
    look: { skin: '#c99a72', hair: '#9a9488', hairStyle: 3, tunic: '#4a6a5a', trousers: '#3a3a2e', robe: true },
    idleLines: [
      'Heronwick keeps its lanterns lit, and the marsh keeps its distance. That is the bargain.',
      'The Sunken Shrine was old when the first stilt-house went up. Its door has been sealed for longer than anyone remembers.',
      'Croakers are harmless if you leave them be. Leeches are not, and the Bog Mother is worse.',
    ],
  },
  provisioner: {
    id: 'provisioner', name: 'Brannoc Tull', title: 'Provisioner',
    look: { skin: '#e2b48c', hair: '#5a3a22', hairStyle: 0, tunic: '#8a6a2e', trousers: '#4a3a2a', beard: true },
    service: 'shop',
    reach: 2.2,
    idleLines: ['Rods, lines, knives, flint and bread. Everything a body needs in a bog.', 'I buy fish, oil and willow. Pearls too, though you’d get more from a silversmith.'],
  },
  heron_banker: {
    id: 'heron_banker', name: 'Hesper Vane', title: 'Banker',
    look: { skin: '#b07a52', hair: '#2b1d14', hairStyle: 3, tunic: '#2f5d4a', trousers: '#2f2a26' },
    idleLines: ['The Bank of Brightwater keeps a strongroom here. Same vaults, same ledgers, drier boots.'],
    service: 'bank',
    reach: 2.2,
  },
  fisher: {
    id: 'fisher', name: 'Wyn Silverhook', title: 'Pool Fisher',
    look: { skin: '#d9a77c', hair: '#c4a060', hairStyle: 1, tunic: '#3a5a6a', trousers: '#3a3a2e' },
    idleLines: [
      'Silverpike lie still under the lily pads. Patience, a rod, and a fair bit of Fishing know-how.',
      'Now and then a mussel pearl comes up on the hook. Keep those, they’re worth a fair bit.',
      'Silverpike cook best over Heronwick’s fire. Burns easy if you hurry it.',
    ],
    thieving: { level: 30, xp: 46, loot: [{ item: 'coins', min: 14, max: 30, weight: 4 }, { item: 'raw_silverpike', min: 1, max: 1, weight: 2 }, { item: 'bowstring', min: 1, max: 2, weight: 1 }], stunDamage: 16 },
  },
  // ---- Cairnhold, Thornridge Highlands (Phase 4A, docs/WORLD_EXPANSION.md)
  warden: {
    id: 'warden', name: 'Warden Halvard Crane', title: 'Warden of Thornridge',
    look: { skin: '#d9a77c', hair: '#6a6a6a', hairStyle: 0, tunic: '#5a5048', trousers: '#3a332c', beard: true },
    idleLines: [
      'Cairnhold watches the high road. Always has. The Ninefold Stones were here before the first cottage.',
      'The Old Watchtower has been barred since before my grandmother’s day. Something dens in it now.',
      'Boars on the heath, stalkers on the crags. Walk the road and keep your eyes up.',
    ],
  },
  silversmith: {
    id: 'silversmith', name: 'Ottilie Brask', title: 'Silversmith',
    look: { skin: '#f1cfae', hair: '#c4a060', hairStyle: 3, tunic: '#6a7a8a', trousers: '#3a3a44' },
    service: 'shop',
    reach: 2.2,
    idleLines: [
      'Silver from the crags, smelted at my furnace: thirty in Smithing for the bar, thirty in Crafting for a band.',
      'Set a marsh pearl in silver and you have something worth wearing. Heronwick has the pearls; we have the silver.',
    ],
  },
  cairn_banker: {
    id: 'cairn_banker', name: 'Joss Ambry', title: 'Banker',
    look: { skin: '#c98e62', hair: '#3b2a1c', hairStyle: 0, tunic: '#2f5d4a', trousers: '#2f2a26' },
    idleLines: ['Even up here, the Bank of Brightwater keeps your things. Cold vaults keep well.'],
    service: 'bank',
    reach: 2.2,
  },
  shepherd: {
    id: 'shepherd', name: 'Fenna Lowe', title: 'Shepherd',
    look: { skin: '#e2b48c', hair: '#8a4a2c', hairStyle: 1, tunic: '#7a6a4a', trousers: '#4a3a2a' },
    idleLines: ['The stalkers took three ewes last month. Three!', 'Heather honey and mutton, that’s Cairnhold. And the wind.'],
    thieving: { level: 20, xp: 34, loot: [{ item: 'coins', min: 8, max: 20, weight: 4 }, { item: 'thread', min: 2, max: 4, weight: 2 }, { item: 'bread', min: 1, max: 1, weight: 1 }], stunDamage: 13 },
  },
  banker: {
    id: 'banker', name: 'Wendell Coinsworth', title: 'Banker',
    look: { skin: '#e2b48c', hair: '#8a8478', hairStyle: 0, tunic: '#2f5d4a', trousers: '#2f2a26', beard: true },
    idleLines: ['Welcome to the Bank of Brightwater. Your valuables are safe with us.'],
    service: 'bank',
    reach: 2.7,
  },
};
