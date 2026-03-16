export interface RegionConfig {
  id: string;
  name: string;
  apiHost: string;
  staticNamespace: string;
  dynamicNamespace: string;
  locale: string;
}

export const REGIONS: Record<string, RegionConfig> = {
  eu: {
    id: "eu",
    name: "Europe",
    apiHost: "eu.api.blizzard.com",
    staticNamespace: "static-eu",
    dynamicNamespace: "dynamic-eu",
    locale: "en_GB",
  },
  us: {
    id: "us",
    name: "US",
    apiHost: "us.api.blizzard.com",
    staticNamespace: "static-us",
    dynamicNamespace: "dynamic-us",
    locale: "en_US",
  },
  kr: {
    id: "kr",
    name: "Korea",
    apiHost: "kr.api.blizzard.com",
    staticNamespace: "static-kr",
    dynamicNamespace: "dynamic-kr",
    locale: "ko_KR",
  },
  tw: {
    id: "tw",
    name: "Taiwan",
    apiHost: "tw.api.blizzard.com",
    staticNamespace: "static-tw",
    dynamicNamespace: "dynamic-tw",
    locale: "zh_TW",
  },
};

export const ACTIVE_REGIONS = ["eu"] as const;

export function getRegion(id: string): RegionConfig {
  const region = REGIONS[id];
  if (!region) {
    throw new Error(`Unknown region: ${id}`);
  }
  return region;
}
