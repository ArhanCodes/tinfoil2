import { Users, Guilds, Gateway } from "./rest/index.js";
import Centra from "centra";
import { HTTPMethods } from "../types/RestTypes.js";
import { RESTError } from "discord-api-types/v10";
import { DefaultUserAgent } from "../utils/constants.js";

class RestClient {
  private authorization: string;
  private baseURL: string;
  private userAgent: string;

  public users: Users;
  public guilds: Guilds;
  public gateway: Gateway;

  constructor(token: string, url: string, version: number, userAgentAppendix: string) {
    this.authorization = `Bot ${token}`;
    this.baseURL = `${url}/v${version}`;
    this.users = new Users(this);
    this.guilds = new Guilds(this);
	this.gateway = new Gateway(this);
    this.userAgent = `${DefaultUserAgent} ${userAgentAppendix}`;
  }

  async request(endpoint: string, method: HTTPMethods, options?: any, formData?: boolean): Promise<any> {
    const url = new URL(this.baseURL + endpoint);

    if (method === "GET" && options) {
      for (const optionKey of Object.keys(options)) {
        url.searchParams.set(optionKey, options[optionKey]);
      }
    }

    const req = Centra(url, method);
    req.header("User-Agent", this.userAgent);
    req.header("Authorization", this.authorization);

    if (options && options.auditLogReason) {
      req.header("X-Audit-Log-Reason", options.auditLogReason);
    }

    if ((method === "POST" || method === "PATCH" || method === "PUT") && options) {
      req.body(options, formData ? "form" : "json");
    }

    const res = await req.send();
    const code = res.statusCode ?? 0;

    // Successful (Discord often returns 201/204 as well)
    if (code >= 200 && code < 300) {
      if (code === 204) return undefined;
      try {
        return await res.json();
      } catch {
        return undefined;
      }
    }

    // Rate limit
    if (code === 429) {
      let retryAfter: number | undefined;
      try {
        const data = await res.json();
        retryAfter = data?.retry_after;
      } catch {}
      throw new Error(`HTTP 429 rate limited on ${method} ${endpoint}${retryAfter ? ` (retry_after=${retryAfter}s)` : ""}`);
    }

    // Known error codes with Discord RESTError shape
    if ([400, 401, 403, 404, 405, 502, 500].includes(code)) {
      let error: RESTError | undefined;
      try {
        error = await res.json();
      } catch {
        throw new Error(`HTTP error ${code} on ${method} ${endpoint} (no JSON body)`);
      }
      throw new Error(`HTTP error ${code} on ${method} ${endpoint}: ${error?.message}`);
    }

    throw new Error(`HTTP error ${code} on ${method} ${endpoint}`);
  }
}

export default RestClient;
