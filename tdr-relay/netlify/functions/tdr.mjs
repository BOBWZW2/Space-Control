import certificate from "../geotrust-certificate.mjs";
import { createAllegroRequest, supplementedCa } from "../../upstream.mjs";
import { createTdrHandler } from "../../tdr-handler.mjs";

const ca = supplementedCa(certificate);
export default createTdrHandler({ allegroRequestFactory: () => createAllegroRequest({ ca, keepAlive: true }) });
export const config = {
  path: ["/api/health", "/api/tdr", "/api/tdr/batch", "/api/vessels/batch"],
  method: ["GET", "POST", "OPTIONS"]
};
