import { EventEmitter } from "node:events";
import { ShardNetworkManagerOptions } from "../../types/ShardTypes.js";
import Client from "../Client.js";

class ShardManager extends EventEmitter {
  private options: ShardNetworkManagerOptions;
  private spawnFunction: (id: number, totalShards: number, gatewayURL: string) => any;
  private client: Client;

  constructor(
    client: Client,
    spawnFunction: (id: number, totalShards: number, gatewayURL: string) => unknown,
    options: ShardNetworkManagerOptions = {}
  ) {
    super();
    this.options = options;
    this.spawnFunction = spawnFunction;
    this.client = client;
  }

  public async spawnAll() {
    const fetchGatewayURL = await this.client.gateway.get({ encoding: "json", v: "10" });

    for (let s = 0; s < fetchGatewayURL.shards; s++) {
      // Spawn each shard id
      this.spawnFunction(s, fetchGatewayURL.shards, fetchGatewayURL.url);
    }
  }
}

export default ShardManager;
