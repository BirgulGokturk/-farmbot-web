import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useBot } from "@/store/useBot";

/** AppShell'in seçtiği aktif robotun kimliği. */
export function useDeviceId(): string | null {
  return useBot((s) => s.deviceId);
}

/** Aktif robotun kalıcı bilgileri (ad, yatak ölçüleri, ayarlar). */
export function useActiveDevice() {
  const deviceId = useDeviceId();

  return useQuery({
    queryKey: ["device", deviceId],
    queryFn: () => api.devices.get(deviceId!),
    enabled: Boolean(deviceId),
  });
}
