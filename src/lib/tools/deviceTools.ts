import type { DeviceProfile } from "../localLlm";

export interface DeviceToolContext {
  profile: DeviceProfile | null;
  ownerName: string;
  batteryCutoff: number;
}

export function getDeviceProfileSnapshot(context: DeviceToolContext) {
  const { profile, ownerName, batteryCutoff } = context;
  if (!profile) {
    return "Device profile is not available yet.";
  }

  const lines = [
    `Device: ${profile.deviceLabel ?? `${profile.manufacturer} ${profile.model}`}`,
    profile.localTimeIso ? `Local time: ${profile.localTimeIso}` : "",
    profile.timezoneId ? `Timezone: ${profile.timezoneId}` : "",
    ownerName.trim() ? `Owner name: ${ownerName.trim()}` : "Owner name: not set",
    profile.batteryPercent >= 0
      ? `Battery: ${Math.round(profile.batteryPercent)}%${profile.charging ? " (charging)" : ""}`
      : "Battery: unknown",
    `Battery cutoff for local inference: ${batteryCutoff}%`,
    profile.contactsPermission ? `Contacts permission: ${profile.contactsPermission}` : "",
    `Available RAM: ${profile.availableRamBytes} bytes`,
    `Free storage: ${profile.storageFreeBytes} bytes`,
  ].filter(Boolean);

  return lines.join("\n");
}
