import type { ItemId } from './items';
import type { EnemyType } from './enemies';
import type { NpcId } from './npcs';
import type { SkillId } from './skills';

export type QuestObjective =
  | { type: 'talk'; npc: NpcId }
  | { type: 'collect'; item: ItemId; count: number; consume: boolean; returnTo: NpcId }
  | { type: 'kill'; enemy: EnemyType; count: number; returnTo: NpcId };

export interface QuestStage {
  journal: string;
  objective: QuestObjective;
  /** Dialogue when the player talks to the relevant NPC while this stage is incomplete. */
  pendingLines: string[];
  /** Dialogue when the objective has been satisfied and the player hands it in. */
  completeLines: string[];
}

export interface QuestDef {
  id: string;
  name: string;
  giver: NpcId;
  summary: string;
  stages: QuestStage[];
  rewards: { items: { item: ItemId; qty: number }[]; xp: Partial<Record<SkillId, number>>; text: string[] };
}

export const QUESTS: Record<string, QuestDef> = {
  elders_request: {
    id: 'elders_request',
    name: "The Elder's Request",
    giver: 'elder',
    summary: 'Help Elder Maren prepare Brightwater against the wilds.',
    stages: [
      {
        journal: 'Speak with Elder Maren in the Brightwater plaza.',
        objective: { type: 'talk', npc: 'elder' },
        pendingLines: [],
        completeLines: [
          'Ah, a new face! Welcome to Brightwater, adventurer.',
          'Our palisade is rotting and the slimes from the western meadow keep creeping closer.',
          'Bring me 5 logs from the trees around the village. Tap a tree and you will chop it automatically.',
        ],
      },
      {
        journal: 'Chop 5 logs and bring them to Elder Maren.',
        objective: { type: 'collect', item: 'logs', count: 5, consume: true, returnTo: 'elder' },
        pendingLines: ['Trees grow all around the village. Five logs should patch the worst of the palisade.'],
        completeLines: [
          'Wonderful timber! The carpenters will be pleased.',
          'Now, the slimes. Cross the western bridge into the meadow and defeat 3 of them.',
          'Tap a slime to target it — you will attack automatically. Switch styles with the big combat button.',
        ],
      },
      {
        journal: 'Defeat 3 Meadow Slimes west of the river, then return to Elder Maren.',
        objective: { type: 'kill', enemy: 'slime', count: 3, returnTo: 'elder' },
        pendingLines: ['The meadow lies across the western bridge. Three slimes should teach the rest to keep away.'],
        completeLines: [
          'You did it! Brightwater owes you a great debt.',
          'Take these supplies. The Whispering Woods to the north and the Ironcrag Hills to the east await.',
          'And beware the goblin camp in the northeast. Its warlord is a beast few could hope to defeat alone.',
        ],
      },
    ],
    rewards: {
      items: [
        { item: 'coins', qty: 250 },
        { item: 'bronze_arrow', qty: 50 },
        { item: 'air_rune', qty: 50 },
        { item: 'bread', qty: 3 },
      ],
      xp: { attack: 200, woodcutting: 150, hitpoints: 100 },
      text: ['250 coins', '50 bronze arrows', '50 spark stones', '3 bread', '200 Attack xp', '150 Woodcutting xp', '100 Hitpoints xp'],
    },
  },
  // Heronwick, Mirefen Marsh (Phase 4A, docs/WORLD_EXPANSION.md).
  lanterns_of_heronwick: {
    id: 'lanterns_of_heronwick',
    name: 'Lanterns of Heronwick',
    giver: 'reeve',
    summary: 'Help Reeve Fenn relight the boardwalk lanterns that keep the marsh at bay.',
    stages: [
      {
        journal: 'Speak with Reeve Fenn in Heronwick, in Mirefen Marsh.',
        objective: { type: 'talk', npc: 'reeve' },
        pendingLines: [],
        completeLines: [
          'You came over the causeway? Then you have seen our lanterns, or what is left of them.',
          'Every post on the boardwalks held a light once. The leeches won’t cross a lit path. Now half the posts are rotten and the oil is gone.',
          'Start with the posts. Bring me 4 willow logs from the groves round the pools (Woodcutting 25).',
        ],
      },
      {
        journal: 'Cut 4 willow logs in Mirefen Marsh and bring them to Reeve Fenn.',
        objective: { type: 'collect', item: 'willow_logs', count: 4, consume: true, returnTo: 'reeve' },
        pendingLines: ['Willows grow by the pools all round the village. Four logs will make four good posts.'],
        completeLines: [
          'Straight and sound. The carpenters will have them up by nightfall.',
          'Now the lanterns need oil, and the only oil the marsh gives is the leeches’. They lie in the deep marsh, south-east, on the way to the shrine.',
          'Thin them out first: defeat 5 mire leeches.',
        ],
      },
      {
        journal: 'Defeat 5 mire leeches in the deep marsh, then return to Reeve Fenn.',
        objective: { type: 'kill', enemy: 'mire_leech', count: 5, returnTo: 'reeve' },
        pendingLines: ['The leeches lie in the deep marsh, south-east along the boardwalk. Mind they don’t latch on.'],
        completeLines: [
          'Five fewer. The fishers will sleep easier.',
          'Leeches render down into a good, slow-burning oil. Bring me 4 flasks of mire oil.',
        ],
      },
      {
        journal: 'Collect 4 mire oil from mire leeches and bring them to Reeve Fenn.',
        objective: { type: 'collect', item: 'mire_oil', count: 4, consume: true, returnTo: 'reeve' },
        pendingLines: ['Leeches carry the oil. Four flasks will fill every lantern on the boardwalk.'],
        completeLines: [
          'Smell that! Heronwick has light again.',
          'One thing more. The leeches breed in the waters round the Sunken Shrine, and something guards them there: the Bog Mother, a croaker older than this village.',
          'While she lives, the leeches will keep coming. Defeat her, and the boardwalks will stay lit.',
        ],
      },
      {
        journal: 'Defeat the Bog Mother by the Sunken Shrine, then return to Reeve Fenn.',
        objective: { type: 'kill', enemy: 'bog_mother', count: 1, returnTo: 'reeve' },
        pendingLines: ['The Bog Mother lurks where the boardwalk ends, by the Sunken Shrine. Bring food. Bring friends, if you have them.'],
        completeLines: [
          'The Bog Mother, gone? Then the marsh will be quiet for a season at least.',
          'Heronwick owes you its lights. Take these, and know you are welcome at any fire in Mirefen.',
          'They say the shrine’s door is not as sealed as it looks. But that is a tale for another day.',
        ],
      },
    ],
    rewards: {
      items: [
        { item: 'coins', qty: 1500 },
        { item: 'silverpike', qty: 5 },
        { item: 'marsh_pearl', qty: 1 },
      ],
      xp: { woodcutting: 1200, firemaking: 1200, hitpoints: 1500 },
      text: ['1,500 coins', '5 silverpike', '1 marsh pearl', '1,200 Woodcutting xp', '1,200 Firemaking xp', '1,500 Hitpoints xp'],
    },
  },
  // Cairnhold, Thornridge Highlands (Phase 4A, docs/WORLD_EXPANSION.md).
  ninefold_watch: {
    id: 'ninefold_watch',
    name: 'The Ninefold Watch',
    giver: 'warden',
    summary: 'Help Warden Crane drive the stalkers from the high road and re-band the Ninefold Stones.',
    stages: [
      {
        journal: 'Speak with Warden Crane in Cairnhold, in the Thornridge Highlands.',
        objective: { type: 'talk', npc: 'warden' },
        pendingLines: [],
        completeLines: [
          'A traveller on the high road. Good. We need hands.',
          'The ridge stalkers have grown bold: they take sheep from the very walls, and last week a carter.',
          'They hunt the crags east of here. Defeat 4 ridge stalkers and the rest will think twice.',
        ],
      },
      {
        journal: 'Defeat 4 ridge stalkers on the Thornridge crags, then return to Warden Crane.',
        objective: { type: 'kill', enemy: 'ridge_stalker', count: 4, returnTo: 'warden' },
        pendingLines: ['The stalkers keep to the crags east of Cairnhold, towards the snow. Four of them.'],
        completeLines: [
          'Four! The shepherds will drink to you tonight.',
          'The old wardens bound the Ninefold Stones with bands of silver. Most were pried off long ago, and the stalkers came back.',
          'Bring me 2 silver bars. There is silver in the crags (Mining 30) and Ottilie’s furnace to smelt it (Smithing 30).',
        ],
      },
      {
        journal: 'Bring 2 silver bars to Warden Crane.',
        objective: { type: 'collect', item: 'silver_bar', count: 2, consume: true, returnTo: 'warden' },
        pendingLines: ['Silver veins show bright in the grey crags. Smelt the ore at Ottilie’s furnace.'],
        completeLines: [
          'Fine silver. The stones will hold their bands again.',
          'But the bands won’t matter while the pack has a leader. Greymane, the old one, dens in the Old Watchtower to the north-east.',
          'End Greymane, and the watch on the high road will be kept.',
        ],
      },
      {
        journal: 'Defeat Greymane at the Old Watchtower, then return to Warden Crane.',
        objective: { type: 'kill', enemy: 'greymane', count: 1, returnTo: 'warden' },
        pendingLines: ['Greymane dens by the Old Watchtower, where the high road ends. Go ready.'],
        completeLines: [
          'Greymane? Truly? Then the pack is broken.',
          'Cairnhold keeps its debts. Take this, and wear the silver with pride.',
          'The tower’s door is still barred from the inside. Who barred it, I wonder? Another day.',
        ],
      },
    ],
    rewards: {
      items: [
        { item: 'coins', qty: 1800 },
        { item: 'silver_ring', qty: 1 },
        { item: 'silver_bar', qty: 2 },
      ],
      xp: { mining: 1200, smithing: 1200, hitpoints: 1800 },
      text: ['1,800 coins', 'A Thornridge band', '2 silver bars', '1,200 Mining xp', '1,200 Smithing xp', '1,800 Hitpoints xp'],
    },
  },
};
