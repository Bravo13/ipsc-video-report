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

export function getTextPositionValue(position: TextPosition, coordName:("x"|"y"), currentLine: number, linesTotal: number, fontSize: number){
    const basePositin = TextPositionToXY[position][coordName];
    let calculatedPosition;
    if(position == TextPosition.center && coordName == "y") {
        calculatedPosition = basePositin + "-max_glyph_a*"+linesTotal+"/2+max_glyph_a*"+currentLine+"+"+fontSize*.1*currentLine;

    } else if(
        coordName == "y"
        && (
            position == TextPosition.leftBottom
            || position == TextPosition.middleBottom
        )
    ){
        calculatedPosition = basePositin + "-max_glyph_a*"+linesTotal+"+max_glyph_a*"+currentLine+"+"+fontSize*.1*currentLine;

    } else if(
        coordName == "y"
        && (
            position == TextPosition.leftTop
            || position == TextPosition.middleTop
        )
    ){
        calculatedPosition = basePositin + "+max_glyph_a*"+linesTotal+"+max_glyph_a*"+currentLine+"+"+fontSize*.1*currentLine;

    } else {
        calculatedPosition = basePositin;
    }

    return calculatedPosition;
};