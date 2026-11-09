import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFollowScrollController,
  type FollowScrollController,
} from '../followScrollController.js';

const lineCount = 40;
const lineHeight = 30;
const listHeight = 300;

type Listener = () => void;

const subscribe = (listeners: Set<Listener>, listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (listeners: Set<Listener>) => {
  for (const listener of listeners) {
    listener();
  }
};

type SeekOrder = 'the seek first' | 'the line first';

type FakeStore = {
  getRevision: () => number;
  getActiveIndex: () => number;
  subscribeRevision: (listener: Listener) => () => void;
  subscribeActiveIndex: (listener: Listener) => () => void;
  seek: (index: number) => void;
};

const createStore = (order: SeekOrder, firstIndex: number): FakeStore => {
  const revisionListeners = new Set<Listener>();
  const activeIndexListeners = new Set<Listener>();
  const state = { revision: 0, activeIndex: firstIndex };
  return {
    getRevision: () => state.revision,
    getActiveIndex: () => state.activeIndex,
    subscribeRevision: (listener) => subscribe(revisionListeners, listener),
    subscribeActiveIndex: (listener) =>
      subscribe(activeIndexListeners, listener),
    seek: (index) => {
      state.revision += 1;
      if (order === 'the seek first') {
        notify(revisionListeners);
      }
      state.activeIndex = index;
      notify(activeIndexListeners);
      if (order === 'the line first') {
        notify(revisionListeners);
      }
    },
  };
};

const createList = (): HTMLElement => {
  const element = document.createElement('div');
  element.style.height = `${listHeight}px`;
  element.style.overflowY = 'auto';
  for (let index = 0; index < lineCount; index += 1) {
    const line = document.createElement('div');
    line.style.height = `${lineHeight}px`;
    element.append(line);
  }
  document.body.append(element);
  return element;
};

const locateLine = (element: HTMLElement, index: number) =>
  element.querySelector<HTMLElement>(`:scope > :nth-child(${index + 1})`);

const nextFrame = async () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

const seekOrders: SeekOrder[] = ['the seek first', 'the line first'];

describe('follow scroll controller', () => {
  const opened: { element: HTMLElement; controller: FollowScrollController }[] =
    [];

  const open = (store: FakeStore, firstIndex: number) => {
    const element = createList();
    element.scrollTop = Math.max(
      0,
      firstIndex * lineHeight - listHeight / 2 + lineHeight / 2,
    );
    const controller = createFollowScrollController({
      element,
      getActiveIndex: store.getActiveIndex,
      subscribeActiveIndex: store.subscribeActiveIndex,
      locateElement: (index) => locateLine(element, index),
      getRevision: store.getRevision,
      subscribeRevision: store.subscribeRevision,
      isRevisionIgnored: () => false,
    });
    opened.push({ element, controller });
    return { element, controller };
  };

  afterEach(() => {
    for (const { element, controller } of opened.splice(0)) {
      controller.dispose();
      element.remove();
    }
    vi.restoreAllMocks();
  });

  it.each(seekOrders)(
    'centers the line a seek moves to further on, with %s',
    async (order) => {
      const store = createStore(order, 0);
      const { element } = open(store, 0);
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

      store.seek(30);
      await nextFrame();
      await nextFrame();

      expect(scrollIntoView.mock.contexts).toEqual([locateLine(element, 30)]);
    },
  );

  it.each(seekOrders)(
    'centers the line a seek moves back to, with %s',
    async (order) => {
      const store = createStore(order, 30);
      const { element } = open(store, 30);
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

      store.seek(2);
      await nextFrame();
      await nextFrame();

      expect(scrollIntoView.mock.contexts).toEqual([locateLine(element, 2)]);
    },
  );

  it.each(seekOrders)(
    'lets a click decide the scroll of its own seek, with %s',
    async (order) => {
      const store = createStore(order, 0);
      const { element, controller } = open(store, 0);
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      const { top } = element.getBoundingClientRect();

      store.seek(3);
      controller.activate(3, top + lineHeight);
      await nextFrame();
      await nextFrame();

      expect(scrollIntoView.mock.contexts).toEqual([]);
    },
  );

  it('drops a seek still pending when it is disposed', async () => {
    const store = createStore('the seek first', 0);
    const { controller } = open(store, 0);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    store.seek(30);
    controller.dispose();
    await nextFrame();
    await nextFrame();

    expect(scrollIntoView.mock.contexts).toEqual([]);
  });
});
