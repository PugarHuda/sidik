import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// The recordings are already H.264; re-encoding at CRF 18 keeps the small
// monospace figures on the verdict cards legible after upload.
Config.setCrf(18);
