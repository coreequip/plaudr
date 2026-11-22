export interface MicChoice {
  value: string;
  label: string;
  selected: boolean;
}

interface DeviceInfo {
  kind: string;
  deviceId: string;
  label: string;
}

/** Auswahlliste fürs Mikrofon: zuerst das Standardgerät; ein gemerktes, nicht mehr vorhandenes Gerät fällt darauf zurück. */
export function micChoices(devices: DeviceInfo[], saved: string | null): MicChoice[] {
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const found = saved !== null && inputs.some((d) => d.deviceId === saved);
  return [
    { value: '', label: 'Standardgerät', selected: !found },
    ...inputs.map((d, i) => ({ value: d.deviceId, label: d.label || `Mikrofon ${i + 1}`, selected: found && d.deviceId === saved })),
  ];
}

export async function listMics(): Promise<DeviceInfo[]> {
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}
