import { TextOverlayConfig } from "./TextOverlayConfig";

export type VideoConfig = {
    path: string,
    begin?: number,
    end?: number,
    subtitle?: TextOverlayConfig,
    text?: string
}