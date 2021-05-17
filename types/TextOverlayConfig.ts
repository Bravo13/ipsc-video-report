export enum TextPosition {
    middleTop = "middleTop",
    middleBottom = "middleBottom",

    leftTop = "leftTop",
    leftBottom = "leftBottom",

    center = "center"
}

export type TextOverlayConfig = {
    font: {
        name: string,
        path?: string,
        size: number,
        color: string
    },
    position: TextPosition
}

const TextPositionToXY = {
    [TextPosition.middleTop]: {
        x: '(main_w/2-text_w/2)',
        y: '(text_h/2)+15'
    }, 
    [TextPosition.middleBottom]: {
        x: '(main_w/2-text_w/2)',
        y: 'main_h-(text_h)-15'
    }, 

    [TextPosition.leftTop]: {
        x: '15',
        y: '15'
    },

    [TextPosition.leftBottom]: {
        x: '15',
        y: 'main_h-(text_h)-15'
    },

    [TextPosition.center]: {
        x: '(main_w/2-text_w/2)',
        y: '(main_h/2-text_h/2)'
    }
};

export function getTextPositionValue(position: TextPosition, coordName:("x"|"y")){
    return TextPositionToXY[position][coordName];
};