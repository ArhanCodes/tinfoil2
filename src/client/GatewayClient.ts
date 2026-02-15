import { isParse, stringify } from "typia";
import { DefaultGatewayClientOptions, urlAppendix, validReconnectionCodes } from "../utils/constants.js";
import Client from "./Client.js";
import * as APITypes from "discord-api-types/v10";
import { inflateSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { GatewayClientEvents, GatewayClientOptions } from "../types/GatewayTypes.js";

class GatewayClient extends (EventEmitter as new () => GatewayClientEvents) {
  private token: string;
  private client: Client;
  private url: string;

  private reconnectSessionID: string;
  private lastSequence: number;
  private reconnectURL: string;
  private heartbeatWasAcknowledged: boolean;

  public rawConnection: WebSocket | undefined;
  public options: GatewayClientOptions;

  constructor(client: Client, options: GatewayClientOptions) {
    super();
    this.token = client.token;
    this.client = client;
    this.options = { ...DefaultGatewayClientOptions, ...options };
    this.url = this.reconnectSessionID = this.reconnectURL = "";
    this.lastSequence = 0;
    this.heartbeatWasAcknowledged = false;
  }

  /** Send data to gateway */
  public send(opCode: APITypes.GatewayOpcodes, data?: any, type?: APITypes.GatewayDispatchEvents, s?: number): void {
    const payload: object = {
      op: opCode,
      d: data,
      t: type,
      s: s,
    };
    this.rawConnection?.send(stringify(payload));
  }

  private handleIncoming(data: unknown, isBinary: boolean) {
    const raw = isBinary ? inflateSync(data as Buffer).toString() : (data as any).toString();
    const parsed = isParse<APITypes.GatewayReceivePayload | APITypes.GatewayDispatchPayload>(raw);
    if (!parsed) return;

    // Track last sequence number when present
    if (typeof (parsed as any).s === "number") this.lastSequence = (parsed as any).s;

    switch (parsed.op) {
      case APITypes.GatewayOpcodes.Heartbeat: {
        this.send(APITypes.GatewayOpcodes.Heartbeat, this.lastSequence);
        break;
      }
      case APITypes.GatewayOpcodes.Reconnect: {
        this.rawConnection?.close(4000);
        break;
      }
      case APITypes.GatewayOpcodes.InvalidSession: {
        const canResume = Boolean((parsed as APITypes.GatewayInvalidSession).d);
        if (canResume) {
          this.rawConnection?.close(4000);
        } else {
          this.rawConnection?.close(1000);
          throw new Error("GATEWAY ERROR: invalid session and cannot resume (opcode 9). Try again later.");
        }
        break;
      }
      case APITypes.GatewayOpcodes.Hello: {
        this.startHeartbeatLoop((parsed as APITypes.GatewayHello).d.heartbeat_interval);
        this.identify();
        break;
      }
      case APITypes.GatewayOpcodes.HeartbeatAck: {
        this.heartbeatWasAcknowledged = true;
        break;
      }
      default: {
        const dispatch = parsed as APITypes.GatewayDispatchPayload;
        if (dispatch.t) {
          if (dispatch.t === "READY") {
            const d = dispatch.d as APITypes.GatewayReadyDispatchData;
            this.reconnectURL = d.resume_gateway_url;
            this.reconnectSessionID = d.session_id;
          }
          this.emit(dispatch.t as any, dispatch.d as any);
        }
        break;
      }
    }
  }

  /** Connect client to gateway */
  public async connect(isReconnection?: boolean) {
    if (!isReconnection) {
      const gatewayData = await this.client.gateway.get();
      this.url = gatewayData.url;
      this.reconnectURL = gatewayData.url;
    }

    this.rawConnection = new WebSocket((isReconnection ? this.reconnectURL : this.url) + urlAppendix);

    this.rawConnection.onclose = (data) => {
      if (!data.code || validReconnectionCodes.includes(data.code)) {
        this.connect(true);
      } else {
        // TODO handle total disconnect
      }
    };

    this.rawConnection?.on("message", (data, isBinary) => {
      this.handleIncoming(data, isBinary);
    });

    this.rawConnection.onopen = () => {
      if (isReconnection) {
        this.send(6, {
          token: this.token,
          session_id: this.reconnectSessionID,
          seq: this.lastSequence,
        });
      }
    };
  }

  private async identify() {
    this.send(APITypes.GatewayOpcodes.Identify, {
      token: this.token,
      intents: this.options.intents?.reduce((acc: number, bit: number) => acc | bit, 0) ?? 0,
      compress: true,
      properties: this.options.identifyProperties ?? {},
    } as APITypes.GatewayIdentifyData);
  }

  private async startHeartbeatLoop(interval: number) {
    this.heartbeatWasAcknowledged = true;
    await new Promise((r) => setTimeout(r, interval * Math.random()));
    this.sendHeartbeat();
    setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  private sendHeartbeat() {
    if (this.heartbeatWasAcknowledged === true) {
      this.heartbeatWasAcknowledged = false;
      this.send(1, this.lastSequence);
    } else {
      this.rawConnection?.close(4000);
    }
  }
}

export default GatewayClient;
