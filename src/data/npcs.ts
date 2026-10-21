export type NpcId = 'elder' | 'merchant' | 'guard' | 'smith' | 'banker' | 'tanner';

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  /** Appearance colours for the humanoid model. */
  look: { skin: string; hair: string; hairStyle: number; tunic: string; trousers: string; robe?: boolean; beard?: boolean };
  /** Generic lines used when no quest dialogue applies. */
  idleLines: string[];
  /** Service this NPC provides when talked to (opens that interface instead of dialogue). */
  service?: 'bank' | 'shop' | 'tanner';
  /** How close the player must be to use the NPC (e.g. across a counter). Default 1.9. */
  reach?: number;
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
      'Tools, strings, arrows and runes! And I buy what you gather.',
      'Copper and tin are found in the Ironcrag Hills to the east. Iron lies deeper, for seasoned miners.',
      'Tap a tree or rock and you will keep working it automatically while you stay nearby.',
    ],
  },
  guard: {
    id: 'guard', name: 'Captain Bram', title: 'Village Guard',
    look: { skin: '#8d5a3b', hair: '#2b1d14', hairStyle: 0, tunic: '#3b6fb6', trousers: '#2c3a4f', beard: true },
    idleLines: [
      'Slimes in the western meadow are harmless enough. Wolves in the Whispering Woods bite back.',
      'Switch combat styles with the big button: blade, bow, or staff. Bows need arrows, staves need air runes.',
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
  banker: {
    id: 'banker', name: 'Wendell Coinsworth', title: 'Banker',
    look: { skin: '#e2b48c', hair: '#8a8478', hairStyle: 0, tunic: '#2f5d4a', trousers: '#2f2a26', beard: true },
    idleLines: ['Welcome to the Bank of Brightwater. Your valuables are safe with us.'],
    service: 'bank',
    reach: 2.7,
  },
};
