import { performance } from 'perf_hooks';

interface EntityState {
  entity_id: string;
  state: string;
}

interface EntityStateTrigger {
  type: 'entity_state';
  entity_id: string;
  state?: string;
  condition?: string;
  value?: string | number;
}

// Old implementation
const checkEntityStateTriggerOld = (
  trigger: EntityStateTrigger,
  entities: EntityState[]
): boolean => {
  const entity = entities.find((e) => e.entity_id === trigger.entity_id);
  if (!entity) return false;
  return entity.state === trigger.state;
};

// New implementation
const checkEntityStateTriggerNew = (
  trigger: EntityStateTrigger,
  entityMap: Map<string, EntityState>
): boolean => {
  const entity = entityMap.get(trigger.entity_id);
  if (!entity) return false;
  return entity.state === trigger.state;
};

// Generate test data
const NUM_ENTITIES = 10000;
const NUM_TRIGGERS = 1000;

const entities: EntityState[] = [];
for (let i = 0; i < NUM_ENTITIES; i++) {
  entities.push({ entity_id: `sensor.device_${i}`, state: 'on' });
}

const triggers: EntityStateTrigger[] = [];
for (let i = 0; i < NUM_TRIGGERS; i++) {
  // Trigger on random entities
  const randomId = `sensor.device_${Math.floor(Math.random() * NUM_ENTITIES)}`;
  triggers.push({ type: 'entity_state', entity_id: randomId, state: 'on' });
}

// Benchmark Old
const startOld = performance.now();
for (const trigger of triggers) {
  checkEntityStateTriggerOld(trigger, entities);
}
const endOld = performance.now();
console.log(`Baseline (O(N*M)): ${(endOld - startOld).toFixed(2)} ms`);

// Benchmark New
const startNew = performance.now();
const entityMap = new Map(entities.map((e) => [e.entity_id, e]));
for (const trigger of triggers) {
  checkEntityStateTriggerNew(trigger, entityMap);
}
const endNew = performance.now();
console.log(`Optimized (O(N+M)): ${(endNew - startNew).toFixed(2)} ms`);
