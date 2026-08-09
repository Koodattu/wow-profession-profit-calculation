import type { AuctionSource, CommodityAuctionInput, RealmAuctionInput } from "./auction-refresh";
import { blizzardClient } from "./blizzard";

interface CommodityResponse {
  auctions: CommodityAuctionInput[];
}

interface RealmAuctionResponse {
  auctions: RealmAuctionInput[];
}

export const blizzardAuctionSource: AuctionSource = {
  async fetchCommodityAuctions(regionId) {
    const data = await blizzardClient.get<CommodityResponse>(
      regionId,
      "/data/wow/auctions/commodities",
      "dynamic",
    );
    return data.auctions;
  },

  async fetchRealmAuctions(regionId, connectedRealmId) {
    const data = await blizzardClient.get<RealmAuctionResponse>(
      regionId,
      `/data/wow/connected-realm/${connectedRealmId}/auctions`,
      "dynamic",
    );
    return data.auctions;
  },
};
