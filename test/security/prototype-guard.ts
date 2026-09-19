import { afterEach, expect } from "vite-plus/test";

/** Every built-in prototype an attacker can reach through `__proto__` or `constructor`. */
const PROTOTYPES = [Object.prototype, Array.prototype, Function.prototype] as const;

/**
 * Registers an `afterEach` that fails the test if any built-in prototype gained
 * an own property, then removes the leaked keys so one missed payload can't
 * poison the rest of the suite.
 */
export function installPrototypeGuard(): void {
  const baseline = PROTOTYPES.map((proto) => new Set(Reflect.ownKeys(proto)));

  afterEach(() => {
    const leaked: string[] = [];
    PROTOTYPES.forEach((proto, i) => {
      for (const key of Reflect.ownKeys(proto)) {
        if (baseline[i]?.has(key)) continue;
        leaked.push(String(key));
        delete (proto as Record<PropertyKey, unknown>)[key];
      }
    });
    expect(leaked, "a built-in prototype was polluted").toEqual([]);
  });
}
