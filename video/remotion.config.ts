import { Config } from "@remotion/cli/config";

// Final MP4: H.264 + AAC, 1920x1080 @ 30 fps (set on the composition).
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setCodec("h264");
Config.setCrf(18);
Config.setPixelFormat("yuv420p");
Config.setAudioCodec("aac");
Config.setAudioBitrate("320k");
Config.setOverwriteOutput(true);
