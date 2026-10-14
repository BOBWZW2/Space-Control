import certificate from "../geotrust-certificate.mjs";
import { createAllegroRequest, supplementedCa } from "../../upstream.mjs";
import { createWebRelayHandler } from "../../web-handler.mjs";

// The certificate is embedded in the bundle; no filesystem path or extra CA
// download is required in the serverless runtime. Its signature is checked
// against Node's existing trusted roots before making an origin connection.
const allegroRequest = createAllegroRequest({ ca: supplementedCa(certificate) });
export default createWebRelayHandler({ getToken: () => process.env.RELAY_ACCESS_TOKEN, allegroRequest });
export const config = { path: ["/health", "/v1/allegro", "/v1/diagnostics"], method: ["GET", "POST"] };
