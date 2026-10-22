import type { GameEvent, GameWorld, PlayerId } from '../sim/world';

/**
 * Who should receive each simulation event (docs/MULTIPLAYER.md, 3A.1). The local game shows every
 * event to its one player; a server uses this to route events:
 *
 * - `self`: only the acting player (their messages, bag, bank, dialogue, interfaces, personal house
 *   and allotments).
 * - `nearby`: players who can see where it happened (attacks, damage, deaths, gathering, effects).
 * - `zone`: everyone in the zone (shared world changes such as a node running out or a fire lit).
 *
 * The table is exhaustive over `GameEvent`, so a new event type must be classified to compile.
 */
export type AudienceKind = 'self' | 'nearby' | 'zone';

export const EVENT_AUDIENCE: Record<GameEvent['type'], AudienceKind> = {
  damage: 'nearby',
  attack: 'nearby',
  projectile: 'nearby',
  death: 'nearby',
  respawn: 'nearby',
  gather: 'nearby',
  heal: 'nearby',
  pickpocket: 'nearby',
  stunned: 'nearby',
  bury: 'nearby',
  quench: 'nearby',
  obstacle: 'nearby',
  equipment: 'nearby',
  nodeDepleted: 'zone',
  nodeRespawned: 'zone',
  fireLit: 'zone',
  xp: 'self',
  levelUp: 'self',
  loot: 'self',
  message: 'self',
  dialogue: 'self',
  quest: 'self',
  checkpoint: 'self',
  region: 'self',
  inventoryFull: 'self',
  bankOpen: 'self',
  bankClose: 'self',
  bank: 'self',
  bankFull: 'self',
  productionOpen: 'self',
  productionClose: 'self',
  craft: 'self',
  exchangeOpen: 'self',
  exchangeClose: 'self',
  exchangeResult: 'self',
  exchange: 'self',
  hotspotOpen: 'self',
  house: 'self',
  patch: 'self',
  passage: 'self',
  prayer: 'self',
  toolbelt: 'self',
  shopOpen: 'self',
  tannerOpen: 'self',
  tannerClose: 'self',
  shopClose: 'self',
  shop: 'self',
};

export type Audience = { kind: 'self'; player: PlayerId } | { kind: 'nearby'; x: number; z: number } | { kind: 'zone' };

export interface RoutedEvent {
  event: GameEvent;
  audience: Audience;
}

/** The entity an event happens at, for `nearby` routing. */
function anchorOf(e: GameEvent): number | null {
  switch (e.type) {
    case 'damage':
      return e.target;
    case 'attack':
    case 'projectile':
      return e.source;
    case 'death':
    case 'respawn':
    case 'heal':
      return e.id;
    case 'gather':
      return e.node;
    case 'pickpocket':
      return e.npc;
    case 'obstacle':
      return e.obstacle;
    default:
      return null;
  }
}

/**
 * Gives each event its audience. `actor` is the player whose command or update produced the events
 * (in a one-player world, that player). Nearby events are placed at their entity, or at the actor.
 */
export function routeEvents(world: GameWorld, events: GameEvent[], actor: PlayerId = world.player.id): RoutedEvent[] {
  return events.map((event) => {
    const kind = EVENT_AUDIENCE[event.type];
    if (kind === 'self') return { event, audience: { kind, player: actor } };
    if (kind === 'zone') return { event, audience: { kind } };
    if (event.type === 'quench') return { event, audience: { kind, x: event.x, z: event.z } };
    const id = anchorOf(event);
    const at = id === world.player.id || id === null ? world.player : world.get(id);
    return { event, audience: { kind, x: at?.x ?? world.player.x, z: at?.z ?? world.player.z } };
  });
}
