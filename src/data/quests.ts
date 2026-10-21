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
      text: ['250 coins', '50 bronze arrows', '50 air runes', '3 bread', '200 Attack xp', '150 Woodcutting xp', '100 Hitpoints xp'],
    },
  },
};
