import { describe, expect, it } from 'vitest';
import { matchDesktopInputs } from '../desktopInputs.js';

const pageInput = (deviceId: string, label: string): MediaDeviceInfo => {
  const info = {
    deviceId,
    groupId: `group-${deviceId}`,
    kind: 'audioinput' as const,
    label,
  };
  return { ...info, toJSON: () => info };
};

describe('matchDesktopInputs', () => {
  it('takes the page input of the name Chromium gives', () => {
    const labels = [
      'Microphone (High Definition Audio)',
      'Headset (Wireless Earbuds) (Bluetooth)',
      'Microphone (USB Microphone) (0d8c:0014)',
    ];
    const inputs = matchDesktopInputs(
      labels.map((label, index) => ({
        id: `endpoint-${index}`,
        label: label.replace(/ \((?:Bluetooth|0d8c:0014)\)$/u, ''),
      })),
      [
        pageInput('default', `Default - ${labels[0]}`),
        ...labels.map((label, index) => pageInput(`page-${index}`, label)),
      ],
    );
    expect(inputs).toEqual(
      labels.map((label, index) => ({
        nativeId: `endpoint-${index}`,
        port: { id: `page-${index}`, label, groupId: `group-page-${index}` },
      })),
    );
  });

  it('keeps the native input when the page has no name or two alike', () => {
    const twins = [
      { id: 'endpoint-a', label: 'Microphone (USB Audio)' },
      { id: 'endpoint-b', label: 'Microphone (USB Audio)' },
    ];
    const unnamed = matchDesktopInputs(twins.slice(0, 1), [pageInput('', '')]);
    const doubled = matchDesktopInputs(twins, [
      pageInput('page-a', 'Microphone (USB Audio)'),
    ]);
    expect([...unnamed, ...doubled]).toEqual(
      [twins[0], ...twins].map((port) => ({ nativeId: port.id, port })),
    );
  });
});
