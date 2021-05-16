import { TextOverlayConfig } from "./TextOverlayConfig";

export type VideoConfig = {
    path: string,
    begin?: string,
    end?: string,
    beginOffset?: number,
    endOffset?: number,
    subtitle?: TextOverlayConfig,
    text?: string
}