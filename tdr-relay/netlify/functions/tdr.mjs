import certificate from "../geotrust-certificate.mjs";
import { createAllegroRequest, supplementedCa } from "../../upstream.mjs";
import { createTdrHandler } from "../../tdr-handler.mjs";

export default createTdrHandler({ allegroRequest: createAllegroRequest({ ca: supplementedCa(certificate) }) });
export const config = {
  path: ["/api/health", "/api/tdr", "/api/tdr/batch", "/api/vessels/batch"],
  method: ["GET", "POST", "OPTIONS"]
};
