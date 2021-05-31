import { TextOverlayConfig } from "./TextOverlayConfig";

type videoType = 'empty' | 'regular';

export type VideoConfig = {
    type: videoType,
    path: string,
    begin?: number,
    end?: number,
    subtitle?: TextOverlayConfig,
    text?: string
}