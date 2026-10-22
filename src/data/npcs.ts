import type { ItemId } from './items';

export type NpcId = 'elder' | 'merchant' | 'guard' | 'smith' | 'banker' | 'tanner' | 'townsman' | 'townswoman' | 'farmer' | 'sawyer' | 'clerk_pell' | 'clerk_imogen' | 'exbanker';

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
  banker: {
    id: 'banker', name: 'Wendell Coinsworth', title: 'Banker',
    look: { skin: '#e2b48c', hair: '#8a8478', hairStyle: 0, tunic: '#2f5d4a', trousers: '#2f2a26', beard: true },
    idleLines: ['Welcome to the Bank of Brightwater. Your valuables are safe with us.'],
    service: 'bank',
    reach: 2.7,
  },
};
