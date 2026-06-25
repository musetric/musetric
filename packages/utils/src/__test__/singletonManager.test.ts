import { describe, expect, it } from 'vitest';
import { createControlledPromise } from '../controlledPromise.js';
import { createSingletonManager } from '../singletonManager.js';

describe('createSingletonManager', () => {
  it('destroys created instance even if destroy was requested early', async () => {
    const creation = createControlledPromise<number>();
    const events: string[] = [];

    const manager = createSingletonManager(
      async () => {
        events.push('create');
        return await creation.promise;
      },
      async (value: number) => {
        events.push(`destroy:${value}`);
        return Promise.resolve();
      },
    );

    const created = manager.create();
    const destroyed = manager.destroy();

    creation.resolve(1);

    await expect(created).resolves.toBe(1);
    await destroyed;
    expect(events).toEqual(['create', 'destroy:1']);
  });

  it('creates a new instance only after destroying the previous one', async () => {
    const destroyGate = createControlledPromise<void>();
    const events: string[] = [];

    const manager = createSingletonManager(
      async (value: string) => {
        events.push(`create:${value}`);
        return await Promise.resolve(value);
      },
      async (value: string) => {
        events.push(`destroy:${value}`);
        await destroyGate.promise;
      },
    );

    const firstPromise = manager.create('first');
    const destroyPromise = manager.destroy();
    const secondPromise = manager.create('second');

    await expect(firstPromise).resolves.toBe('first');
    expect(events).toEqual(['create:first', 'destroy:first']);
    expect(events).not.toContain('create:second');

    destroyGate.resolve();
    await destroyPromise;
    expect(events).toEqual(['create:first', 'destroy:first', 'create:second']);
    await expect(secondPromise).resolves.toBe('second');
  });

  it('processes queued create/destroy pairs in order', async () => {
    const events: string[] = [];

    const manager = createSingletonManager(
      async (x: string) => {
        events.push(`create:${x}`);
        return Promise.resolve(x);
      },
      async (x: string) => {
        events.push(`destroy:${x}`);
        return Promise.resolve();
      },
    );

    const first = manager.create('one');
    const firstDestroy = manager.destroy();
    const second = manager.create('two');
    const secondDestroy = manager.destroy();
    const third = manager.create('three');

    const thirdValue = await third;
    const secondValue = await second;
    const firstValue = await first;
    await firstDestroy;
    await secondDestroy;

    expect(firstValue).toBe('one');
    expect(secondValue).toBe('two');
    expect(thirdValue).toBe('three');
    expect(events).toEqual([
      'create:one',
      'destroy:one',
      'create:two',
      'destroy:two',
      'create:three',
    ]);
  });

  it('throws on double create', async () => {
    const manager = createSingletonManager(
      async () => await Promise.resolve(1),
      async () => Promise.resolve(),
    );

    await manager.create();
    await expect(manager.create()).rejects.toThrow('Create called twice');
  });

  it('throws on double destroy', async () => {
    const manager = createSingletonManager(
      async () => await Promise.resolve(1),
      async () => Promise.resolve(),
    );

    await manager.create();
    await expect(manager.destroy()).resolves.toBeUndefined();
    await expect(manager.destroy()).rejects.toThrow(
      'Destroy called without an active instance',
    );
  });
});
