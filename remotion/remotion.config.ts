import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// disableWebSecurity: los layers audio-reactivos (audiogram + fondos audioReactive de
// motion_*/kinetic_type/lottie_pop) hacen fetch CLIENT-SIDE del audio (useWindowedAudioData).
// En el render el bundle vive en su puerto y el API en otro → cross-origin; sin este flag
// CORS bloquea el fetch y el render de esos estilos FALLA. Cubre los renders por CLI
// (fallback de shorts y largos); el pool (render-server.mjs) lo setea en chromiumOptions.
Config.setChromiumDisableWebSecurity(true);
Config.setConcurrency(4);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
// CRF 24 = compresión balanceada (calidad alta, ~30% más liviano que CRF 20).
// NO setear videoBitrate junto con CRF (son mutuamente excluyentes en Remotion).
Config.setCrf(24);
