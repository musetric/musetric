import { describe, expect, it } from 'vitest';
import { createLeadPages } from '../leadPages.worker.js';

const layout = { frameCount: 10, pageStarts: [0, 4, 8] };

const page = (index: number) => {
  const start = layout.pageStarts[index];
  const end = layout.pageStarts[index + 1] ?? layout.frameCount;
  return Float32Array.from(
    { length: end - start },
    (_, offset) => start + offset,
  );
};

const read = (
  lead: ReturnType<typeof createLeadPages>,
  from: number,
  count: number,
) => {
  const target = new Float32Array(count + 2).fill(-1);
  lead.source.read(target, 1, from, count);
  return Array.from(target);
};

describe('lead pages', () => {
  it('reads silence where a page is missing and asks for it and the next', () => {
    const lead = createLeadPages(layout);

    expect(read(lead, 2, 4)).toEqual([-1, 0, 0, 0, 0, -1]);
    expect(lead.takeWanted().sort((left, right) => left - right)).toEqual([
      0, 1, 2,
    ]);
    expect(lead.takeWanted()).toEqual([]);
  });

  it('reads a page once it has come and names the frames to draw again', () => {
    const lead = createLeadPages(layout);
    read(lead, 2, 4);
    lead.takeWanted();

    expect(lead.put(0, page(0))).toEqual({ frameIndex: 0, frameCount: 4 });
    expect(lead.put(1, page(1))).toEqual({ frameIndex: 4, frameCount: 4 });
    expect(read(lead, 2, 4)).toEqual([-1, 2, 3, 4, 5, -1]);
    expect(read(lead, 8, 4)).toEqual([-1, 0, 0, 0, 0, -1]);
  });

  it('lets go of a page that no render has read for a while', () => {
    const lead = createLeadPages(layout);
    lead.put(0, page(0));
    for (let render = 0; render < 200; render += 1) {
      lead.sweep();
    }

    expect(read(lead, 0, 2)).toEqual([-1, 0, 0, -1]);
    expect(lead.takeWanted()).toContain(0);
  });
});
